# 01 — Vision and Scope

**Decision date:** 2026-09-14  
**Status:** Approved product direction for planning  
**Module:** Bikorch Agent

---

## 1. Outcome

Bikorch Agent, sunucuya kurulabilen headless bir coding runner’dır.

Kullanıcı:

- CLI hesaplarını bağlar
- proje açar / seçer
- messaging (önce Telegram) üzerinden prompt gönderir
- Agent’ın CLI’ya işi yaptırmasını sağlar
- sonucu Git’e commit / push eder

Laptop kapalı olsa bile sistem çalışır.

---

## 2. Problem

Bugün Bikorch güçlü bir **masaüstü workspace**. Ama:

- cihaz uykuya giderse / kapanırsa runner ölür
- dışarıdayken “şu projeye şu prompt’u at” ihtiyacı karşılanmaz
- messaging kanalları (Telegram vb.) native bir kontrol yüzeyi değildir

Kullanıcı always-on, uzaktan yönetilebilir bir motor istiyor.

---

## 3. Product thesis

> Messaging = kumanda.  
> Agent = motor.  
> CLI = işçi.  
> Git = teslimat.

Kullanıcı telefonundan konuşur; sunucu kod yazar; Git sonucu taşır.

---

## 4. Primary user journey (happy path)

```text
1. Agent sunucuda çalışıyor
2. Kullanıcı Telegram’da /projects yazar
3. /use my-api ile proje seçer
4. /cursorcli ile Cursor CLI session açar
5. "auth middleware ekle ve test yaz" diye prompt atar
6. Agent session’a prompt’u basar ve çalışmayı izler
7. /status ile özet alır
8. /commit "feat: add auth middleware"
9. /push
10. İsteğe bağlı /pr
```

---

## 5. In scope (v1)

### 5.1 Runtime

- Headless Node.js daemon (Electron GUI yok)
- Linux sunucu öncelikli kurulum
- systemd servis olarak ayakta kalma
- SQLite persistence
- Structured run history + bounded logs

### 5.2 Accounts

- Desteklenen CLI provider’lara hesap bağlama
- Provider bazlı credential / profile referansı
- Hesap durumu: connected / needs_login / error

### 5.3 Projects

- Local path register
- Git clone by URL
- Active project context per chat / user
- Default branch awareness

### 5.4 Sessions & prompts

- Provider CLI session başlatma (`cursor`, `claude`, `codex` …)
- Aktif session seçme (`/focus`)
- Prompt gönderme
- Run status (idle / running / needs_input / failed / done)
- Bounded output snapshot

### 5.5 Git delivery

- status / diff özeti
- commit (mesajlı)
- push
- opsiyonel PR create (gh)

### 5.6 Messaging

- Telegram bot (allowlisted user/chat)
- Slash komutlar + serbest prompt modu
- Kısa status cevapları

---

## 6. Out of scope (v1)

- Full Bikorch Electron UI’nin sunucuda koşması
- WhatsApp entegrasyonu (v1.1+ aday)
- Multi-user SaaS / takım workspace
- Public internet’te auth’suz açık port
- Tam IDE deneyimi (Monaco, tiled panels, music, vs.)
- Her provider’ın tüm interaktif UX’ini birebir simüle etmek
- Otomatik “her şeyi production’a deploy et”
- Billing / subscription sistemi

---

## 7. Non-goals

Agent bir chat GPT ürünü değildir.  
Agent bir CI SaaS değildir.  
Agent “prompt’u kendi modelinde çalıştıran” bir LLM gateway değildir.

Agent, **kullanıcının kendi CLI hesaplarıyla** sunucuda kod üreten bir orkestratördür.

---

## 8. Success metrics (qualitative v1)

- Kurulum < 30 dk (dokümana bakarak)
- Telegram’dan ilk prompt < 5 dk (hesap bağlıysa)
- Laptop kapalıyken en az 1 uçtan uca commit+push
- Allowlist dışı kullanıcı komut çalıştıramaz
- Crash sonrası systemd ile ayağa kalkar; state bozulmaz

---

## 9. Relationship to Desktop Automation

Desktop Automation (`docs/product/2026-09-11_AUTOMATION_SYSTEM.md`):

- lokal makine
- schedule
- tray / background window lifecycle

Bikorch Agent:

- sunucu
- remote messaging
- always-on daemon

Ortak kavramlar (executor, worktree, run history) bilinçli olarak benzer tutulur; kod paylaşımı ileride opsiyoneldir. v1’de ayrı paket / ayrı process varsayılır.

---

## 10. Naming

| İsim | Anlam |
| --- | --- |
| **Bikorch Agent** | Ürün / daemon adı |
| **Messaging Bridge** | Telegram (ve sonra WP) adaptör katmanı |
| **Session** | Bir CLI process oturumu |
| **Run** | Bir prompt’un yürütülmesi |
| **Workspace root** | Agent’ın yönettiği projelerin kök dizini |
| **Focus** | Aktif proje veya aktif session bağlamı |

Paket / binary önerisi: `bikorch-agent`

---

## 11. Decision summary

| Karar | Seçim |
| --- | --- |
| UI | Yok (headless) |
| İlk kanal | Telegram |
| İlk platform | Linux VPS / dedicated |
| Auth modeli | Allowlist + bot token + local API token |
| Git teslimatı | Commit + push (PR opsiyonel) |
| Desktop bağımlılığı | v1’de yok |
