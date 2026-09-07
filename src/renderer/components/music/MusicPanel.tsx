import { useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft,
  Download,
  Heart,
  ListMusic,
  ListPlus,
  Music2,
  Plug2,
  Plus,
  Star,
  Trash2
} from 'lucide-react'
import { DownloadsPanel } from './DownloadsPanel'
import { IntegrationsPanel } from './IntegrationsPanel'
import { SidebarNowPlaying } from './SidebarNowPlaying'
import { ConfirmDialog } from '@renderer/components/ui/ConfirmDialog'
import { trackCoverUrl } from '@renderer/lib/track-artwork'
import { cn } from '@renderer/lib/utils'
import { favoriteTracks, formatTrackDuration, useMusicStore } from '@renderer/stores/music-store'
import type { MusicTrack } from '@shared/contracts/music'

type MusicPage = 'library' | 'downloads' | 'integration'
type LibraryView = 'all' | 'favorites' | 'lists'

function isYouTubeTrack(track: MusicTrack): boolean {
  return track.source === 'youtube' || Boolean(track.sourceUrl && /youtu(\.be|be\.com)/i.test(track.sourceUrl))
}

function isSpotifyTrack(track: MusicTrack): boolean {
  return track.source === 'spotify' || Boolean(track.sourceUrl && /spotify\.com/i.test(track.sourceUrl))
}

function isDownloadedTrack(track: MusicTrack): boolean {
  return Boolean(track.isOfflineAvailable && track.sourceUrl)
}

function TrackMarks({ track }: { track: MusicTrack }): React.JSX.Element {
  return (
    <span className="music-track-marks">
      {isYouTubeTrack(track) && (
        <span className="music-mark is-youtube" title="YouTube">
          YT
        </span>
      )}
      {isSpotifyTrack(track) && (
        <span className="music-mark is-spotify" title="Spotify">
          SP
        </span>
      )}
      {isDownloadedTrack(track) && (
        <span className="music-mark is-download" title="Downloaded">
          <Download className="h-2.5 w-2.5" />
        </span>
      )}
    </span>
  )
}

function TrackRow({
  track,
  active,
  favorited,
  playlists,
  onPlay,
  onFavorite,
  onRemove,
  onAddToList
}: {
  track: MusicTrack
  active: boolean
  favorited: boolean
  playlists: Array<{ id: string; name: string }>
  onPlay: () => void
  onFavorite: () => void
  onRemove: () => void
  onAddToList: (playlistId: string) => void
}): React.JSX.Element {
  const [listOpen, setListOpen] = useState(false)

  return (
    <div className={cn('music-track-row', active && 'is-active')}>
      <button type="button" className="music-track-main" onClick={onPlay}>
        {trackCoverUrl(track) ? (
          <img className="music-track-cover" src={trackCoverUrl(track) ?? undefined} alt="" />
        ) : (
          <span className="music-track-cover is-empty">
            <Music2 className="h-3 w-3" />
          </span>
        )}
        <span className="min-w-0">
          <span className="flex min-w-0 items-center gap-1.5 truncate font-medium">
            <TrackMarks track={track} />
            <span className="truncate">{track.title}</span>
          </span>
          <span className="block truncate text-text-muted">{track.artist ?? 'Unknown artist'}</span>
        </span>
      </button>
      <span className="music-track-duration">{formatTrackDuration(track.durationMs)}</span>
      <div className="music-track-actions">
        <button
          type="button"
          className="music-icon-btn"
          onClick={onFavorite}
          aria-label={favorited ? 'Unfavorite' : 'Favorite'}
        >
          <Star className={cn('h-3 w-3', favorited && 'fill-current text-warning')} />
        </button>
        <div className="relative">
          <button
            type="button"
            className="music-icon-btn"
            onClick={() => setListOpen((open) => !open)}
            aria-label="Add to list"
          >
            <ListPlus className="h-3 w-3" />
          </button>
          {listOpen && (
            <div className="music-mini-menu">
              {playlists.length === 0 && <p>Create a list first</p>}
              {playlists.map((playlist) => (
                <button
                  key={playlist.id}
                  type="button"
                  onClick={() => {
                    onAddToList(playlist.id)
                    setListOpen(false)
                  }}
                >
                  {playlist.name}
                </button>
              ))}
            </div>
          )}
        </div>
        <button type="button" className="music-icon-btn music-track-remove" onClick={onRemove} aria-label="Remove">
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
    </div>
  )
}

export function MusicPanel(): React.JSX.Element {
  const [page, setPage] = useState<MusicPage>('library')
  const [view, setView] = useState<LibraryView>('all')
  const [newListName, setNewListName] = useState('')
  const [pendingDelete, setPendingDelete] = useState<MusicTrack | null>(null)
  const [deleting, setDeleting] = useState(false)
  const bootstrap = useMusicStore((state) => state.bootstrap)
  const loading = useMusicStore((state) => state.loading)
  const tracks = useMusicStore((state) => state.tracks)
  const favoriteIds = useMusicStore((state) => state.favoriteIds)
  const playlists = useMusicStore((state) => state.playlists)
  const selectedPlaylistId = useMusicStore((state) => state.selectedPlaylistId)
  const playlistTracks = useMusicStore((state) => state.playlistTracks)
  const currentTrackId = useMusicStore((state) => state.currentTrackId)
  const importPaths = useMusicStore((state) => state.importPaths)
  const playTrack = useMusicStore((state) => state.playTrack)
  const playPlaylist = useMusicStore((state) => state.playPlaylist)
  const removeTrack = useMusicStore((state) => state.removeTrack)
  const toggleFavorite = useMusicStore((state) => state.toggleFavorite)
  const createPlaylist = useMusicStore((state) => state.createPlaylist)
  const deletePlaylist = useMusicStore((state) => state.deletePlaylist)
  const selectPlaylist = useMusicStore((state) => state.selectPlaylist)
  const addToPlaylist = useMusicStore((state) => state.addToPlaylist)

  useEffect(() => {
    void bootstrap()
  }, [bootstrap])

  const favorites = useMemo(() => favoriteTracks(tracks, favoriteIds), [tracks, favoriteIds])
  const visibleTracks = view === 'favorites' ? favorites : view === 'lists' ? playlistTracks : tracks
  const selectedList = playlists.find((playlist) => playlist.id === selectedPlaylistId) ?? null

  const onDrop = (event: React.DragEvent): void => {
    event.preventDefault()
    const paths = [...event.dataTransfer.files]
      .map((file) => (file as File & { path?: string }).path)
      .filter((path): path is string => typeof path === 'string' && path.length > 0)
    if (paths.length > 0) {
      setPage('library')
      setView('all')
      void importPaths(paths)
    }
  }

  const confirmDelete = async (): Promise<void> => {
    if (!pendingDelete || deleting) return
    setDeleting(true)
    await removeTrack(pendingDelete.id)
    setDeleting(false)
    setPendingDelete(null)
  }

  return (
    <div className="music-panel relative flex h-full flex-col" onDragOver={(event) => event.preventDefault()} onDrop={onDrop}>
      <div className="shrink-0 border-b border-border/50 px-3 py-2">
        <SidebarNowPlaying />
      </div>

      {page !== 'library' && (
        <div className="flex shrink-0 items-center gap-2 border-b border-border/40 px-3 py-1.5">
          <button type="button" className="music-back-btn" onClick={() => setPage('library')}>
            <ArrowLeft className="h-3 w-3" />
            Music
          </button>
          <span className="text-[10px] font-medium text-text-primary">
            {page === 'downloads' ? 'Downloads' : 'Integration'}
          </span>
        </div>
      )}

      {page === 'downloads' ? (
        <DownloadsPanel />
      ) : page === 'integration' ? (
        <IntegrationsPanel />
      ) : (
        <>
          <div className="music-library-nav">
            <button
              type="button"
              className={cn('music-library-tab', view === 'all' && 'is-active')}
              onClick={() => setView('all')}
            >
              <Music2 className="h-3 w-3" />
              All
            </button>
            <button
              type="button"
              className={cn('music-library-tab', view === 'favorites' && 'is-active')}
              onClick={() => setView('favorites')}
            >
              <Heart className="h-3 w-3" />
              Favorites
            </button>
            <button
              type="button"
              className={cn('music-library-tab', view === 'lists' && 'is-active')}
              onClick={() => setView('lists')}
            >
              <ListMusic className="h-3 w-3" />
              Lists
            </button>
          </div>

          {view === 'lists' && (
            <div className="music-lists-bar">
              <div className="flex gap-1">
                <input
                  className="profile-search flex-1"
                  value={newListName}
                  placeholder="New list name"
                  onChange={(event) => setNewListName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && newListName.trim()) {
                      void createPlaylist(newListName.trim())
                      setNewListName('')
                    }
                  }}
                />
                <button
                  type="button"
                  className="music-icon-btn"
                  disabled={!newListName.trim()}
                  onClick={() => {
                    void createPlaylist(newListName.trim())
                    setNewListName('')
                  }}
                  aria-label="Create list"
                >
                  <Plus className="h-3 w-3" />
                </button>
              </div>
              <div className="music-list-chips">
                {playlists.length === 0 && <p className="text-[10px] text-text-muted">No lists yet</p>}
                {playlists.map((playlist) => (
                  <div key={playlist.id} className="music-list-chip-row">
                    <button
                      type="button"
                      className={cn('music-list-chip', selectedPlaylistId === playlist.id && 'is-active')}
                      onClick={() => void selectPlaylist(playlist.id)}
                    >
                      {playlist.name}
                    </button>
                    <button
                      type="button"
                      className="music-icon-btn"
                      onClick={() => void playPlaylist(playlist.id)}
                      aria-label={`Play ${playlist.name}`}
                    >
                      <Music2 className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      className="music-icon-btn"
                      onClick={() => void deletePlaylist(playlist.id)}
                      aria-label={`Delete ${playlist.name}`}
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
              {selectedList && (
                <p className="text-[10px] text-text-muted">{selectedList.name} · {playlistTracks.length} tracks</p>
              )}
            </div>
          )}

          <div className="min-h-0 flex-1 overflow-y-auto px-2 py-1">
            {loading && <div className="profile-empty-state">Loading…</div>}
            {!loading && visibleTracks.length === 0 && (
              <div className="profile-empty-state">
                {view === 'favorites'
                  ? 'Star a track to save it here.'
                  : view === 'lists'
                    ? selectedList
                      ? 'This list is empty. Use + on a track to add it.'
                      : 'Create a list, then add tracks from All.'
                    : 'Drop files here, or download audio to fill the library.'}
              </div>
            )}
            {visibleTracks.map((track) => (
              <TrackRow
                key={track.id}
                track={track}
                active={track.id === currentTrackId}
                favorited={favoriteIds.has(track.id)}
                playlists={playlists}
                onPlay={() => {
                  if (view === 'lists' && selectedPlaylistId) {
                    void playPlaylist(selectedPlaylistId, track.id)
                    return
                  }
                  void playTrack(track.id)
                }}
                onFavorite={() => void toggleFavorite(track.id)}
                onAddToList={(playlistId) => void addToPlaylist(playlistId, [track.id])}
                onRemove={() => setPendingDelete(track)}
              />
            ))}
          </div>
        </>
      )}

      <div className="music-sidebar-dock">
        <button
          type="button"
          className={cn('music-dock-btn', page === 'downloads' && 'is-active')}
          onClick={() => setPage(page === 'downloads' ? 'library' : 'downloads')}
        >
          <Download className="h-3.5 w-3.5" />
          Download
        </button>
        <button
          type="button"
          className={cn('music-dock-btn', page === 'integration' && 'is-active')}
          onClick={() => setPage(page === 'integration' ? 'library' : 'integration')}
        >
          <Plug2 className="h-3.5 w-3.5" />
          Integration
        </button>
      </div>

      {pendingDelete && (
        <ConfirmDialog
          title="Delete this track?"
          message={`${pendingDelete.title} will be permanently removed from this computer. It will not go to the Recycle Bin. You can download it again later.`}
          confirmLabel="Delete"
          busy={deleting}
          onCancel={() => {
            if (!deleting) setPendingDelete(null)
          }}
          onConfirm={() => void confirmDelete()}
        />
      )}
    </div>
  )
}
