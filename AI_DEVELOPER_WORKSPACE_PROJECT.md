# AI Developer Workspace — Project Brief

## 1. Proje Amacı

Windows ve macOS üzerinde çalışan, geliştiricinin birden fazla AI coding CLI aracını tek masaüstü uygulamasından yönetebildiği kişiselleştirilebilir bir developer workspace oluştur.

Bu uygulama bir IDE alternatifi olmak zorunda değildir.

Ana amaç:

- Claude Code, Cursor CLI ve diğer coding CLI araçlarını tek yerde çalıştırmak
- Kullanıcının aynı projede birden fazla CLI oturumu açabilmesini sağlamak
- CLI'ların yaptığı dosya değişikliklerini görmek
- Git diff üzerinden değişiklikleri incelemek
- Terminal, CLI, dosya gezgini ve diff panellerini kullanıcının istediği gibi düzenleyebilmesini sağlamak
- Birden fazla projeyi üst sekmeler üzerinden aynı anda yönetmek

İlk sürümde otomatik multi-agent orchestrator geliştirme.

Öncelik sağlam ve kullanışlı bir CLI workspace oluşturmaktır.

---

# 2. Platform

Uygulama şu platformları desteklemeli:

- macOS
- Windows

Tek kod tabanı kullanılmalı.

Native Swift + Windows için ayrı teknoloji kullanılmamalı.

---

# 3. Teknoloji Stack'i

## Desktop

- Electron

## Frontend

- React
- TypeScript
- Vite

## Styling

- Tailwind CSS

## UI Components

- shadcn/ui kullanılabilir
- Ancak tüm tasarım shadcn varsayılan görünümüne bırakılmamalı
- Uygulamaya özel design system oluşturulmalı

## State Management

- Zustand

## Terminal

- xterm.js
- node-pty

## Code / Diff Viewer

- Monaco Editor
- Monaco Diff Editor

## Git

Başlangıçta:

- native `git` CLI komutları

veya

- simple-git

kullanılabilir.

## Local Storage

İlk aşamada:

- SQLite

Tercihen:

- better-sqlite3

---

# 4. Temel Mimari

Electron güvenlik sınırları korunmalı.

```text
src/
├── main/
│   ├── cli/
│   ├── git/
│   ├── filesystem/
│   ├── projects/
│   ├── persistence/
│   └── ipc/
│
├── preload/
│   └── index.ts
│
├── renderer/
│   ├── components/
│   ├── features/
│   ├── layouts/
│   ├── pages/
│   ├── stores/
│   └── styles/
│
└── shared/
    ├── types/
    ├── constants/
    └── contracts/
```

Renderer process doğrudan Node API'lerine erişmemeli.

İletişim:

```text
React Renderer
     ↓
Preload API
     ↓
Electron IPC
     ↓
Main Process
     ↓
PTY / Git / Filesystem / SQLite
```

şeklinde kurulmalı.

---

# 5. Ana Ürün Mantığı

Uygulamanın en üst seviyesinde PROJECT TAB sistemi bulunmalı.

Örnek:

```text
[ PrienteCloud ] [ Mobile App ] [ Backend ] [ + ]
```

Her project tab tamamen bağımsız workspace state'ine sahip olmalı.

Her proje için saklanacak bilgiler:

- proje klasörü
- açık paneller
- panel konumları
- panel boyutları
- CLI session'ları
- terminal session'ları
- aktif branch
- aktif dosya
- workspace layout
- son açık sekmeler

Uygulama kapatılıp tekrar açıldığında workspace mümkün olduğunca kaldığı yerden devam etmeli.

---

# 6. Workspace Sistemi

Uygulama sabit dashboard olmamalı.

Kullanıcı tamamen özelleştirilebilir bir workspace oluşturabilmeli.

Paneller:

- sürüklenebilir
- yeniden boyutlandırılabilir
- kapatılabilir
- açılabilir
- dock edilebilir
- tab haline getirilebilir

Kullanıcı aynı panel türünden birden fazla açabilmeli.

Örnek:

```text
Claude #1
Claude #2
Cursor #1
Terminal #1
Terminal #2
```

Workspace örneği:

```text
┌──────────────────────────────────────────────┐
│ Project Tabs                                 │
├───────────────┬──────────────────────────────┤
│ Files         │ Claude Code                  │
│               │                              │
│               ├──────────────────────────────┤
│               │ Git Changes / Diff           │
├───────────────┼──────────────────────────────┤
│ Terminal      │ Cursor CLI                   │
└───────────────┴──────────────────────────────┘
```

Başka kullanıcı tamamen farklı bir layout oluşturabilmeli.

---

# 7. Add Panel Sistemi

Workspace içerisinde:

```text
+ Add Panel
```

aksiyonu bulunmalı.

İlk desteklenecek panel türleri:

- Claude Code
- Cursor CLI
- Generic Terminal
- File Explorer
- Git Changes
- Diff Viewer
- Logs
- Tasks
- Usage

Panel sistemi extensible tasarlanmalı.

Örnek type:

```ts
export type PanelType =
  | "terminal"
  | "claude"
  | "cursor"
  | "file-explorer"
  | "git-changes"
  | "diff"
  | "logs"
  | "tasks"
  | "usage";
```

Gelecekte yeni CLI provider eklemek kolay olmalı.

---

# 8. CLI Yönetimi

Her CLI bir PTY process olarak yönetilmeli.

Temel interface:

```ts
export interface CliSession {
  id: string;
  projectId: string;
  type: string;
  title: string;
  cwd: string;
  status: "starting" | "running" | "stopped" | "error";
}
```

Main process:

- CLI process başlatmalı
- stdout / terminal data okumalı
- stdin göndermeli
- terminal resize desteklemeli
- process kapatabilmeli
- process exit event yönetmeli

Renderer yalnızca güvenli IPC API kullanmalı.

---

# 9. Git Changes

Bu özellik ürünün temel parçalarından biridir.

CLI bir dosyayı değiştirdiğinde kullanıcı bunu uygulama içerisinde görebilmeli.

Git Changes paneli:

```text
CHANGES

M src/auth/auth.service.ts
M src/auth/auth.controller.ts
A src/auth/auth.spec.ts
```

Dosyaya tıklandığında Diff Viewer açılmalı.

---

# 10. Diff Viewer

Monaco Diff Editor kullanılmalı.

Örnek:

```diff
- const token = req.body.token;
+ const token = await verifyToken(req.body.token);
```

Diff ekranında ilk etapta:

- Previous
- Next
- Open File
- Refresh

aksiyonları bulunmalı.

Daha sonra eklenebilir:

- Revert File
- Stage
- Unstage
- Ask Claude
- Ask Cursor

İlk MVP'de riskli Git işlemlerini otomatikleştirme.

---

# 11. File Explorer

File Explorer proje dizinini göstermeli.

Özellikler:

- klasör aç/kapat
- dosya seç
- aktif dosyayı göster
- modified dosyaları işaretle

İlk sürümde tam IDE seviyesinde file management gerekmiyor.

---

# 12. UI / UX Tasarım Dili

Uygulama tamamen pixel-art veya game UI olmamalı.

Ana yaklaşım:

> Modern developer tool + hafif retro terminal karakteri

Yaklaşık:

- %90 modern developer application
- %10 retro / terminal hissi

Referans hissi:

- Raycast
- Warp
- Linear
- Cursor

Ancak birebir kopyalama yapılmamalı.

---

# 13. Görsel Stil

## Genel

- koyu tema öncelikli
- yumuşak yüzeyler
- hafif shadow
- ince border
- kompakt fakat sıkışık olmayan layout
- uzun süre kullanımda göz yormayan kontrast

## Border Radius

Genel:

```text
8px – 12px
```

Küçük element:

```text
6px – 8px
```

Büyük modal/panel:

```text
12px
```

Aşırı yuvarlak tasarım kullanılmamalı.

---

# 14. Renk Paleti

Başlangıç palette:

```text
App Background     #0D0F12
Panel Background   #14171C
Elevated Surface   #1A1E24
Hover Surface      #20252C
Border             #272C35

Primary            #7C6CF2
Primary Hover      #8E80F6

Text Primary       #F3F4F6
Text Secondary     #A1A8B3
Text Muted         #707986

Success            #3CCB7F
Warning            #F2B84B
Error              #F05D68
Info               #4EA1FF
```

Primary rengi gereksiz yere her yerde kullanılmamalı.

Primary sadece:

- aktif item
- focus
- seçili panel
- önemli action
- progress

gibi yerlerde kullanılmalı.

---

# 15. Typography

UI için modern sans-serif kullanılmalı.

Örnek:

- Inter
- Geist
- system font

Terminal ve kod için monospace:

- JetBrains Mono
- Geist Mono
- system monospace

Pixel font ana UI fontu yapılmamalı.

Retro karakter sadece küçük status alanlarında kullanılabilir.

Örnek:

```text
CLAUDE_01   ● RUNNING
CURSOR_02   ○ IDLE
```

---

# 16. Agent / CLI Status Görünümü

CLI panel header'ında durum görünmeli.

Örnek:

```text
Claude Code
● Running
```

veya:

```text
CLAUDE_01
RUNNING · 14s
```

Durumlar:

- Starting
- Running
- Waiting
- Stopped
- Error

Renk yalnızca durumu anlatmak için kullanılmalı.

---

# 17. İlk MVP

İlk sürümde sadece şu özelliklere odaklan:

## MVP 1

1. Electron uygulamasını ayağa kaldır
2. Project folder seçebilme
3. Project tabs
4. Customizable workspace
5. Add Panel
6. Generic terminal panel
7. Claude Code panel
8. Cursor CLI panel
9. Multiple CLI sessions
10. File Explorer
11. Git Changes
12. Monaco Diff Viewer
13. Workspace layout persistence
14. Project persistence

Bu özellikler düzgün çalışmadan orchestrator geliştirme.

---

# 18. MVP Dışında Tutulacaklar

Şimdilik yapma:

- otomatik multi-agent orchestration
- Claude → Cursor otomatik görev aktarımı
- AI memory
- intelligent model routing
- subscription billing
- cloud sync
- team collaboration
- marketplace
- remote development
- built-in code editor ile tam IDE yapma
- automatic commit
- automatic push
- autonomous Git operations

Bunlar sonraki fazlardır.

---

# 19. Gelecek Faz

MVP oturduktan sonra CLI'lar arası iletişim eklenebilir.

Örnek:

```text
Claude
   ↓
Plan
   ↓
Send to Cursor
   ↓
Implementation
   ↓
Review with Claude
```

İlk etapta kullanıcı kontrollü olmalı.

Örneğin:

```text
[ Send to Claude ]
[ Send to Cursor ]
[ Review with Claude ]
```

Daha sonra otomatik pipeline eklenebilir.

---

# 20. Kod Kalitesi Kuralları

- TypeScript strict mode kullan
- `any` kullanma
- büyük component oluşturma
- business logic'i React component içine gömme
- Electron main process sorumluluklarını ayrıştır
- reusable component oluştur ama gereksiz abstraction yapma
- IPC contract'larını type-safe tut
- provider bağımlılıklarını doğrudan UI'a bağlama
- platform-specific kodları adapter arkasına al

Her önemli modül için açık interface kullan.

---

# 21. Güvenlik

Electron tarafında:

- `contextIsolation: true`
- renderer Node.js erişimi kapalı
- preload üzerinden whitelist edilmiş API
- gelen IPC payload'larını validate et
- shell command string interpolation yapma
- mümkün olduğunca command + args array kullan
- kullanıcıdan gelen path'leri doğrula

CLI process yönetimi güvenlik açısından ayrı modülde bulunmalı.

---

# 22. İlk Geliştirme Sırası

Aşağıdaki sırayı takip et:

```text
1. Electron + React + TypeScript setup
           ↓
2. Main / Preload / Renderer architecture
           ↓
3. Project selection
           ↓
4. Project tabs
           ↓
5. Dockable workspace
           ↓
6. Generic Terminal + node-pty
           ↓
7. Multiple terminal sessions
           ↓
8. Claude / Cursor CLI adapters
           ↓
9. File Explorer
           ↓
10. Git status
           ↓
11. Monaco Diff Viewer
           ↓
12. Workspace persistence
           ↓
13. UI polish
```

Her aşama çalışmadan bir sonraki büyük özelliğe geçme.

---

# 23. İlk Görev

Önce yalnızca foundation oluştur.

İlk implementasyon hedefi:

```text
Electron
+
React
+
TypeScript
+
Tailwind
+
Zustand
```

ile uygulamayı ayağa kaldır.

Ardından şu layout'u oluştur:

```text
┌───────────────────────────────────────────────────────────┐
│ App Logo   [ Project A ] [ Project B ] [ + ]             │
├──────────────┬────────────────────────┬───────────────────┤
│              │                        │                   │
│ File         │                        │                   │
│ Explorer     │      Workspace         │     Panel         │
│              │                        │                   │
│              │                        │                   │
├──────────────┴────────────────────────┴───────────────────┤
│ Terminal                                                  │
└───────────────────────────────────────────────────────────┘
```

Bu aşamada gerçek CLI entegrasyonu yapma.

Önce:

- layout
- project tabs
- panels
- resize
- drag/drop
- panel creation
- panel closing

çalışsın.

UI foundation tamamlandığında terminal entegrasyonuna geç.

---

# 24. Tasarım Prensibi

Ürün şu hissi vermeli:

> "Burası benim kişisel development control room'um."

Chat uygulaması gibi görünmemeli.

Dashboard gibi de görünmemeli.

Ana unsur:

> Workspace

olmalı.

Kullanıcı uygulamayı kendi çalışma biçimine göre şekillendirebilmeli.
