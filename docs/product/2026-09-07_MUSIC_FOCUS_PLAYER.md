# Bikorch — Music / Focus Player

**Decision date:** 2026-09-07  
**Priority:** P1  
**Status:** Approved product requirement  
**Audience:** AI coding agent

## 1. Objective

Add a native-feeling Music experience to Bikorch without turning the application into a music piracy/downloading tool.

The Music module should support:

- local music
- offline playback
- user playlists
- favorites
- queue
- recent history
- a compact sidebar player
- optional focus-session integration
- compliant Spotify/YouTube integrations

The local library must work independently of external providers.

---

## 2. Navigation

Add a Music icon to the existing activity sidebar.

Suggested sidebar entries:

```text
Files
Accounts
Changes
Profile
Music
```

The Music view should open in the existing sidebar/navigation architecture.

The application should also support an expanded Music Library view if sidebar width is insufficient.

---

## 3. Mini Player

Persistent compact player:

```text
Artwork
Track title
Artist

Previous
Play / Pause
Next

Progress
Volume
Shuffle
Repeat
```

Requirements:

- playback continues while changing projects
- playback continues when Music sidebar is hidden
- current track state is global, not project-specific
- keyboard/media-key integration can be added later
- the player must expose loading/error/unavailable states

---

## 4. Local Library

The first real implementation should focus on local music.

Supported workflow:

```text
Add File
Add Folder
Drag & Drop
  ↓
Scan
  ↓
Metadata extraction
  ↓
Library
```

Possible supported formats:

- MP3
- WAV
- M4A/AAC if supported by runtime
- FLAC if supported by runtime

Do not claim support until verified on target OS/runtime.

---

## 5. Storage

Do not copy files automatically without a clear user choice.

Offer two library modes:

1. **Reference original file**
2. **Copy into Bikorch music storage**

Suggested managed storage:

```text
<userData>/music/
├── library/
├── artwork/
└── cache/
```

The database should store stable metadata.

Suggested track model:

```ts
interface MusicTrack {
  id: string
  title: string
  artist?: string
  album?: string
  durationMs?: number
  filePath?: string
  artworkPath?: string
  source: 'local' | 'spotify' | 'youtube'
  sourceId?: string
  sourceUrl?: string
  isOfflineAvailable: boolean
  addedAt: number
  lastPlayedAt?: number
  playCount: number
}
```

Do not confuse streaming references with downloaded/offline files.

---

## 6. Library screens

Required sections:

- My Music
- Downloads / Offline
- Recently Played
- Favorites
- Playlists
- Queue

Suggested UI:

```text
MY MUSIC

Search music...

Recently Played

Playlists
- Coding
- Focus
- Night
- Favorites

Offline
127 tracks
1.8 GB
```

---

## 7. Playlists

Users should be able to:

- create playlist
- rename playlist
- delete playlist
- add track
- remove track
- reorder tracks
- play from beginning
- play selected track
- shuffle
- repeat

Suggested data model:

```ts
interface MusicPlaylist {
  id: string
  name: string
  createdAt: number
  updatedAt: number
}

interface MusicPlaylistItem {
  playlistId: string
  trackId: string
  position: number
}
```

Use stable ordering.

---

## 8. Playback queue

Keep queue separate from playlists.

Queue requirements:

- play next
- add to queue
- remove from queue
- reorder
- clear
- persist optionally
- restore current track safely after restart if desired

Do not auto-start sound on application launch unless the user explicitly enables it.

---

## 9. Favorites and history

Favorite tracks should be explicit user actions.

Listening history may contain:

- track
- source
- startedAt
- endedAt
- listened duration
- project/focus session association if enabled

Listening history must have a privacy toggle.

---

## 10. Search

Search should work locally first.

Search fields:

- title
- artist
- album
- playlist

Later provider search may include:

- Spotify
- YouTube

The search result must clearly display its source.

---

## 11. URL handling

Support parsing known provider links.

Examples:

```text
https://open.spotify.com/track/...
https://www.youtube.com/watch?v=...
https://youtu.be/...
```

A pasted URL should produce a provider-specific action such as:

- Play
- Add reference to library
- Add to playlist
- Open official service

Do not silently download audio from the URL.

---

## 12. Spotify integration

Spotify integration should be built through official mechanisms.

Possible user experience:

```text
Spotify
Connected

Current track
Play / Pause
Previous
Next
Volume
Queue
```

Important:

- verify current Spotify API/Web Playback requirements before implementation
- do not assume every account tier supports playback
- treat provider approval/policy limits as runtime/product constraints
- do not expose raw OAuth tokens to the renderer
- securely store refresh credentials in the main process/OS credential storage
- support disconnect/revoke

The local Music module must not depend on Spotify being available.

---

## 13. YouTube integration

YouTube should use official supported playback mechanisms.

Requirements:

- visible compliant player where required
- no hidden audio extraction
- no custom mechanism intended to suppress ads
- no stream-to-MP3 conversion
- no fake offline support

A YouTube item saved in Bikorch may be represented as a reference:

```ts
{
  source: 'youtube',
  sourceId: '...',
  sourceUrl: '...',
  isOfflineAvailable: false
}
```

---

## 14. Download policy

Bikorch may provide a Downloads/Offline area, but “download” means one of:

1. User imports an audio file they own.
2. User copies an authorized local file into Bikorch-managed storage.
3. A future licensed/open provider explicitly grants downloadable audio through a supported API.

Do not implement:

- YouTube → MP3
- Spotify → MP3
- stream ripping
- DRM circumvention
- advertisement removal
- protected-media extraction
- disguised downloader endpoints

If a source does not permit downloading, allow streaming/reference functionality only.

---

## 15. Import metadata

On import, try to resolve:

- title
- artist
- album
- duration
- artwork
- track number
- year

Fallback to filename when metadata is missing.

Handle:

- corrupt file
- inaccessible path
- duplicate file
- moved/deleted file
- unsupported codec

Duplicates can use:

- canonical path
- file size
- content hash if practical

Do not hash huge libraries synchronously on the renderer thread.

---

## 16. Player architecture

Use a provider abstraction.

Concept:

```ts
interface MusicProvider {
  getState(): Promise<PlaybackState>
  play(track?: MusicTrack): Promise<void>
  pause(): Promise<void>
  next(): Promise<void>
  previous(): Promise<void>
  seek(positionMs: number): Promise<void>
  setVolume(volume: number): Promise<void>
}
```

Possible implementations:

```text
LocalMusicProvider
SpotifyProvider
YouTubeProvider
```

Do not scatter provider conditionals across UI components.

---

## 17. Electron architecture

Suggested boundaries:

### Main process

- filesystem scanning
- local library database
- safe path handling
- managed file copies
- external provider auth
- credential storage
- provider HTTP requests
- media metadata extraction where appropriate

### Renderer

- library UI
- player UI
- playlist editing
- queue UI
- search UI

### Preload

Expose only required typed methods.

Example conceptual API:

```ts
window.api.music.library.list()
window.api.music.library.importFiles()
window.api.music.playback.play()
window.api.music.playback.pause()
window.api.music.playlists.create()
```

Do not expose arbitrary filesystem operations through the Music API.

---

## 18. Suggested implementation structure

Adapt to repository conventions.

```text
src/shared/contracts/music.ts

src/main/music/
├── library.ts
├── local-provider.ts
├── metadata.ts
├── storage.ts
├── spotify-provider.ts
└── youtube-provider.ts

src/main/ipc/
└── music.ts

src/renderer/stores/
└── music-store.ts

src/renderer/components/music/
├── MusicSidebar.tsx
├── MiniPlayer.tsx
├── MusicLibrary.tsx
├── PlaylistView.tsx
├── QueueView.tsx
└── MusicSearch.tsx
```

Do not create duplicate abstractions if equivalent application services already exist.

---

## 19. Focus integration

This is optional after the core player works.

Possible integration:

```text
Focus Session
01:42:18

Project:
Bikorch

Music:
Hans Zimmer — Mountains

Prompts:
28

Commits:
3
```

Possible profile metrics:

- music during coding sessions
- favorite focus playlists
- average focus session
- most played artists/genres while coding

Do not claim a genre improves productivity.

Treat correlations as descriptive, not causal.

---

## 20. Privacy

Required settings:

```text
Music

[ ] Keep listening history
[ ] Associate music with projects
[ ] Use music data in Developer Insights
```

Music listening data must not automatically become Developer Memory.

No music library content should be uploaded to an AI service without explicit consent.

---

## 21. Recommended implementation phases

### Phase A — Core local player

- Music sidebar icon
- import local files
- persistent library
- current-track state
- play/pause
- next/previous
- seek
- volume
- error handling

### Phase B — Library UX

- metadata/artwork
- search
- favorites
- recently played
- offline view

### Phase C — Playlists

- create
- rename
- delete
- add/remove
- reorder
- queue

### Phase D — Focus integration

- optional focus session
- activity association
- privacy settings

### Phase E — Spotify

- auth
- playback state
- controls
- source references

### Phase F — YouTube

- official playback
- link parser
- source references
- compliant visible player

---

## 22. Acceptance criteria

Core Music feature is not complete until:

- Music appears in normal app navigation.
- A real local audio file can be imported.
- The imported track remains after restart.
- The track can be played and paused.
- Progress and current track are shown correctly.
- Playlists can be created and reordered.
- Missing files fail gracefully.
- Streaming references are not shown as offline files.
- No Spotify/YouTube media extraction is implemented.
- Sensitive provider tokens remain outside renderer storage.
- Music playback is not interrupted when switching projects.
- Typecheck/build pass.
- Library, queue and playlist core logic has tests.
