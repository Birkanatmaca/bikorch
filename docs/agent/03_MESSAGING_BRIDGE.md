# 03 — Messaging Bridge

**Decision date:** 2026-09-14  
**Status:** Product + interaction design  
**Module:** Bikorch Agent · Messaging

---

## 1. Outcome

Messaging Bridge, kullanıcı ile Agent Core arasında komut/prompt taşıyan ince adaptör katmanıdır.

v1 kanalı: **Telegram Bot API**.  
v1.1+ aday: WhatsApp Cloud API.  
Unofficial WhatsApp web scrapers v1 kapsamında **yasak**.

---

## 2. Design principles

1. Bridge iş yapmaz; Core’a domain komutu iletir.
2. Her mesaj önce auth/allowlist’ten geçer.
3. Cevaplar kısa, mobil-first ve aksiyon odaklıdır.
4. Uzun terminal dump varsayılan cevap değildir.
5. Slash komutlar keşfedilebilir; serbest text focused session’a prompt olur.

---

## 3. Telegram first

### 3.1 Neden Telegram?

- Bot komutları native
- Kurulum hızlı
- Long-poll ile public inbound port gerekmez
- Allowlist kolay
- Dosya/log gönderme opsiyonu var

### 3.2 Connection mode

Varsayılan: **long polling**

- VPS’te webhook/TLS zorunluluğu yok
- Firewall sade kalır

Opsiyonel: webhook (domain + TLS varsa)

### 3.3 Identity binding

Agent config:

```text
TELEGRAM_BOT_TOKEN=...
TELEGRAM_ALLOWED_USER_IDS=123,456
TELEGRAM_ALLOWED_CHAT_IDS=-100...   # opsiyonel
```

Allowlist dışı her mesaj:

- ignore veya “unauthorized” tek satır
- asla komut çalıştırma

---

## 4. Conversation context

Her allowlisted chat için `ChatBinding`:

| Alan | Anlam |
| --- | --- |
| `focusedProjectId` | `/use` ile seçilen proje |
| `focusedSessionId` | `/focus` ile seçilen CLI session |
| `promptMode` | `on` ise serbest text prompt olur |
| `pendingConfirm` | tehlikeli işlem onayı |

Context chat-scoped’dur. Farklı chat’ler birbirinin focus’unu paylaşmaz.

---

## 5. Command surface (v1)

### 5.1 Discovery & health

| Komut | İş |
| --- | --- |
| `/start` | karşılama + kısa yardım |
| `/help` | komut listesi |
| `/whoami` | telegram user id, allowlist durumu |
| `/agentstatus` | uptime, sessions, focus özeti |
| `/health` | db / disk / cli detect özeti |

### 5.2 Projects

| Komut | İş |
| --- | --- |
| `/projects` | kayıtlı projeleri listeler |
| `/use <name\|id>` | aktif proje seçer |
| `/project` | aktif proje detayı |
| `/clone <git-url> [name]` | clone + register |
| `/register <path> [name]` | mevcut path’i kaydet |

### 5.3 Accounts

| Komut | İş |
| --- | --- |
| `/accounts` | bağlı CLI hesapları |
| `/account <provider>` | provider durum detayı |
| `/login <provider>` | bootstrap login talimatı / status |

Not: Tam interaktif OAuth çoğu zaman sunucu shell’inde bir kez yapılır; bot “login link/status” gösterir.

### 5.4 Sessions

| Komut | İş |
| --- | --- |
| `/cursorcli` | focused projede Cursor session aç |
| `/claude` | Claude Code session aç |
| `/codex` | Codex session aç |
| `/sessions` | açık session listesi |
| `/focus <sessionId\|alias>` | aktif session seç |
| `/stop` | focused session’ı durdur |
| `/stop <id>` | belirli session’ı durdur |
| `/killall` | (confirm) tüm session’ları kapat |

### 5.5 Prompting

| Komut | İş |
| --- | --- |
| `/prompt <text>` | focused session’a prompt gönder |
| `/promptmode on\|off` | serbest text = prompt |
| `/status` | focused run/session durumu + kısa output |
| `/logs` | son bounded log / artifact link-özet |

`promptmode on` iken `/` ile başlamayan mesajlar prompt kabul edilir.

### 5.6 Git delivery

| Komut | İş |
| --- | --- |
| `/diff` | kısa diff istatistik / özet |
| `/gitstatus` | branch + dirty state |
| `/commit <message>` | stage relevant + commit |
| `/push` | current branch push |
| `/pr [title]` | gh ile PR (opsiyonel, feature flag) |

### 5.7 Safety

| Komut | İş |
| --- | --- |
| `/confirm` | pending destructive action’ı onayla |
| `/cancel` | pending action iptal |
| `/danger on\|off` | tehlikeli mod (ek policy) |

---

## 6. Example conversation

```text
user: /projects
bot: 1) api-server
     2) bikorch
     Active: (none)

user: /use api-server
bot: Focused project: api-server (/var/lib/bikorch-agent/workspaces/api-server)

user: /cursorcli
bot: Session s1 started (cursor) · status=idle
     Focused session: s1

user: auth middleware ekle, jwt doğrulama ve unit test yaz
bot: Run r12 queued on s1 ✅
     status=running

user: /status
bot: s1 running · r12
     … last lines …
     (truncated)

user: /commit feat: add jwt auth middleware
bot: Committed 3 files · a1b2c3d

user: /push
bot: Pushed origin/feat-jwt-auth
```

---

## 7. Reply formatting rules

- İlk satır: sonuç / durum
- Sonra 3–12 satır faydalı detay
- 4000+ karakter Telegram limitine yaklaşınca truncate + “use /logs”
- Markdown sparingly (komutlar copy-friendly plain text)
- Hata mesajları aksiyon önerir (`/accounts`, `/login cursor`, `/use ...`)

---

## 8. Prompt safety UX

Prompt kabul edilmeden:

1. allowlist OK
2. focused session var
3. session alive
4. aynı session’da başka aktif run yok (veya queue policy)

Aksi halde bot redder, sessizce yutmaz.

---

## 9. WhatsApp (later)

Aynı Core komutları; farklı adapter.

Farklar:

- slash komut UX zayıf → button / list message
- Cloud API onboarding ve business doğrulama gerekir
- media/log gönderimi ayrı mapping

v1’de WhatsApp dokümante edilir ama implement edilmez.

---

## 10. Adapter interface (logical)

```ts
interface MessagingAdapter {
  start(): Promise<void>
  stop(): Promise<void>
  onCommand(handler: (ctx: CommandContext) => Promise<void>): void
  reply(chatId: string, message: string): Promise<void>
}
```

`CommandContext`:

- channel, chatId, userId
- rawText
- command / args
- binding (focus state)

---

## 11. Anti-abuse

- allowlist hard gate
- rate limit per chat (örn. 20 cmd/dk)
- confirm window timeout (örn. 60s)
- secret içeren output redaksiyonu (token/key pattern)
- unknown command → kısa help, execution yok
