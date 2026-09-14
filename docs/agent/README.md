# Bikorch Agent — Dokümantasyon İndeksi

**Karar tarihi:** 2026-09-14  
**Durum:** Ürün / mimari plan (henüz implement edilmedi)  
**Öncelik:** P0 — Always-on remote coding runner  
**Hedef kitle:** Ürün sahibi + implementasyon agent’ları

---

## Bu klasör nedir?

Bu klasör, **Bikorch Agent** için sunucuya kurulabilir, 7/24 çalışan, Telegram (ve ileride WhatsApp) üzerinden yönetilebilen headless coding runner planını içerir.

Agent, Electron masaüstü uygulamasının yerine geçmez.  
Desktop Bikorch = yerel workspace UI.  
**Bikorch Agent = sunucuda sürekli çalışan motor.**

---

## Doküman haritası

| Dosya | Konu |
| --- | --- |
| [`01_VISION_AND_SCOPE.md`](./01_VISION_AND_SCOPE.md) | Ürün vizyonu, amaç, kapsam / kapsam dışı |
| [`02_ARCHITECTURE.md`](./02_ARCHITECTURE.md) | Sistem mimarisi, bileşenler, veri akışı |
| [`03_MESSAGING_BRIDGE.md`](./03_MESSAGING_BRIDGE.md) | Telegram / WhatsApp komut modeli ve köprü |
| [`04_CLI_ACCOUNTS_AND_SESSIONS.md`](./04_CLI_ACCOUNTS_AND_SESSIONS.md) | CLI hesap bağlama, session yaşam döngüsü |
| [`05_PROJECTS_AND_GIT.md`](./05_PROJECTS_AND_GIT.md) | Proje açma, worktree, commit / push / PR |
| [`06_SECURITY.md`](./06_SECURITY.md) | Auth, allowlist, tehlikeli işlem politikası |
| [`07_DEPLOYMENT.md`](./07_DEPLOYMENT.md) | Sunucu kurulumu, systemd, env, operasyon |
| [`08_API_AND_COMMANDS.md`](./08_API_AND_COMMANDS.md) | HTTP/WS API + bot komut sözleşmesi |
| [`09_ROADMAP_AND_PHASES.md`](./09_ROADMAP_AND_PHASES.md) | Fazlar, DoD, ilk implementasyon sırası |

Okuma sırası: `01 → 02 → 03 → 04 → 05 → 06 → 07 → 08 → 09`.

---

## Tek cümlelik ürün tanımı

> Kullanıcı Telegram’dan komut atar; sunucudaki Bikorch Agent CLI hesabıyla projeyi açar, prompt’u çalıştırır ve sonucu Git’e push’lar.

---

## Desktop Bikorch ile ilişki

| Konu | Desktop Bikorch | Bikorch Agent |
| --- | --- | --- |
| Platform | macOS / Windows Electron UI | Linux (öncelik) / macOS headless daemon |
| Çalışma | Kullanıcı oturumu açıkken | 7/24 süreç |
| Giriş | GUI + terminal | Telegram / API |
| Kod konumu | Lokal disk | Sunucu workspace |
| Ortak nokta | CLI adaptörleri, Git, worktree fikirleri | Aynı domain kavramları, ayrı process |

İleride Desktop, Agent’a opsiyonel remote client olarak bağlanabilir. v1’de zorunlu değildir.

---

## Temel başarı kriteri (v1)

Kullanıcı şunu yapabilmeli:

1. Sunucuya Agent kurar
2. CLI hesabını bağlar
3. Bir repo clone / register eder
4. Telegram’dan `/cursorcli` ile session açar
5. Prompt gönderir
6. Agent işi bitirir
7. `/push` ile commit + push yapar
8. Laptop kapalı olsa bile bu döngü çalışır

---

## Bilinçli sınırlar (v1)

- Full Electron UI sunucuda koşturulmaz
- WhatsApp v1’de yok (Telegram first)
- Multi-tenant SaaS yok (tek kullanıcı / tek allowlist)
- İnteraktif CLI login akışları mümkün olduğunca bootstrap’e sıkıştırılır
- “Her CLI her ortamda kusursuz çalışır” garantisi verilmez; adapter bazlı destek listesi tutulur

---

## İlgili mevcut dokümanlar

- `docs/product/2026-09-11_AUTOMATION_SYSTEM.md` — lokal schedule/automation (Desktop)
- `docs/product/2026-09-07_PRODUCT_ROADMAP.md` — Desktop ürün yönü
- `AI_DEVELOPER_WORKSPACE_PROJECT.md` — Desktop workspace brief

Agent ile Desktop Automation **aynı şey değildir**:

- Desktop Automation = lokal makinede zamanlanmış işler
- Agent = sunucuda uzaktan tetiklenen always-on runner
