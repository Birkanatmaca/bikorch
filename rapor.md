# Bikorch — Genel Proje İnceleme Raporu

**Tarih:** 23 Eylül 2026

**Kapsam:** Mevcut çalışma ağacı; Electron ana süreç, preload, React arayüzü, CLI/hesap yönetimi, Sekreter, otomasyonlar, kalıcılık, test ve CI.

**Yöntem:** İlk incelemede statik kod incelemesi, mevcut testler ve TypeScript kontrolleri çalıştırıldı. Bu devam turundaki değişikliklerden sonra TypeScript kontrolü ve üretim build'i başarılı; test paketi çalıştırılmadı. Build bazı mevcut dynamic-import/chunk uyarıları verdi. Gerçek hesaplarla uçtan uca oturum açma, paketlenmiş uygulama, Windows ve güvenlik penetrasyon testi yapılmadı. Bulgular bu sınırlar içinde değerlendirilmelidir.

## Kısa sonuç

Uygulamanın temel mimarisi ve test altyapısı var. P0-1 için Sekreter iş alanı izolasyonu kod düzeyinde sıkılaştırıldı; gerçek macOS/Windows CLI akışı henüz doğrulanmadı. P0-2 için dosya IPC'si kayıtlı proje kimliğine bağlandı ve file-handle doğrulaması eklendi; dizin seviyesindeki TOCTOU ile platform testleri hâlâ açık. P0-3'te sahte yürütme kaldırıldı: CLI bağlı değilken görev başlatılmıyor ve eski simülasyon başarıları yeniden sınıflandırılıyor. Gerçek otomasyon yürütücüsü henüz yok. Sekreter hızlı sonuç takibini öne aldı ve yeniden başlatmada aktif/kullanıcı bekleyen işleri açıklamalı kesintiye alıyor. Veritabanı yazımı geçici dosya + atomik değiştirme kullanıyor. Hesap silme de global logout ile yerel profil silmeyi ayırıyor ve sistem import bastırma tercihini kalıcı tutuyor.

İlk inceleme doğrulamasında `npm run typecheck`, `npm test` (**91 dosyada 411 test**) ve `npm run build` başarılıydı. Bu devam turundaki son `npm run typecheck` ve `npm run build` de başarılı; `npm test` son değişikliklerden sonra çalıştırılmadı. Test başarısı aşağıdaki entegrasyon ve platform açıklarının kapandığı anlamına gelmiyor. İnceleme ve düzeltmeler commit edilmemiş çalışma ağacını içerir; önceki kullanıcı değişiklikleri korundu.

**Öncelik tanımı:** P0 = yayımlamadan önce çözülmesi gereken veri/güven/doğruluk riski; P1 = sonraki geliştirme döngüsünde çözülmesi gereken önemli işlevsel risk; P2 = kalite ve sürdürülebilirlik.

## Mevcut temel ve güçlü taraflar

- Electron ana süreç, preload, renderer ve ortak sözleşmeler ayrılmış; tip kontrolü ile birim testleri çalışıyor ([package.json](package.json#L7)).
- CLI oturumlarını kalıcı tutma ve Git worktree altyapısı mevcut; Sekreterin bu yolu zorunlu kullanması P0-1 kapsamında eklendi ([pty-manager.ts](src/main/cli/pty-manager.ts#L544), [TerminalView.tsx](src/renderer/components/terminal/TerminalView.tsx#L468)).
- Sekreterde kullanıcı onayı ve plan durumları, hesap profilleri, kullanım sorguları, görevler, loglar ve otomasyon depolaması bulunuyor. Sekreter kayıtlarında gizli veri maskeleme ve API anahtarı için işletim sistemi şifreleme mekanizması kullanılıyor ([store.ts](src/main/secretary/store.ts#L77), [service.ts](src/main/secretary/service.ts#L127)). Bu önlemler aşağıdaki yürütme/erişim açıklarını tek başına kapatmıyor.

## Bulgular

### P0-1 — Sekreter çalışma alanı izolasyonu: kod düzeyinde giderildi, platform smoke bekliyor

**İlk tespit:** Sekreter yeni panelleri `shared` açıyor, var olan paylaşılan panelleri seçebiliyor ve terminal worktree başarısızlığında proje klasörüne dönüyordu. Ana süreç de bu klasörü geçerli kabul ediyordu.

**Uygulanan:** Sekreter yalnızca kendine ayrılmış izole panelleri seçiyor veya yenisini açıyor ([DeveloperSecretary.tsx](src/renderer/components/workspace/DeveloperSecretary.tsx#L333)). Bu paneller paylaşılan moda geçirilemiyor ([workspace-store.ts](src/renderer/stores/workspace-store.ts#L1148)); worktree açılamazsa terminal oturumu başlatılmıyor ([TerminalView.tsx](src/renderer/components/terminal/TerminalView.tsx#L459)). Ana süreç, oturum yolunun panel yolu ve Git'teki kayıtlı/uygun branşlı worktree ile eşleşmesini, ana proje klasörü olmadığını ve paralel atamaların ayrı gerçek dizinlerde olduğunu hem onay öncesi hem gönderim öncesi kontrol ediyor ([orchestrator.ts](src/main/secretary/orchestrator.ts#L50), [worktrees.ts](src/main/git/worktrees.ts#L26)).

**Doğrulama:** Paylaşılan panel, ana proje dizini ve Git'te kayıtlı olmayan worktree reddi; iki bağımsız görev için ayrı worktree senaryosu otomatik testlerde geçti ([orchestrator.test.ts](src/main/secretary/__tests__/orchestrator.test.ts), [worktrees.test.ts](src/main/git/__tests__/worktrees.test.ts)). İzolasyon düğmesinin Sekreter panelini paylaşılan moda alamadığı da test edildi ([workspace-isolation.test.ts](src/renderer/stores/__tests__/workspace-isolation.test.ts)).

**Kalan doğrulama:** macOS'ta geliştirme uygulaması açılıp proje seçici görüntülendi; bu temiz uygulama profilinde açık proje olmadığından gerçek CLI ile iş akışı başlatılmadı. macOS ve Windows'ta worktree kurulumu/başarısızlığı, paralel düzenleme ve değişiklikleri inceleyip ana ağaca uygulama akışı uçtan uca denenmeli. Git olmayan projede Sekreter görevleri artık güvenli biçimde başlamaz; bu durum kullanıcıya açıklanır.

### P0-2 — Dosya IPC'si kayıtlı proje köküne bağlandı; güvenli açma ve testler bekliyor

**İlk tespit:** Renderer, dosya IPC'sine proje kökünü kendisi veriyordu; bu kök başka klasör olabiliyor ve sözcüksel yol kontrolü sembolik bağlantı hedefini doğrulamıyordu.

**Uygulanan:** IPC artık yalnızca `projectId` alıyor; kökü ana süreç veritabanındaki kayıtlı projeden çözüyor ve ana pencerenin ana frame'ini doğruluyor ([filesystem.ts](src/main/ipc/filesystem.ts#L10)). Dizin listeleme ve arama symlink girdilerini atlıyor. Dosya okuma/yazma öncesi gerçek yol proje köküyle karşılaştırılıyor; dosyanın kendisi mümkün olan platformlarda `O_NOFOLLOW` ile açılıyor ve açık tanıtıcının inode/device kimliği ön kontrolle eşleştiriliyor ([path-guard.ts](src/main/filesystem/path-guard.ts#L18), [index.ts](src/main/filesystem/index.ts#L10)).

**Kalan risk/doğrulama:** Dosya inode kontrolü son dosya bileşeni için yarışı daraltıyor; `readdir` gibi dizin işlemleri hâlâ path tabanlı ve üst dizin bileşenlerinin eşzamanlı değiştirilmesi tamamen önlenmiş değil. macOS/Windows'ta dış kök, `..`, mutlak yol, symlink, değiştirilen hedef ve normal dosya senaryoları sınır testleriyle doğrulanmalı. Bu turda test paketi çalıştırılmadı.

**Durum:** İstemcinin rastgele kök gönderme açığı kod düzeyinde giderildi; bütün P0-2 bulgusu henüz kapanmadı.

### P0-3 — Otomasyon simülasyonu kaldırıldı; gerçek yürütücü hâlâ yok

**İlk tespit:** Gerçek yürütme kapalıyken `simulateExecution` gecikmeyle `succeeded` ve `exitCode: 0` yazıyor; ağ koşulundaki `|| true` her politikayı çalışabilir gösteriyordu.

**Uygulanan:** Simülatör kaldırıldı. Gerçek yürütücü bağlı olmadığı için `Run now` ana süreçte reddediliyor ve arayüzde devre dışı; zamanlayıcı da yürütülebilir iş iddiasında bulunmuyor. Arayüz bu kısıtı açıkça bildiriyor ([AutomationPanel.tsx](src/renderer/components/automation/AutomationPanel.tsx#L461)). Önceki sürümlerin simülasyon başarıları başlangıçta `needs-attention` durumuna çevriliyor ([store.ts](src/main/automation/store.ts#L461)).

**Etki/kalan iş:** Yanıltıcı sahte başarı yolu kapatıldı; ancak otomasyon tanımları şu an CLI işi yapamaz. Gerçek Codex yürütücüsü, yetki sınırı, ağ politikası, iptal, yeniden başlatma ve başarılı sonuç doğrulaması ayrıca tasarlanıp uygulanmalı. Bu turda test paketi çalıştırılmadı.

**Durum:** Sahte başarı riski azaltıldı; otomasyon özelliği gerçek yürütücü tamamlanana kadar kullanıma hazır değil.

### P1-1 — Sekreter hızlı CLI sonuçlarını şimdi dispatch öncesinde izliyor; hata yolu doğrulanmalı

**İlk tespit:** Orkestratör kök görevlerin promptlarını yollayıp her biri için bekliyor; `trackSecretaryRun` çağrısı tüm gönderimler bittikten sonra geldiğinden hızlı çıktı kaçabiliyordu.

**Uygulanan:** Git başlangıç görüntüleri alındıktan sonra tüm kök oturumlar terminale yazmadan önce takip listesine ekleniyor ([orchestrator.ts](src/main/secretary/orchestrator.ts#L202)). Kısmi dispatch hatasında takip zamanlayıcısı/oturum eşlemesi temizleniyor; sadece gönderim denenmiş oturumlara kesme sinyali yollanıyor. Test mock'u yeni temizleme fonksiyonuyla uyumlu hale getirildi.

**Kalan doğrulama:** Bu turda test paketi çalıştırılmadı. Anında structured sonuç döndüren PTY senaryosu, kısmi gönderim hatası ve paralel kök görevlerle yarış koşulu testi çalıştırılmalı.

**Sonraki adım:** Anında cevap veren PTY, kısmi gönderim hatası ve paralel kök görevlerle bu yarış koşulunu otomatik test et.

### P1-2 — Sekreter oturumları yeniden bağlanmıyor; stale işler açıklamalı kesintiye alınıyor

**Kanıt:** Uygulama kapanırken kalıcı PTY oturumları çalışmaya devam edebiliyor ([pty-manager.ts](src/main/cli/pty-manager.ts#L544)). Başlangıçta Sekreter `planning/running` kayıtlarını `interrupted` yapıyor; `needs-user` bu kümeye girmiyor ([service.ts](src/main/secretary/service.ts#L176), [store.ts](src/main/secretary/store.ts#L500)). Sonuç toplayıcının canlı oturum eşlemesi bellekte tutuluyor ([result-collector.ts](src/main/secretary/result-collector.ts#L445)).

**Etki:** Uygulama yeniden açıldığında CLI işi sürebilir ama Sekreter artık sonucu dinlemeyebilir; kullanıcı cevabı bekleyen kayıt da gerçek bir yönlendirme bağlantısı olmadan kalabilir.

**Uygulanan:** Başlangıç kurtarması `planning`, `running` ve `needs-user` işlerini `interrupted` durumuna alıyor; CLI dinleyicisinin geri yüklenemediğini açıklayan kalıcı hata mesajını görev geçmişine ekliyor ([store.ts](src/main/secretary/store.ts#L500)). Böylece kullanıcı cevabı bekleyen iş sessizce açık kalmıyor.

**Kalan iş/doğrulama:** PTY–atama bağlantısı kalıcılaştırılıp oturum devam ettirme hâlâ yok; güvenli davranış bu yüzden kesinti bildirmek. Uygulama yeniden açılışında `running` ve `needs-user` kayıtlarının uyarı göstermesi otomatik test ve macOS/Windows smoke ile doğrulanmalı. Bu turda test paketi çalıştırılmadı.

### P1-3 — Hesap kaldırma kapsamı netleştirildi; sistem içe alma tercihi sağlayıcı bazında

**İlk tespit:** Hesap kartı her CLI için “sign out” vaat ediyordu; gerçekte Cursor yalnızca Bikorch profilindeki tokenı siliyor, Codex/Gemini/Claude ise profil kopyasını siliyor. Antigravity logout'u ise global credential'a dokunabiliyordu. Sistem içe alma engeli yalnızca RAM'deydi.

**Uygulanan:** Onay metni yerel profil silme ile sistem logout'u ayırıyor. Antigravity global logout'u yalnızca hedef hesabın saklanan secret'ı canlı credential ile eşleşirse ve ana süreç credential kilidi altındayken yapılıyor ([profile-manager.ts](src/main/accounts/profile-manager.ts#L433), [auth-profiles.ts](src/main/ipc/auth-profiles.ts#L83)). Diğer CLI'larda sistem çapındaki login'in kapanmadığı açıkça belirtiliyor. Sistem auth keşfini bastırma tercihi veritabanına kaydedilip yeniden açılışta korunuyor ([persistence-sync.ts](src/renderer/lib/persistence-sync.ts#L20), [database.ts](src/main/persistence/database.ts#L910)).

**Kalan iş:** İçe alma bastırma tercihi hesap kimliğine değil CLI türüne göre tutuluyor; farklı bir sistem hesabını yeniden içe almak için bu sağlayıcıdan yeni profil üzerinden giriş gerekir. Her sağlayıcının tekli/çoklu hesap logout akışı ve işletim sistemi credential davranışı macOS/Windows'ta doğrulanmalı. Bu turda test paketi çalıştırılmadı.

**Durum:** UI'nın gerçeğe aykırı logout vaadi giderildi; Antigravity hesabı hedef eşleşmesiyle korunuyor ve sistem import bastırması kalıcı. Sağlayıcı smoke testleri bekliyor.

### P1-4 — Atomik DB yenileme eklendi; yedek ve hata kurtarma doğrulaması bekliyor

**İlk tespit:** `sql.js` veritabanı dışa aktarıldıktan sonra mevcut DB yoluna doğrudan `writeFileSync` yapılıyor; geçici dosya + atomik değiştirme veya doğrulanmış yedek mekanizması yoktu.

**Etki:** İşlem ortasında kapanma, disk dolması veya yazım hatasında tek veritabanı dosyası bozulabilir; projeler, görevler ve Sekreter geçmişi etkilenebilir. Bu bir dayanıklılık riskidir; mevcut kullanıcı verisinin bozulduğu gözlenmedi.

**Uygulanan:** DB çıktısı aynı dizinde benzersiz, yalnızca yeni dosya oluşturan geçici dosyaya yazılıyor; dosya senkronize edilip hedefe atomik rename yapılıyor. POSIX'te dizin senkronizasyonu deneniyor; Windows uyumsuzluğu yazımı başarısız kılmıyor ([database.ts](src/main/persistence/database.ts#L93)). Hata halinde eski hedef korunuyor ve geçici dosya temizleniyor.

**Kalan doğrulama:** Geriye dönük yedek/kurtarma yolu eklenmedi. Disk dolması, yazım/rename hatası, uygulamanın kapanması ve Windows'ta hedef değiştirme davranışı test edilmeli; bu turda test paketi çalıştırılmadı.

### P1-5 — Dış bağlantı şeması sınırlandı; webview/CSP sertleştirmesi sürüyor

**İlk tespit:** Yeni pencere isteği URL şeması kontrolü olmadan `shell.openExternal` çağrısına gidiyordu. Ana pencere `sandbox: false` ve `webviewTag: true` kullanıyor; CSP script için `unsafe-inline` ve `unsafe-eval` içeriyor ([index.ts](src/main/index.ts#L100), [index.html](src/renderer/index.html#L7)).

**Uygulanan:** `web-contents-created` seviyesinde popup'lar yalnızca credential içermeyen `http:`/`https:` URL'lerini sistem tarayıcısında açıyor; diğer şemalar reddediliyor. Ana BrowserWindow dış adrese üst-seviye gezinmeyi de engelliyor; uygulama origin'i ve kendi `index.html` dosyası korunuyor ([index.ts](src/main/index.ts#L30)).

**Kalan risk/doğrulama:** `webviewTag` ve `sandbox: false` hâlâ kullanımda; webview gezinme/oluşturma izinleri ve üretim CSP'si ayrıca sertleştirilmeli. `http(s)` popup akışı, OAuth dönüşleri, Vite geliştirme origin'i ve paketlenmiş `file:` açılışı macOS/Windows'ta smoke test edilmeli. Bu turda test paketi çalıştırılmadı.

### P2-1 — Sekreter “tamamlandı” kararı doğrulanmış başarıyla aynı şey değil

**Kanıt:** Yapılandırılmış sonuç işareti yoksa toplayıcı `busy → waiting` görünüm değişimini tamamlanma sayıyor ([result-collector.ts](src/main/secretary/result-collector.ts#L403)). Son değerlendirme modele CLI özeti ve Git anlık görüntüsünü iletiyor; beklenen sonucun karşılandığına dair deterministik kontrol yok ve yedek yanıt tamamlanma cümlesi kuruyor ([service.ts](src/main/secretary/service.ts#L330)). Git dosya değişikliğini gösterebilir; testlerin geçtiğini tek başına kanıtlamaz.

**Etki:** Etkileşimli soru/izin istemi veya eksik iş “tamamlandı” görünebilir. Kullanıcının Sekreter raporuna güveni azalır.

**Öneri:** `doğrulandı / CLI beyanı / belirsiz / kullanıcı bekleniyor` durumlarını ayır. Mümkün olduğunda komut çıkış kodu, test sonucu ve Git kanıtı göster; belirsiz terminal promptunu sessiz başarı sayma.

**Bu turda kısmi iyileştirme:** Rapor artık tamamlanma sinyalinin CLI'nin yapılandırılmış öz-bildirimi mi yoksa terminal-idle sezgisi mi olduğunu sayısal olarak gösteriyor; ikisinin de bağımsız doğrulama olmadığı kullanıcıya açıkça yazılıyor. Son karar modeline de bu ayrım veriliyor ve test/build başarısı için açık çıktı kanıtı şart koşuluyor. İşin gerçekten doğrulanması (komut/çıkış kodu, test kanıtı) ve belirsiz idle durumunun kullanıcı onayına dönüştürülmesi hâlâ yapılmalı. Bu turda test paketi çalıştırılmadı.

### P2-2 — Platform ve arayüz doğrulaması kritik akışların gerisinde

**Kanıt:** CI, Ubuntu'da tip kontrolü + unit test, macOS'ta yalnızca web-chat smoke çalıştırıyor; Windows işi, genel paketleme/build kontrolü veya hesap–Sekreter uçtan uca akışı yok ([ci.yml](.github/workflows/ci.yml#L1)). Paket betiklerinde lint ve coverage eşiği bulunmuyor ([package.json](package.json#L7)). Renderer testleri mevcut olsa da hesap/Sekreter bileşenleri için etkileşim testi görülmedi.

**Öneri:** Windows/macOS paketleme ve açılış smoke; hesap değiştirme/çıkış, worktree izolasyonu, paralel Sekreter onayı/iptali, yeniden başlama kurtarma ve dosya sınırı testlerini CI matrisine koy. Biçim/lint kapısı ekle. Harici CLI servislerini kontrol edilebilir test dublörleriyle, en az bir gerçek platform smoke'uyla destekle.

**Bu turda kısmi iyileştirme:** CI'ye macOS ve Windows üzerinde `npm ci` + üretim renderer/main/preload derlemesi yapan platform matrisi eklendi; workflow izinleri de salt okunur checkout ile sınırlandı. Gerçek paketleme/uygulama açılışı, hesap ve Sekreter uçtan uca senaryoları ile lint/format kapısı henüz eklenmedi. Bu turda test paketi çalıştırılmadı.

### P2-3 — Büyüyen modüller ve ürün belgeleri bakım maliyetini artırıyor

**Kanıt:** [workstation.css](src/renderer/styles/workstation.css) yaklaşık 5.244 satır; [workspace-store.ts](src/renderer/stores/workspace-store.ts), [usage/index.ts](src/main/usage/index.ts) ve [secretary/service.ts](src/main/secretary/service.ts) yüzlerce satırlık çok sorumluluklu dosyalar. [Sekreter plan belgesi](docs/product/2026-09-18_DEVELOPER_SECRETARY_ORCHESTRATION_PLAN.md) ile güncel onay akışı aynı durumda değil; eski dokümandaki “mevcut” ifadeleri güncel davranış yerine kullanılmamalı.

**Öneri:** Önce P0/P1 davranışlarını sabitle; ardından Sekreter yürütme/kurtarma, kullanım sağlayıcıları ve CSS token/bileşen katmanlarını ayır. Ürün belgelerindeki durumları `mevcut / planlanan / kaldırıldı` şeklinde işaretle.

### Bellek, disk ve sohbet devamlılığı incelemesi (2026-09-23)

**Bulgular:** Sekreter açılışındaki 90 günlük temizlik, aktif sohbetlerin mesajlarını ve tamamlanmış işlerini de silebiliyordu. Arayüz yalnızca son 100 mesajı gösteriyor, eski mesajları getirecek yol sunmuyordu. Sonraki model isteği yalnızca son 20 sohbet mesajını alıyor; CLI son raporları bu bağlama girmiyordu. `sql.js` bütün veritabanını RAM'de tutup kayıt sırasında dışa aktarıyor; yinelenen snapshot ve bekleyen zamanlayıcı aynı DB'nin yeniden yazılmasına neden olabiliyordu. Kalıcı terminalin 120.000 karakterlik çıktısı hem PTY ana işleminde hem uygulama ana işleminde saklanıyordu. Pencere kapanırken renderer'ın asenkron son kaydı beklenmiyordu.

ChatGPT ve Claude web chat bölmeleri zaten kalıcı Electron partition kullanıyor ([web-chat-runtime.ts](src/renderer/lib/web-chat-runtime.ts)); bu servislerin sunucudaki sohbet geçmişini Bikorch yönetmiyor.

**Uygulanan:** Sohbet mesajları ve iş kayıtları yaş nedeniyle artık otomatik silinmiyor; 90 günden sonra yalnızca tamamlanmış işlerin `plan_json` ile tekrarlanan atama ve onay satırları temizleniyor. Geçmiş 100 mesajlık sayfalarla açılıyor, ilgili iş kayıtları istek başına sınırlı yükleniyor. Son raporlar model bağlamına giriyor; sohbet başına redakte edilmiş, 2.000 karakterle sınırlı devamlılık özeti tutuluyor. Model geçmişi son 20 ilgili mesaj ve mesaj başına 2.400 karakterle sınırlı. Aynı workspace snapshot'ı tekrar geldiğinde tam DB dışa aktarımı atlanıyor; başarılı yazım bekleyen zamanlayıcıyı kapatıyor, disk hatası renderer'a iletiliyor. Yoğun arayüz değişiklikleri 2, küçük DB yazımları 3 saniyeden uzun ertelenmiyor. Normal pencere kapanışı son kaydı 2 saniyeye kadar bekliyor; açılışta zaman aşımına uğrayan yükleme daha sonra fallback çalışma alanını ezemiyor. Kalıcı terminalin ana işlemdeki ikinci çıktı kopyası 8.000 karaktere indirildi; PTY host'taki tam yeniden bağlanma tamponu ve renderer'a yeniden oynatma korunuyor. Profil > Runtime paneli DB dosya boyutunu ve henüz diske aktarılmamış değişiklik durumunu gösteriyor.

**Ölçüm sınırı:** Yerel geliştirme klasörü yaklaşık 888 MB; bunun 823 MB'ı `node_modules`, 30 MB'ı derleme çıktısıydı. Bunlar kurulu uygulamanın kullanıcı veri boyutu değildir. Gerçek kullanıcı DB'si veya paketlenmiş uygulama üzerinde bellek profili bu turda ölçülmedi. `sql.js` mimarisi nedeniyle tam DB RAM kullanımı ve dışa aktarım tepe belleği sürüyor; büyük veri hacminde yerel SQLite/WAL geçişi ayrıca değerlendirilmeli. İki saniyelik kapanış süresinde renderer yanıt vermezse son 400 ms'lik henüz gönderilmemiş arayüz değişikliği kaybolabilir; disk hatasında kaydın başarılı olduğu iddia edilmez. Önceden 90 günlük temizlikle silinmiş sohbetler bu değişiklikle geri gelmez.

## Önerilen uygulama sırası

1. **Güven sınırı:** Dosya erişiminde TOCTOU'ya dayanıklı açma yöntemini belirle ve IPC/symlink sınırlarını test et; Sekreter worktree akışını macOS/Windows gerçek CLI smoke ile tamamla.
2. **Gerçek yürütme ve Sekreter:** Sahte başarı kapatıldı; güvenli otomasyon yürütücüsü ile ağ/izin/iptal davranışı henüz yok. Sekreterin dispatch öncesi takip düzeltmesini hızlı structured sonuç ve kısmi hata testleriyle doğrula; raporda doğrulama seviyesini kullanıcıya göster.
3. **Oturum ve veri güvenilirliği:** Sekreter–PTY yeniden bağlanma/kesinti akışını, hesap kaldırma semantiğini ve atomik DB yazımını tamamla.
4. **Çapraz platform yayın kapısı:** Windows/macOS paketleme ve hesap/CLI smoke testlerini CI'ya ekle; Electron URL/CSP politikasını daralt; belgeleri güncelle.

**Yayın kararı önerisi:** P0-2 için güvenli dosya açma ve sınır testleri tamamlanmadan dosya erişimi güven sınırını tam kapanmış saymayın. P0-3'te sahte başarı yolu kaldırıldı, ancak gerçek yürütücü gelene dek otomasyon çalıştırma özelliği hazır değildir. P0-1 kod düzeyinde giderildi; platformda gerçek CLI doğrulaması tamamlanmadan tam güvence verilmemeli. Diğer maddelerin uygulanması ayrıca gerekir.
