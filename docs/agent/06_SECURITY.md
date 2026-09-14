# 06 — Security

**Decision date:** 2026-09-14  
**Status:** Mandatory design constraints  
**Priority:** P0 gate — security olmadan public messaging açılmaz  
**Module:** Bikorch Agent

---

## 1. Threat model (özet)

Agent; sunucuda kod çalıştırma, dosya yazma ve Git push yetkisi olan bir sistemdir.  
Messaging ile birleşince saldırı yüzeyi büyür.

Ana tehditler:

1. Yabancı Telegram kullanıcısının bot’u ele geçirip komut çalıştırması
2. Prompt / repo içeriğiyle zararlı komut tetikleme
3. Secret’ların chat loglarına sızması
4. Protected branch’e istemeden push
5. Açık API portundan unauth erişim
6. Çalınmış VPS’te credential reuse

---

## 2. Security pillars

1. **Identity gate** — allowlist olmadan hiçbir domain komutu yok
2. **Least exposure** — default’ta public inbound port yok
3. **Confirm gates** — destructive işlemler ikinci adım ister
4. **Secret hygiene** — chat’e secret yok, log’da redaction var
5. **Host isolation** — dedicated OS user + dar dosya kökü
6. **Auditability** — kim, ne zaman, hangi komut

---

## 3. Authentication & authorization

### 3.1 Telegram

Zorunlu:

```text
TELEGRAM_BOT_TOKEN
TELEGRAM_ALLOWED_USER_IDS
```

Opsiyonel:

```text
TELEGRAM_ALLOWED_CHAT_IDS
```

Kurallar:

- allowlist boşsa Agent messaging’i **refuse-to-start** veya fully disabled mode
- unknown user: execution yok
- `/whoami` kendi id’sini gösterir (kurulum kolaylığı)

### 3.2 Local API (optional)

```text
API_BIND=127.0.0.1
API_TOKEN=...
```

Remote bind v1 default kapalı. Açılırsa:

- TLS terminator arkası
- token required
- IP allowlist önerilir

### 3.3 No anonymous mode

“Herkese açık family bot” v1 hedefi değildir.

---

## 4. Dangerous operations policy

Confirm gerektirenler (v1):

| Aksiyon | Neden |
| --- | --- |
| `/push` to protected branch | prod risk |
| `/killall` | geniş etki |
| `/danger on` | policy gevşetme |
| external path register (flag açıksa) | workspace kaçışı |
| force-like git ops (gelecek) | history rewrite |

Confirm akışı:

```text
bot: Confirm push to main? Reply /confirm within 60s
user: /confirm
bot: Push started...
```

Timeout → cancel.

---

## 5. Dangerous mode

`/danger on` (confirm’li):

- ek uyarı banner
- bazı guardrail’ler gevşeyebilir (dokümante edilmiş liste)
- reboot sonrası default off’a dönebilir (öneri: off)

Default working mode: **safe**.

---

## 6. Secret handling

### 6.1 Never

- Telegram’a token/private key yapıştırma isteği (normal akışta)
- raw credential’ı SQLite plaintext “kolay alan”da tutma
- prompt history’yi public log sink’e gönderme

### 6.2 Redaction

Output/reply pipeline pattern’leri maskeler:

- `AKIA...`, `ghp_...`, `xox...`, private key blocks, `api_key=` vs.

### 6.3 Storage

Secrets:

- env files with `0600`
- veya encrypted secrets file
- process env sadece ihtiyaç kadar

---

## 7. Host hardening recommendations

- Ayrı user: `bikorch`
- Workspace root dışında yazma yok (default)
- systemd: `NoNewPrivileges=true`, `PrivateTmp=true` (uygunsa)
- SSH key ile erişim; password SSH kapalı
- Unattended-upgrades / düzenli patch
- Firewall: sadece SSH (+ varsa webhook)
- Backup: sqlite + workspace (secret ayrı)

---

## 8. Prompt / tool abuse controls

CLI’lar güçlüdür; Agent “model güvenli” varsaymaz.

Kontroller:

- aynı anda tek run / session
- uzun koşu timeout
- `/stop` her an
- push ayrı bilinçli adım (auto-push yok)
- protected branches
- optional command denylist for wrapper scripts (gelecek)

---

## 9. Multi-tenant note

v1 single-operator sistemidir.

Aynı Agent’ı birden fazla güvensiz kullanıcıya açmak için:

- ayrı OS isolation / ayrı VM gerekir
- şu anki allowlist modeli yeterli değildir

Dokümanda “shared agent = shared filesystem power” açık yazılır.

---

## 10. Incident response (basit)

Şüpheli erişimde:

1. Bot token rotate
2. Allowlist daralt
3. Agent servisini durdur
4. Aktif session’ları kill et
5. Son git push’ları review et
6. Credential renew (CLI + Git)

---

## 11. Compliance / responsibility notes

- Kullanıcı kendi CLI aboneliklerini ve provider ToS’unu yönetir
- Remote/sunucu kullanım provider kurallarına bağlı olabilir
- Agent “bypass billing / share accounts illegally” amacı taşımaz
- Repo lisansları ve secret scan sorumluluğu operatörde

---

## 12. Security acceptance gate (must pass before Telegram enablement)

- [ ] allowlist enforced (integration test)
- [ ] unauthorized user cannot spawn/prompt
- [ ] API default localhost-only
- [ ] confirm flow for protected push
- [ ] secrets not echoed in normal replies
- [ ] service runs as non-root user
- [ ] audit log for command executions exists
