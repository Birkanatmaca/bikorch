# 09 — Roadmap and Phases

**Decision date:** 2026-09-14  
**Status:** Delivery plan  
**Module:** Bikorch Agent

---

## 1. Delivery principle

Küçük dikey dilimler:

1. çalışan daemon
2. Telegram allowlist + health
3. project focus
4. bir provider session + prompt
5. git commit/push
6. sertleştirme / deployment packaging

Her dilim sonunda: typecheck/test + smoke script + doküman güncelliği.

---

## 2. Phase map

| Phase | Priority | Deliverable | Exit criteria |
| --- | --- | --- | --- |
| **A0** | P0 | Repo iskeleti + config + sqlite | boot olur, migration çalışır |
| **A1** | P0 | Security foundation + audit log | allowlist gate testleri yeşil |
| **A2** | P0 | Telegram bridge `/start /help /whoami /health` | bot cevap veriyor |
| **A3** | P0 | Projects (`clone/register/use/list`) | focus persist |
| **A4** | P0 | Accounts detect + status | `/accounts` gerçek durum |
| **A5** | P0 | Cursor session + `/prompt` + `/status` | uçtan uca prompt |
| **A6** | P0 | Git status/diff/commit/push | push smoke geçti |
| **A7** | P0 | systemd package + deploy docs validated | VPS’te 7/24 |
| **A8** | P1 | Claude/Codex adapters | multi-provider |
| **A9** | P1 | Confirm gates + protected branches | security gate complete |
| **A10** | P1 | Worktree mode + richer logs | isolation usable |
| **A11** | P2 | Optional HTTP/WS API | desktop remote-ready |
| **A12** | P2 | PR command + executor mode | olgun otomasyon |
| **A13** | P2 | WhatsApp adapter | ikinci kanal |

---

## 3. Phase details

### A0 — Skeleton

- `agent/` package bootstrap
- logger, config loader
- sqlite + migrations harness
- `bikorch-agent` entrypoint

**Done when:** `node dist/index.js` starts and exits cleanly on SIGTERM.

### A1 — Security foundation

- allowlist middleware
- audit table
- refuse-to-start if allowlist empty (when messaging enabled)

**Done when:** unauthorized contexts cannot invoke domain use-cases.

### A2 — Telegram MVP

- long-poll bot
- `/start` `/help` `/whoami` `/health` `/agentstatus`

**Done when:** allowlisted user gets health; others blocked.

### A3 — Projects

- workspace root
- clone/register/list/use/project
- ChatBinding persistence

**Done when:** restart sonrası focus hatırlanır.

### A4 — Accounts

- provider detect
- account status probe (best-effort)
- `/login` guidance

**Done when:** missing CLI net hata; connected görünümü doğru.

### A5 — First coding loop (Cursor)

- `/cursorcli` spawn
- `/sessions` `/focus` `/stop`
- `/promptmode` + `/prompt` + `/status` + `/say`

**Done when:** Telegram → prompt → CLI output tail görünür.

### A6 — Git delivery

- `/gitstatus` `/diff` `/commit` `/push`

**Done when:** bir değişikliği commit+push ile remote’ta görme.

### A7 — Production install path

- systemd unit
- env example
- install script or clear runbook
- backup notes

**Done when:** reboot sonrası botsuz SSH ile servis ayakta, Telegram çalışıyor.

### A8 — More providers

- `/claude` `/codex`
- shared adapter compliance tests

### A9 — Policy hardening

- `/confirm` `/cancel`
- protected branches
- `/danger`
- secret redaction pass

### A10 — Isolation & logs

- worktree option
- artifacts on disk
- `/logs` iyileştirme

### A11 — HTTP/WS

- localhost API mirror
- token auth
- session stream prototype

### A12 — Mature execution

- non-interactive executor adapters
- `/pr`
- better completion detection

### A13 — WhatsApp

- Cloud API adapter
- command UX mapping
- same Core use-cases

---

## 4. Recommended first implementation slice

Tek PR’lık ilk hedef:

> **A0 + A1 + A2 + A3 (projects list/use with temp fixture) + A5 minimal on one provider mock/fake adapter**

Sonra gerçek Cursor adapter ve Git dilimi.

Fake adapter ile bot UX’i erken kilitlenir; provider flake’i UI’yi bloklamaz.

---

## 5. Definition of Done (global v1)

v1 “ship” sayılır ancak:

- [ ] Ubuntu VPS’te systemd ile çalışıyor
- [ ] Telegram allowlist zorunlu ve testli
- [ ] En az 1 gerçek provider ile prompt çalışıyor
- [ ] Commit + push çalışıyor
- [ ] Laptop kapalıyken uçtan uca demo kaydı var
- [ ] Security gate (`06_SECURITY.md` §12) geçti
- [ ] `docs/agent/` ile davranış uyumlu
- [ ] Bilinen sınırlamalar README’de yazılı

UI demosu tek başına DoD değildir.

---

## 6. Explicit non-schedule note

Bu roadmap tarih taahhüdü değildir.  
Öncelik sırasıdır.

Bloklayan bağımlılıklar:

- provider CLI’ların sunucuda login edilebilir olması
- Git hosting auth
- Telegram bot token

---

## 7. Handoff checklist for coding agents

Bir implementasyon agent’ı bu klasörle işe başlarken:

1. `README.md` + `01` + `02` + `06` oku
2. Mevcut repo’yu inspect et; Desktop kodunu kör copy-paste etme
3. Phase A0’dan sapmadan iskeleti kur
4. Her dilimde test + smoke
5. Komut sözleşmesini (`08`) bozmadan ilerle
6. “Tamamlandı” iddiasını DoD ile doğrula

---

## 8. Future product bridge (post-v1)

- Desktop Bikorch → Agent API’ye remote panel
- Agent run history → Developer Intelligence ile hizalama
- Desktop Automation jobs’un Agent’a delege edilmesi

Bunlar v1’i geciktirmemelidir.

---

## 9. One-page summary for stakeholders

**Ne?** Sunucuda 7/24 Bikorch Agent.  
**Nasıl kontrol?** Telegram komutları.  
**Ne yapar?** Hesap + proje + CLI prompt + git push.  
**Ne değildir?** Mobil IDE / WhatsApp-first / multi-tenant SaaS.  
**İlk kanal?** Telegram.  
**İlk başarı?** Kapalı laptop ile bir feature commit’inin remote’a gitmesi.
