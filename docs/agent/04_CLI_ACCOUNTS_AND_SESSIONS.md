# 04 — CLI Accounts and Sessions

**Decision date:** 2026-09-14  
**Status:** Domain design  
**Module:** Bikorch Agent · Accounts / Sessions / Runs

---

## 1. Outcome

Agent, kullanıcının kendi AI coding CLI hesaplarıyla sunucuda session açıp prompt çalıştırabilmelidir.

Başarı tanımı:

- hesap bağlanabilir / durumu görülebilir
- projede provider CLI session açılır
- prompt iletilir
- run durumu izlenir
- session temiz kapatılabilir

---

## 2. Supported providers (v1 target matrix)

| Provider | Adapter priority | Notes |
| --- | --- | --- |
| Cursor CLI | P0 | Kullanıcı senaryosunun merkezinde (`/cursorcli`) |
| Claude Code | P0 | Yaygın coding CLI |
| Codex CLI | P1 | Mevcut Bikorch ekosisteminde var |
| Diğerleri | P2 | Adapter interface hazır; sonra eklenir |

Destek “binary detect + spawn + prompt submit + shutdown” seviyesinde başlar.  
Her provider’ın tüm TUI özellikleri garanti edilmez.

---

## 3. Account model

```text
Account {
  id
  provider            // cursor | claude | codex | ...
  label               // "work", "personal"
  status              // connected | needs_login | error | unknown
  credentialRef       // pointer, not raw secret in chat logs
  metadata            // email/plan hints if safely available
  createdAt
  updatedAt
}
```

### 3.1 Binding philosophy

Agent, kullanıcının mevcut CLI auth’unu kullanır.

- Credential’ları Telegram’a yapıştırma **yasak** (UX olarak teşvik edilmez)
- Bootstrap: SSH ile sunucuya girip resmi CLI login akışını bir kez tamamla
- Agent login sonrası status’u `connected` yapar

### 3.2 Commands mapping

- `/accounts` → list
- `/account cursor` → detail
- `/login cursor` → “SSH ile şu komutu çalıştır / status kontrol” rehberi

### 3.3 Multi-account

v1: provider başına 1 default account yeterli.  
Label’lı multi-account v1.1 adayı (`/useaccount work`).

---

## 4. Session lifecycle

```text
spawn → idle → running → idle → ... → stopped
                 ↘ failed
                 ↘ needs_input
                 ↘ dead
```

| Status | Anlam |
| --- | --- |
| `starting` | process açılıyor |
| `idle` | prompt kabul etmeye hazır |
| `running` | aktif run var |
| `needs_input` | CLI onay/input bekliyor |
| `stopping` | kapatılıyor |
| `stopped` | temiz kapandı |
| `dead` | beklenmedik ölüm |
| `error` | spawn/runtime hata |

### 4.1 Spawn inputs

- provider
- project path (cwd)
- account/credential environment
- session env (PATH, HOME profile, proxy vs. config’den)

### 4.2 Session identity

Kullanıcıya kısa alias:

```text
s1, s2, s3 ...
```

Internal UUID ayrıca tutulur. `/focus s1` çalışır.

---

## 5. Prompt / Run model

```text
Run {
  id              // r12
  sessionId
  prompt
  status          // queued | running | succeeded | failed | interrupted | cancelled
  startedAt
  finishedAt
  summary         // short model/human readable
  exitSignal      // optional
}
```

### 5.1 Submit mechanics (PTY mode)

Desktop ile aynı fikir:

1. bracketed paste ile prompt yaz
2. kısa delay
3. CR / Enter gönder
4. output’u watch et

### 5.2 Completion detection (pragmatic v1)

Tam “AI bitti” sinyali her provider’da net olmayabilir. v1 stratejisi:

1. heuristic idle detection (output sessizliği + prompt-ready pattern)
2. kullanıcı `/status` ile manuel kontrol
3. executor mode’da exit code (olgun faz)

Aşırı iddialı otomatik “done” iddiası yok; status dürüst olur (`running` / `idle` / `unknown`).

### 5.3 needs_input handling

CLI `y/n` veya login isterse:

- session `needs_input`
- bot uyarır
- v1’de sınırlı cevap: kullanıcı `/say y` veya `/prompt y` ile iletebilir
- tehlikeli otomatik yes-default yok

---

## 6. Session operations

| Operasyon | Davranış |
| --- | --- |
| open | focused project zorunlu |
| focus | chat binding güncellenir |
| stop | graceful terminate + timeout kill |
| killall | confirm gerekli |
| list | project filtreli + global |

Aynı projede birden fazla session serbest.  
Aynı session’da paralel run yok.

---

## 7. Working directory & isolation

Default:

- session cwd = project path

Isolation options (policy ile):

| Mode | Ne zaman |
| --- | --- |
| `inplace` | hızlı iterasyon, kullanıcı bilinçli |
| `worktree` | daha güvenli branch izolasyonu (önerilen default push öncesi işler için) |

v1 önerisi:

- prompt denemeleri `inplace` veya dedicated branch
- destructive/otomatik işlerde worktree (Desktop automation ile hizalı)

`/cursorcli --worktree` flag’i v1.1 güzel eklenti.

---

## 8. Output capture

Her session için ring buffer:

- memory: son N KB
- optional file artifact per run

Telegram’a giden:

- son 20–40 satır veya summarize
- secret redaction pipeline

`/logs` daha uzun ama yine bounded içerik döner.

---

## 9. Provider adapter contract

```ts
interface CliAdapter {
  provider: string
  detect(): Promise<{ ok: boolean; version?: string; error?: string }>
  spawn(input: SpawnInput): Promise<SpawnedSession>
  submitPrompt(session: SpawnedSession, prompt: string): Promise<void>
  resize?(session: SpawnedSession, cols: number, rows: number): Promise<void>
  shutdown(session: SpawnedSession, mode: 'graceful' | 'force'): Promise<void>
  probeAccount?(): Promise<AccountStatus>
}
```

Adapter’lar Core’un PTY detayını saklamasına yardım eder.

---

## 10. Bootstrap checklist (operator)

Yeni sunucuda:

1. Provider CLI binary kur
2. Aynı OS user altında resmi login yap
3. `bikorch-agent` servisini aynı user ile çalıştır
4. `/accounts` connected görene kadar doğrula
5. mini projede `/cursorcli` smoke test

Farklı Linux user ile login + farklı user ile agent = sık kırılma nedeni.

---

## 11. Risks & mitigations

| Risk | Mitigation |
| --- | --- |
| CLI interaktif TUI’de takılır | needs_input + /status; executor mode roadmap |
| Auth cookie/session expire | account status probe; bot uyarısı |
| Provider ToS / remote usage | kullanıcı kendi hesabı + kendi sunucusu; dokümanda sorumluluk notu |
| Prompt injection via repo files | policy: dangerous tools gate; user confirm for push |
| Hang run | timeout + manual /stop |

---

## 12. Acceptance criteria

- [ ] En az 1 provider detect + spawn çalışıyor
- [ ] `/cursorcli` session id döndürüyor
- [ ] `/prompt` focused session’a yazıyor
- [ ] `/status` idle/running ayrımı yapıyor
- [ ] `/stop` session’ı temiz kapatıyor
- [ ] account `needs_login` durumu bot’ta anlaşılır
