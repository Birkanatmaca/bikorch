# 07 — Deployment

**Decision date:** 2026-09-14  
**Status:** Operations plan  
**Module:** Bikorch Agent · Install / Run / Operate

---

## 1. Outcome

Bikorch Agent, bir Linux sunucuya servis olarak kurulup 7/24 çalışır.

Hedef deneyim:

```text
install → configure → systemctl enable --now → Telegram /start → çalışır
```

---

## 2. Target environment

### 2.1 Recommended

| Öğe | Öneri |
| --- | --- |
| OS | Ubuntu 22.04/24.04 LTS (veya benzeri) |
| Arch | x86_64 (öncelik), arm64 secondary |
| RAM | ≥ 2 GB (CLI’lara göre 4 GB+ daha iyi) |
| Disk | ≥ 40 GB SSD |
| Network | outbound HTTPS (Telegram + Git + provider) |
| Access | SSH |

### 2.2 Also viable

- Home always-on mini PC / Mac mini (daemon mode)
- Dedicated Hetzner/DigitalOcean/etc. VPS

### 2.3 Not recommended (v1)

- Shared free-tier container with no persistent disk
- Windows Server as first-class target
- Running as root

---

## 3. Runtime dependencies

- Node.js LTS (Agent process)
- Git
- Provider CLIs (cursor / claude / codex — ihtiyaç kadar)
- Opsiyonel: GitHub CLI (`gh`)
- systemd

CLI provider’lar Agent paketinin içinde ship edilmeyebilir; operatör kurar.

---

## 4. Install layout

```text
/opt/bikorch-agent/                  # app (code)
/var/lib/bikorch-agent/              # stateful data
  data/agent.sqlite
  workspaces/
  worktrees/
  artifacts/
/etc/bikorch-agent/                  # config
  agent.env
  agent.toml                         # optional structured config
/var/log/bikorch-agent/              # logs (or journald only)
```

OS user/group:

```text
bikorch:bikorch
```

Permissions:

- `/etc/bikorch-agent/agent.env` → `0600` root:bikorch or bikorch:bikorch
- data dirs writable by `bikorch`

---

## 5. Configuration surface

### 5.1 Required env

```text
TELEGRAM_BOT_TOKEN=
TELEGRAM_ALLOWED_USER_IDS=

BIKORCH_DATA_DIR=/var/lib/bikorch-agent/data
BIKORCH_WORKSPACE_ROOT=/var/lib/bikorch-agent/workspaces
```

### 5.2 Common optional

```text
TELEGRAM_ALLOWED_CHAT_IDS=
API_ENABLED=false
API_BIND=127.0.0.1
API_PORT=8787
API_TOKEN=

PROTECTED_BRANCHES=main,master
STRICT_PROTECTED_BRANCHES=false
ENABLE_PR_COMMAND=false
ALLOW_EXTERNAL_PATHS=false

LOG_LEVEL=info
PROMPTMODE_DEFAULT=on
```

### 5.3 Provider paths (optional overrides)

```text
CURSOR_CLI_PATH=
CLAUDE_CLI_PATH=
CODEX_CLI_PATH=
```

---

## 6. systemd unit (sketch)

```ini
[Unit]
Description=Bikorch Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=bikorch
Group=bikorch
WorkingDirectory=/opt/bikorch-agent
EnvironmentFile=/etc/bikorch-agent/agent.env
ExecStart=/usr/bin/node /opt/bikorch-agent/dist/index.js
Restart=always
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

Operasyon:

```bash
sudo systemctl enable --now bikorch-agent
sudo systemctl status bikorch-agent
journalctl -u bikorch-agent -f
```

---

## 7. Bootstrap runbook

1. VPS aç, SSH sertleştir
2. `bikorch` user oluştur
3. Node + Git kur
4. Agent paketini `/opt/bikorch-agent` deploy et
5. data dirs oluştur
6. Telegram bot oluştur (BotFather)
7. kendi user id’ni öğren (`/whoami` geçici local veya `@userinfobot`)
8. `agent.env` doldur
9. provider CLI’ları aynı user ile login et
10. Git SSH / `gh auth` ayarla
11. servisi başlat
12. Telegram: `/start` → `/health` → `/clone` → `/cursorcli` smoke test

---

## 8. Upgrade / rollback

- App code: `/opt/bikorch-agent` replace + restart
- DB migrations: boot sırasında otomatik
- Rollback: önceki release artifact + DB backup

Release öncesi:

```bash
sqlite3 backup + tar workspaces (opsiyonel)
```

---

## 9. Backup policy

Minimum:

- günlük `agent.sqlite` backup
- secrets/env ayrı güvenli kopya
- kritik workspaces için git remote zaten source of truth

Workspace’in tek kopyası sunucudaysa remote push disiplini şart.

---

## 10. Monitoring

Basit v1:

- systemd auto-restart
- `/health` bot komutu
- disk usage alert (manuel veya node exporter)

İleride:

- metrics endpoint
- fail run webhook

---

## 11. Local API exposure patterns

### A) Sadece Telegram (önerilen v1)

- inbound port yok
- en az yüzey

### B) SSH tunnel ile local API

```bash
ssh -L 8787:127.0.0.1:8787 user@server
```

Desktop Bikorch ileride bu API’ye bağlanabilir.

### C) Public HTTPS reverse proxy

- sadece bilerek
- token + IP allowlist + TLS
- v1 default değil

---

## 12. Uninstall

1. `systemctl disable --now bikorch-agent`
2. unit kaldır
3. `/opt/bikorch-agent` sil
4. data silme ayrı bilinçli adım (`/var/lib/...`)
5. bot token revoke

---

## 13. Acceptance criteria

- [ ] cold boot sonrası servis kendi kendine ayağa kalkar
- [ ] crash sonrası restart olur
- [ ] env eksikse net hata ile fail olur (sessiz çökmez)
- [ ] non-root user ile çalışır
- [ ] Telegram long-poll ayaktayken inbound port gerekmez
- [ ] dokümandaki smoke test 10 dk içinde geçilebilir
