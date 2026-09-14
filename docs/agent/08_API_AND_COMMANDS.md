# 08 — API and Commands Contract

**Decision date:** 2026-09-14  
**Status:** Contract draft for implementation  
**Module:** Bikorch Agent · Bot commands + optional HTTP API

---

## 1. Purpose

Bu doküman, Messaging Bridge ile Agent Core arasındaki sözleşmeyi ve opsiyonel HTTP/WS API’yi sabitler.

Kural:

- Bot komutları Core use-case’lerini çağırır
- HTTP API aynı use-case’leri çağırır
- İki yüzey davranışı drift etmemeli

---

## 2. Canonical bot commands (v1 freeze list)

### 2.1 Meta

| Command | Args | Result |
| --- | --- | --- |
| `/start` | — | welcome |
| `/help` | — | command list |
| `/whoami` | — | user/chat ids + auth |
| `/health` | — | liveness summary |
| `/agentstatus` | — | focus + sessions + uptime |

### 2.2 Projects

| Command | Args | Result |
| --- | --- | --- |
| `/projects` | — | list |
| `/use` | `<name\|id>` | set focused project |
| `/project` | — | focused project detail |
| `/clone` | `<git-url> [name]` | clone+register |
| `/register` | `<abs-path> [name]` | register path |

### 2.3 Accounts

| Command | Args | Result |
| --- | --- | --- |
| `/accounts` | — | list |
| `/account` | `<provider>` | detail |
| `/login` | `<provider>` | bootstrap guidance/status |

### 2.4 Sessions

| Command | Args | Result |
| --- | --- | --- |
| `/cursorcli` | `[--worktree]` | spawn cursor session |
| `/claude` | `[--worktree]` | spawn claude session |
| `/codex` | `[--worktree]` | spawn codex session |
| `/sessions` | — | list sessions |
| `/focus` | `<session>` | set focused session |
| `/stop` | `[session]` | stop focused/id |
| `/killall` | — | confirm + stop all |

### 2.5 Runs / prompt

| Command | Args | Result |
| --- | --- | --- |
| `/prompt` | `<text...>` | create run on focused session |
| `/promptmode` | `on\|off` | free-text prompt toggle |
| `/status` | — | session/run status + tail |
| `/logs` | — | bounded logs |
| `/say` | `<text...>` | raw write to session (needs_input helper) |

### 2.6 Git

| Command | Args | Result |
| --- | --- | --- |
| `/gitstatus` | — | status summary |
| `/diff` | — | diff stat |
| `/commit` | `<message...>` | commit |
| `/push` | — | push |
| `/pr` | `[title...]` | create PR if enabled |

### 2.7 Safety

| Command | Args | Result |
| --- | --- | --- |
| `/confirm` | — | confirm pending |
| `/cancel` | — | cancel pending |
| `/danger` | `on\|off` | dangerous mode |

Serbest text: `promptmode=on` ise `/prompt <text>` ile eşdeğer.

---

## 3. Core use-cases (internal API)

Implementasyon isimleri önerisi:

```text
health.get()
agent.getStatus(chatRef)

projects.list()
projects.use(chatRef, projectRef)
projects.getFocused(chatRef)
projects.clone(url, name?)
projects.register(path, name?)

accounts.list()
accounts.get(provider)
accounts.loginHelp(provider)

sessions.open(chatRef, provider, opts)
sessions.list(chatRef)
sessions.focus(chatRef, sessionRef)
sessions.stop(sessionRef)
sessions.killAll(chatRef)

runs.prompt(chatRef, text)
runs.status(chatRef)
runs.logs(chatRef)
sessions.say(chatRef, text)

git.status(projectRef)
git.diff(projectRef)
git.commit(projectRef, message)
git.push(projectRef)
git.pr(projectRef, title?)

policy.confirm(chatRef)
policy.cancel(chatRef)
policy.setDanger(chatRef, boolean)
```

Her use-case:

- auth context alır
- typed result döner (`ok` / `errorCode` / `message` / `data`)
- audit log yazar

---

## 4. Error code catalog (v1)

| Code | Meaning |
| --- | --- |
| `UNAUTHORIZED` | allowlist fail |
| `NO_FOCUSED_PROJECT` | `/use` gerekli |
| `NO_FOCUSED_SESSION` | `/focus` veya open gerekli |
| `SESSION_BUSY` | aktif run var |
| `SESSION_DEAD` | session usable değil |
| `ACCOUNT_NEEDS_LOGIN` | provider auth eksik |
| `PROVIDER_NOT_FOUND` | binary/adapter yok |
| `PROJECT_NOT_FOUND` | unknown project |
| `GIT_CLEAN` | commit/push no-op |
| `GIT_BLOCKED_PROTECTED` | policy block |
| `CONFIRM_REQUIRED` | `/confirm` bekleniyor |
| `CONFIRM_EXPIRED` | timeout |
| `NOT_ENABLED` | feature flag kapalı |
| `INTERNAL` | unexpected |

Bot bu kodları insan diline çevirir.

---

## 5. Optional HTTP API (v1.x)

Default: disabled.

### 5.1 Auth

```http
Authorization: Bearer <API_TOKEN>
```

### 5.2 Endpoints (mirror)

```text
GET  /v1/health
GET  /v1/status

GET  /v1/projects
POST /v1/projects/clone
POST /v1/projects/register
POST /v1/projects/focus

GET  /v1/accounts

POST /v1/sessions
GET  /v1/sessions
POST /v1/sessions/focus
POST /v1/sessions/stop

POST /v1/runs
GET  /v1/runs/current
GET  /v1/runs/logs

GET  /v1/git/status
GET  /v1/git/diff
POST /v1/git/commit
POST /v1/git/push
POST /v1/git/pr
```

### 5.3 WebSocket (optional)

```text
WS /v1/sessions/:id/stream
```

Events: `output`, `status`, `run.updated`

Desktop remote client ileride bunu kullanır.

---

## 6. Idempotency & acknowledgements

- Telegram retries duplicate update getirebilir → update id dedupe
- `/prompt` her çağrı yeni run açar (kasıtlı)
- `/confirm` tek kullanımlık pending token tüketir

Ack mesajları:

- kabul edildi (`queued`/`started`)
- final sonuç ayrı gelebilir (`succeeded`/`failed`)

Uzun işlerde ara status spam’i sınırlı tutulur (örn. en fazla N update / run).

---

## 7. Localization

v1 bot cevap dili: **Türkçe** (ürün sahibi kullanımına uygun).  
Error code’lar İngilizce kalabilir; user-facing text Türkçe.

Örnek:

```text
Focused project yok. Önce /projects sonra /use <ad> kullan.
```

---

## 8. Contract change policy

Breaking command rename yok (v1 freeze).  
Yeni komut eklemek OK.  
Anlam değiştirmek major not ister.

Bu dosya implementasyon sırasında source of truth’tur.
