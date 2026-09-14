# 05 — Projects and Git

**Decision date:** 2026-09-14  
**Status:** Domain design  
**Module:** Bikorch Agent · Projects / Git delivery

---

## 1. Outcome

Agent üzerinde proje yönetilir ve üretilen iş Git ile teslim edilir.

Kullanıcı:

- proje register / clone eder
- focus seçer
- CLI ile değişiklik üretir
- diff/status görür
- commit + push yapar
- opsiyonel PR açar

---

## 2. Workspace root

Agent tüm projeleri kontrollü bir kök altında tutar (öneri):

```text
/var/lib/bikorch-agent/
  workspaces/
    api-server/
    bikorch/
  worktrees/
    api-server/
      run-r12/
  artifacts/
    runs/
  data/
    agent.sqlite
```

Config:

```text
BIKORCH_WORKSPACE_ROOT=/var/lib/bikorch-agent/workspaces
BIKORCH_DATA_DIR=/var/lib/bikorch-agent/data
```

`register` ile root dışı path’e izin verilebilir; policy flag ile kısıtlanabilir (`ALLOW_EXTERNAL_PATHS=false` default önerilir).

---

## 3. Project model

```text
Project {
  id
  name                // unique slug
  path                // absolute
  remoteUrl           // nullable
  defaultBranch       // main/master detected
  preferredProvider   // optional
  createdAt
  updatedAt
}
```

### 3.1 Create paths

| Yol | Komut | Sonuç |
| --- | --- | --- |
| Clone | `/clone <url> [name]` | git clone into workspace root |
| Register | `/register <abs-path> [name]` | mevcut repo’yu kaydet |
| List | `/projects` | isimler + aktif işaret |
| Focus | `/use <name\|id>` | chat binding |

### 3.2 Name rules

- lowercase slug (`api-server`)
- çakışmada sayı suffix
- Telegram’da kolay yazılır olmalı

### 3.3 Validation

Register/clone sonrası:

- path exists
- `.git` var mı? (yoksa warning; yine de non-git workspace olabilir)
- remote detect
- default branch detect

---

## 4. Branch strategy

v1 pragmatik model:

1. Kullanıcı mevcut branch’te çalışabilir
2. Öneri: feature branch aç (`/branch feat-x`) — v1.1 komutu
3. Worktree mode’da Agent run’a özel branch/worktree açabilir

Default otomatik branch yaratma **kapalı** olabilir; yanlışlıkla main’e yazmayı politika ile engellemek daha önemli.

### Protected branch policy

Config:

```text
PROTECTED_BRANCHES=main,master,production
```

Protected branch’te:

- `/commit` ve `/push` için ekstra `/confirm`
- veya tamamen block (`STRICT_PROTECTED_BRANCHES=true`)

---

## 5. Git operations

### 5.1 Status & diff

`/gitstatus`

- branch
- upstream
- staged/unstaged/untracked counts
- dirty yes/no

`/diff`

- `git diff --stat` özeti
- çok uzunsa truncate
- secret file heuristikleri (`.env`) uyarı

### 5.2 Commit

`/commit <message>`

Akış:

1. focused project required
2. dirty check
3. protected branch policy
4. stage policy:
   - default: tracked changes + açıkça eklenen dosyalar
   - `.env`, key dosyaları default stage dışı / uyarı
5. `git commit -m`
6. reply hash + file count

Boş commit yok.

### 5.3 Push

`/push`

Akış:

1. commit var mı / ahead mi?
2. remote var mı?
3. auth (SSH key / gh credential) hazır mı?
4. push
5. reply: branch + remote result

Force push v1’de **kapalı** (`/push --force` yok).

### 5.4 PR (optional flag)

`/pr [title]`

- requires `gh` CLI authenticated
- base = default branch
- head = current branch
- reply PR URL

Feature flag: `ENABLE_PR_COMMAND=true`

---

## 6. Delivery workflow (recommended)

```text
prompt loop
  → /gitstatus
  → /diff
  → /commit "..."
  → /push
  → /pr
```

Bot, commit olmadan push’ta net hata verir.  
Push olmadan PR’da net hata verir.

---

## 7. Auth for Git hosting

Desteklenen pratikler:

- deploy key / SSH key (sunucu user’ında)
- `gh auth login` (bootstrap)
- HTTPS token’lar env/file ref (chat’e yazılmaz)

Agent asla Telegram’a private key basmaz.

---

## 8. Conflict & failure handling

| Durum | Cevap |
| --- | --- |
| merge conflict | push/commit blocked + status |
| non-fast-forward | push failed; force yok; pull/rebase manuel rehber |
| nothing to commit | no-op success message |
| detached HEAD | warning; commit policy ile allow/deny |
| submodule dirty | warning |

Otomatik `git pull --rebase` v1 default’u değildir (sürpriz rewrite riski).

---

## 9. Worktrees

Olgun fazda:

```text
/cursorcli --worktree
```

- `git worktree add` under managed folder
- session cwd = worktree
- commit/push worktree branch’ten
- stop sonrası cleanup policy (keep / prune)

Desktop automation dokümanındaki isolation yaklaşımı ile hizalı tutulur.

---

## 10. Multi-project concurrency

- Farklı projelerde paralel session OK
- Aynı repo path’te paralel destructive git action serialize
- Focus chat-local olduğu için iki Telegram chat farklı projeleri yönetebilir (aynı allowlist user)

---

## 11. Acceptance criteria

- [ ] `/clone` workspace root altına repo indirir ve kaydeder
- [ ] `/use` focus’u kalıcı tutar (restart sonrası da)
- [ ] `/gitstatus` ve `/diff` doğru özetler
- [ ] `/commit` hash döner
- [ ] `/push` remote’a iletir
- [ ] protected branch confirm/block çalışır
- [ ] `.env` benzeri dosyalar için uyarı vardır
