# Proje merkezi ve çalışma alanı yenilemesi

## Tamamlandı

- Kullanıcının isteğiyle Open Project ekranı önceki tasarımına geri alındı: merkezde logo, Open project / New project kartları, eski arka plan ve Recent projects listesi. Uygulama içindeki tasarım ve dosya erişimi düzeltmeleri korundu.
- Kayıtlı açık projelere dönüş sağlayan proje merkezi. Üstteki Bikorch logosuyla açılır; çalışma alanı ve CLI oturumları kapatılmaz.
- Yenilenen CLI başlangıç kartları, dosya paneli, yan panel yüzeyleri ve okunabilir boş/hata durumları.
- Dar ekranlarda iki sütunlu CLI kartları, ayrı satırda proje sekmeleri ve altta gezinme. Açılış ekranında önceki duyarlı yerleşim kullanılıyor.
- Dokunmatik kontrol boyutları, güvenli ekran kenarları ve azaltılmış hareket tercihi desteği.

## Dosya erişimi düzeltmeleri — tamamlandı

1. **Proje kaydı yarışı:** Yeni projenin kalıcı kaydı 400 ms gecikiyordu; dosya paneli bu sırada ana süreçte henüz bulunmayan proje kimliğiyle okuma yapabiliyordu. Proje değişiklikleri artık hemen kaydediliyor; okuma, yazma ve arama işlemleri devam eden kaydın tamamlanmasını bekliyor. Ana süreçteki proje kökü ve dizin sınırı kontrolleri korunuyor.
2. **Boş/hatalı alt klasör döngüsü:** Boş listeyi “henüz yüklenmedi” sayan etki kaldırıldı. Boş klasör açıkça gösteriliyor; hatada sadece kullanıcı isteğiyle yeniden deneniyor.
3. **Eski yanıtlar:** Proje veya kök klasör değişince panel durumu sıfırlanıyor. Eski isteklerin geç gelen yanıtları yeni projenin listesine yazılmıyor.
4. **Kurtarma:** Ham IPC hatası yerine açıklama, yeniden deneme ve aynı projenin taşınan klasörünü yeniden bağlama seçenekleri var. Arama hataları artık “sonuç yok” gibi gösterilmiyor.
5. **Başlangıç verisi:** React StrictMode etkileri yeniden başlatırken, yükleme tamamlanmadan boş başlangıç durumunun diske yazılması engellendi.

## Doğrulama

- `npm run typecheck`: geçti.
- `npm run build`: geçti; mevcut paket boyutu/statik-dinamik içe aktarma uyarıları sürüyor.
- Odaklı testler: 8/8 geçti (kayıt bekleme, yeni kök değişikliği, kayıt hatası/kurtarma, kullanıcı mesajları, ana sayfa durumu ve mevcut izolasyon/başlangıç testleri).
- `npm run test:smoke:studio`: gerçek React bileşenleriyle gizli Electron penceresinde 1280×900, 768×1024, 390×844 ve 360×740 ölçülerini kontrol eder. Klasör seçimini iptal etme/açma, gecikmeli kayıt, boş ve hatalı alt klasör, yeniden deneme, taşınmış kökü yeniden bağlama, hızlı proje değiştirme, ana sayfaya dönüş ve StrictMode başlangıcı test edilir. Ekran görüntüleri geçici klasöre kaydedilir.
- Tam test çalıştırması: **439 geçti, 5 başarısız**. Değiştirilmeyen test alanları: `filesystem/files.test.ts` (Windows mutlak yol beklentisi), `git/worktrees.test.ts` (iki test; yol eşleşmesi ve zaman aşımı/kilit), `git/reconcile.test.ts` ve `git/isolation.test.ts` (worktree kayıt beklentileri). Bu yenileme Git/worktree uygulamasını değiştirmiyor.

## Kapsam sınırı

Bu çalışma Electron uygulamasının duyarlı arayüz tasarımıdır; native iOS/Android paketi değildir. Görsel/akış smoke testi sahte IPC ve gecikmeli bellek içi kayıt kullanır; gerçek kullanıcı klasörlerine, hesaplarına veya CLI süreçlerine dokunmaz. Paketlenmiş uygulamada gerçek klasör ve CLI oturumlarıyla son kullanıcı kontrolü ayrıca yapılmalıdır. Git/worktree test hataları ayrı inceleme gerektirir.
