# 02 — Architecture

**Decision date:** 2026-09-14  
**Status:** Target architecture for Bikorch Agent  
**Module:** Bikorch Agent

---

## 1. High-level diagram

```text
┌─────────────────────────────────────────────────────────────┐
│                     Messaging Clients                        │
│              Telegram Bot  ·  (later WhatsApp)               │
└─────────────────────────────┬───────────────────────────────┘
                              │ commands / prompts
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                 Messaging Bridge Adapter                     │
│        parse commands · auth allowlist · reply format        │
└─────────────────────────────┬───────────────────────────────┘
                              │ domain commands
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      Agent Core                              │
│  projects · sessions · runs · git · accounts · policy        │
└───┬───────────────┬───────────────┬───────────────┬─────────┘
    │               │               │               │
    ▼               ▼               ▼               ▼
 CLI Adapters   Git Service    Persistence     Local API
 (cursor/…)     (status/       (SQLite)        (HTTP/WS
                 commit/push)                   optional)
    │
    ▼
 Provider CLI processes (PTY or non-interactive executor)
    │
    ▼
 Project workspaces / worktrees on disk
```

---

## 2. Process model

Tek uzun ömürlü process:

```text
bikorch-agent
```

İçinde logical servisler:

| Servis | Sorumluluk |
| --- | --- |
| `ConfigService` | env + config dosyası |
| `PersistenceService` | SQLite schema / migrations |
| `AccountService` | CLI hesap kayıtları ve durum |
| `ProjectService` | register / clone / list / focus |
| `SessionService` | CLI process lifecycle |
| `RunService` | prompt submit + status tracking |
| `GitService` | status / diff / commit / push / pr |
| `PolicyService` | allowlist, confirm gates, dangerous mode |
| `MessagingBridge` | Telegram adaptörü |
| `ApiServer` | opsiyonel local/remote HTTP-WS |
| `HealthService` | liveness, disk, CLI availability |

Electron main process yoktur. GUI yoktur.

---

## 3. Suggested repository layout (future package)

Agent ya monorepo içinde ayrı paket olur, ya da `agent/` klasörü:

```text
agent/
├── package.json
├── README.md
├── src/
│   ├── index.ts                 # entrypoint
│   ├── config/
│   ├── persistence/
│   ├── accounts/
│   ├── projects/
│   ├── sessions/
│   ├── runs/
│   ├── git/
│   ├── policy/
│   ├── messaging/
│   │   ├── telegram/
│   │   └── types.ts
│   ├── api/
│   ├── cli/
│   │   ├── adapters/
│   │   └── executor.ts
│   └── health/
├── migrations/
├── systemd/
│   └── bikorch-agent.service
└── docs/                        # bu plan klasörüne referans
```

v1 implementasyonu bu tree’ye yaklaşmalıdır. Desktop `src/main` kodunu körlemesine import etmek zorunda değildir; domain fikirleri taşınır.

---

## 4. Execution modes

### 4.1 Interactive PTY mode

Telegram’dan “session aç → prompt bas” senaryosu için:

- Provider CLI bir PTY’de açılır
- Prompt bracketed paste + CR ile gönderilir (Desktop’taki `submitCliPrompt` modeli)
- Output ring-buffer’da tutulur
- `/status` son N satırı / özeti döner

### 4.2 Non-interactive executor mode (tercih edilen olgun yol)

Automation sistemindeki gibi:

- provider-specific headless adapter
- tek prompt = tek run
- exit code + log artifact
- daha az “CLI menüde takıldı” riski

**v1 kararı:**

- Session UX için PTY mode şart (kullanıcı deneyimi)
- Güvenilir otomasyon / commit öncesi doğrulama için executor mode paralel tasarlanır
- İlk çalışan dilim: **PTY + prompt submit**
- Stabilite dilimi: **executor adapters**

---

## 5. State model (core entities)

```text
Account
  id, provider, label, status, credentialRef, createdAt

Project
  id, name, path, remoteUrl, defaultBranch, createdAt

Session
  id, projectId, accountId, provider, pid, status, createdAt, lastActiveAt

Run
  id, sessionId, prompt, status, startedAt, finishedAt, summary

GitAction
  id, projectId, type(commit|push|pr), status, metadata, createdAt

ChatBinding
  channel(telegram), chatId, userId, focusedProjectId, focusedSessionId
```

Focus, mesaj kanalı bazında tutulur: aynı Telegram chat’inin “aktif proje / aktif session” bağlamı vardır.

---

## 6. Data flow — send prompt

```text
Telegram message
  → allowlist check
  → resolve ChatBinding.focusSession
  → RunService.create(prompt)
  → SessionService.writePrompt(sessionId, prompt)
  → CLI process consumes prompt
  → output tail captured
  → Run status updates
  → Bridge replies with ack + short status
```

## 7. Data flow — open CLI

```text
/cursorcli
  → require focused project
  → resolve default/selected account for provider
  → SessionService.spawn(provider, projectPath, account)
  → set focusedSessionId
  → reply session id + status
```

## 8. Data flow — git push

```text
/push
  → require focused project
  → PolicyService.confirm if needed
  → GitService.status
  → if clean: reply no-op
  → else push current branch
  → reply remote result / URL
```

Commit ayrı komuttur; sessiz auto-commit v1 default’u değildir.

---

## 9. Persistence

- Engine: SQLite (Desktop’taki sql.js / better-sqlite benzeri yaklaşım; Agent’ta native `better-sqlite3` tercih edilebilir)
- Migrations versioned
- Secrets DB’de plaintext tutulmaz; OS keychain yoksa encrypted file veya env/file ref

Bounded logs:

- session output ring buffer (örn. son 200–500 KB)
- run summary text (kısa)
- raw dump opsiyonel disk artifact (`/var/lib/bikorch-agent/runs/...`)

---

## 10. Networking

Varsayılan güvenlik duruşu:

- Telegram: Bot API üzerinden outbound long-poll (inbound public port gerekmez)
- Local API: `127.0.0.1` only (opsiyonel)
- Remote API: kapalı (v1.x feature flag + TLS + token)

Bu sayede VPS firewall’da ekstra açılış olmadan Telegram kontrolü mümkün olur.

---

## 11. Concurrency rules

- Aynı session’a aynı anda tek aktif run
- Aynı proje için çakışan destructive git action’lar serialize edilir
- Bir chat’in tek focused session’ı vardır
- Birden fazla session açılabilir; focus ile seçilir
- Provider rate-limit / busy durumları Run status’e yansır

---

## 12. Failure model

| Durum | Davranış |
| --- | --- |
| CLI binary yok | spawn fail + net hata |
| Account needs login | session start blocked + bootstrap talimatı |
| Prompt sırasında process öldü | run=`failed`, session=`dead` |
| Git push rejected | action=`failed`, remote mesajı kısaltılmış döner |
| Agent crash | systemd restart; incomplete runs=`interrupted` |
| Network yok | Telegram queue/retry; local work devam edebilir |

Interrupted run otomatik replay edilmez (Desktop automation ile aynı güvenlik refleksi).

---

## 13. Observability

Minimum:

- structured logs (json lines)
- `/health` (process up, db ok, disk ok)
- `/agentstatus` bot komutu (uptime, active sessions, focused project)
- run history query

---

## 14. Extensibility seams

Yeni kanal eklemek = yeni Messaging adapter.

Yeni CLI eklemek = yeni provider adapter (`detect`, `spawn`, `submit`, `shutdown`).

Yeni teslimat = GitService method / policy gate.

Core domain kanal bilmez; Telegram bilmez “commit nasıl yapılır”.
