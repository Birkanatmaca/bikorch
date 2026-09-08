import { useEffect, useMemo, useState } from 'react'
import { Clock, Download, Heart, Loader2, Music2, Play, Search, Star, Trash2 } from 'lucide-react'
import { SidebarNowPlaying } from './SidebarNowPlaying'
import { ConfirmDialog } from '@renderer/components/ui/ConfirmDialog'
import { trackCoverUrl } from '@renderer/lib/track-artwork'
import { cn } from '@renderer/lib/utils'
import { formatDurationSec, useDownloadStore } from '@renderer/stores/download-store'
import { favoriteTracks, formatTrackDuration, useMusicStore } from '@renderer/stores/music-store'
import type { MusicTrack, YouTubeSearchHit } from '@shared/contracts/music'

type LibraryView = 'all' | 'favorites' | 'downloaded' | 'recent'

function isYouTubeTrack(track: MusicTrack): boolean {
  return track.source === 'youtube' || Boolean(track.sourceUrl && /youtu(\.be|be\.com)/i.test(track.sourceUrl))
}

function isDownloadedTrack(track: MusicTrack): boolean {
  return Boolean(track.isOfflineAvailable && track.filePath)
}

function canDownloadTrack(track: MusicTrack): boolean {
  return Boolean(track.sourceUrl) && !isDownloadedTrack(track)
}

const FIND_SONG_LIMIT = 3

function normalizeSongText(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

function downloadedMatchesQuery(track: MusicTrack, query: string): boolean {
  const tokens = normalizeSongText(query).split(' ').filter((token) => token.length > 0)
  if (tokens.length === 0) return false
  const haystack = normalizeSongText([track.title, track.artist, track.album].filter(Boolean).join(' '))
  return tokens.every((token) => haystack.includes(token))
}

function scoreDownloadedMatch(track: MusicTrack, query: string): number {
  const q = normalizeSongText(query)
  const title = normalizeSongText(track.title)
  const artist = normalizeSongText(track.artist ?? '')
  if (title === q) return 100
  if (title.startsWith(q)) return 80
  if (title.includes(q)) return 60
  if (artist.includes(q)) return 40
  return 20
}

function isSameFoundSong(track: MusicTrack, hit: YouTubeSearchHit): boolean {
  if (track.sourceId && track.sourceId === hit.videoId) return true
  if (track.sourceUrl && track.sourceUrl === hit.sourceUrl) return true
  const title = normalizeSongText(track.title)
  const hitTitle = normalizeSongText(hit.title)
  return title.length > 0 && title === hitTitle
}

function TrackMarks({ track }: { track: MusicTrack }): React.JSX.Element {
  return (
    <span className="music-track-marks">
      {isYouTubeTrack(track) && (
        <span className="music-mark is-youtube" title="YouTube">
          YT
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
  downloading,
  onPlay,
  onFavorite,
  onDownload,
  onRemove
}: {
  track: MusicTrack
  active: boolean
  favorited: boolean
  downloading?: boolean
  onPlay: () => void
  onFavorite: () => void
  onDownload?: () => void
  onRemove: () => void
}): React.JSX.Element {
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
        {onDownload && (
          <button
            type="button"
            className="music-icon-btn"
            onClick={onDownload}
            disabled={downloading}
            aria-label={downloading ? 'Downloading' : `Download ${track.title}`}
          >
            {downloading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
          </button>
        )}
        <button type="button" className="music-icon-btn music-track-remove" onClick={onRemove} aria-label="Remove">
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
    </div>
  )
}

function SearchHitRow({
  hit,
  playing,
  downloading,
  downloaded,
  onPlay,
  onDownload
}: {
  hit: YouTubeSearchHit
  playing: boolean
  downloading: boolean
  downloaded: boolean
  onPlay: () => void
  onDownload: () => void
}): React.JSX.Element {
  return (
    <div className={cn('music-youtube-hit', playing && 'is-active')}>
      <button type="button" className="music-youtube-main" onClick={onPlay} disabled={playing}>
        {hit.thumbnailUrl ? (
          <img className="music-youtube-thumb" src={hit.thumbnailUrl} alt="" />
        ) : (
          <span className="music-youtube-thumb is-empty" />
        )}
        <span className="min-w-0 flex-1 text-left">
          <span className="block truncate text-[11px] text-text-primary">{hit.title}</span>
          <span className="block truncate text-[10px] text-text-muted">
            {hit.channel ?? 'YouTube'}
            {hit.durationSec ? ` · ${formatDurationSec(hit.durationSec)}` : ''}
            {downloading ? ' · Downloading' : downloaded ? ' · Downloaded' : ''}
          </span>
        </span>
      </button>
      <button
        type="button"
        className="music-icon-btn"
        aria-label={`Play ${hit.title}`}
        disabled={playing}
        onClick={onPlay}
      >
        {playing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
      </button>
      <button
        type="button"
        className="music-icon-btn"
        aria-label={downloaded ? `${hit.title} already downloaded` : `Download ${hit.title}`}
        disabled={downloading || downloaded}
        onClick={onDownload}
      >
        {downloading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
      </button>
    </div>
  )
}

export function MusicPanel(): React.JSX.Element {
  const [view, setView] = useState<LibraryView>('all')
  const [query, setQuery] = useState('')
  const [searchError, setSearchError] = useState<string | null>(null)
  const [playingId, setPlayingId] = useState<string | null>(null)
  const [downloadingId, setDownloadingId] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<MusicTrack | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [searchedQuery, setSearchedQuery] = useState('')

  const bootstrap = useMusicStore((state) => state.bootstrap)
  const loading = useMusicStore((state) => state.loading)
  const tracks = useMusicStore((state) => state.tracks)
  const recent = useMusicStore((state) => state.recent)
  const favoriteIds = useMusicStore((state) => state.favoriteIds)
  const currentTrackId = useMusicStore((state) => state.currentTrackId)
  const importPaths = useMusicStore((state) => state.importPaths)
  const playTrack = useMusicStore((state) => state.playTrack)
  const removeTrack = useMusicStore((state) => state.removeTrack)
  const toggleFavorite = useMusicStore((state) => state.toggleFavorite)
  const searchYouTube = useMusicStore((state) => state.searchYouTube)
  const playYouTubeResult = useMusicStore((state) => state.playYouTubeResult)
  const youtubeResults = useMusicStore((state) => state.youtubeResults)
  const youtubeSearching = useMusicStore((state) => state.youtubeSearching)
  const downloadFromUrl = useDownloadStore((state) => state.downloadFromUrl)
  const jobs = useDownloadStore((state) => state.jobs)
  const bootstrapDownloads = useDownloadStore((state) => state.bootstrap)

  useEffect(() => {
    void bootstrap()
    void bootstrapDownloads()
  }, [bootstrap, bootstrapDownloads])

  const favorites = useMemo(() => favoriteTracks(tracks, favoriteIds), [tracks, favoriteIds])
  const downloaded = useMemo(() => tracks.filter(isDownloadedTrack), [tracks])
  const libraryTracks = useMemo(() => {
    const seen = new Set<string>()
    return [...tracks]
      .sort((a, b) => (b.lastPlayedAt ?? b.addedAt) - (a.lastPlayedAt ?? a.addedAt))
      .filter((track) => {
        const key = track.sourceId ? `${track.source}:${track.sourceId}` : track.id
        if (seen.has(key) || seen.has(track.id)) return false
        seen.add(key)
        seen.add(track.id)
        return true
      })
  }, [tracks])
  const searchHits = useMemo(() => youtubeResults.slice(0, FIND_SONG_LIMIT), [youtubeResults])
  const localFindHits = useMemo(() => {
    const q = searchedQuery.trim()
    if (q.length < 2) return []
    return downloaded
      .filter((track) => downloadedMatchesQuery(track, q))
      .sort((a, b) => scoreDownloadedMatch(b, q) - scoreDownloadedMatch(a, q))
      .slice(0, FIND_SONG_LIMIT)
  }, [downloaded, searchedQuery])
  const youtubeFindHits = useMemo(
    () =>
      searchHits
        .filter((hit) => !localFindHits.some((track) => isSameFoundSong(track, hit)))
        .slice(0, FIND_SONG_LIMIT),
    [localFindHits, searchHits]
  )
  const hasFindResults = localFindHits.length > 0 || youtubeFindHits.length > 0 || youtubeSearching || Boolean(searchError)
  const visibleTracks =
    view === 'favorites' ? favorites : view === 'downloaded' ? downloaded : view === 'recent' ? recent : libraryTracks

  const emptyCopy =
    view === 'favorites'
      ? 'Star a track to save it here.'
      : view === 'downloaded'
        ? 'Download a song from Find song to save it here.'
        : view === 'recent'
          ? 'Play a song to see it here.'
          : 'Play, download or drop files here. They will all show up in All.'

  const onDrop = (event: React.DragEvent): void => {
    event.preventDefault()
    const paths = [...event.dataTransfer.files]
      .map((file) => (file as File & { path?: string }).path)
      .filter((path): path is string => typeof path === 'string' && path.length > 0)
    if (paths.length > 0) {
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

  const runSearch = async (): Promise<void> => {
    const next = query.trim()
    if (next.length < 2 || youtubeSearching) return
    setSearchedQuery(next)
    const error = await searchYouTube(next)
    setSearchError(error)
  }

  const clearSearch = (): void => {
    setQuery('')
    setSearchedQuery('')
    setSearchError(null)
    useMusicStore.setState({ youtubeResults: [], youtubeSearching: false })
  }

  const playHit = async (hit: YouTubeSearchHit): Promise<void> => {
    const existing = tracks.find((track) => track.sourceId === hit.videoId || track.sourceUrl === hit.sourceUrl)
    setPlayingId(hit.videoId)
    setSearchError(null)
    if (existing) {
      await playTrack(existing.id)
      setPlayingId(null)
      return
    }
    const error = await playYouTubeResult(hit)
    setPlayingId(null)
    if (error) setSearchError(error)
  }

  const downloadHit = async (hit: YouTubeSearchHit): Promise<void> => {
    setDownloadingId(hit.videoId)
    setSearchError(null)
    const error = await downloadFromUrl(hit.sourceUrl)
    setDownloadingId(null)
    if (error) setSearchError(error)
  }

  const downloadTrack = async (track: MusicTrack): Promise<void> => {
    if (!track.sourceUrl) return
    setDownloadingId(track.id)
    const error = await downloadFromUrl(track.sourceUrl)
    setDownloadingId(null)
    if (error) setSearchError(error)
  }

  const isActiveJob = (sourceUrl?: string): boolean => {
    if (!sourceUrl) return false
    return jobs.some(
      (job) =>
        job.sourceUrl === sourceUrl &&
        (job.status === 'pending' ||
          job.status === 'analyzing' ||
          job.status === 'downloading' ||
          job.status === 'processing')
    )
  }

  const isCompletedJob = (sourceUrl: string): boolean =>
    jobs.some((job) => job.sourceUrl === sourceUrl && job.status === 'completed')

  return (
    <div className="music-panel relative flex h-full flex-col" onDragOver={(event) => event.preventDefault()} onDrop={onDrop}>
      <div className="shrink-0 border-b border-border/50 px-3 py-2">
        <SidebarNowPlaying />
      </div>

      <div className="music-library-nav">
        <button type="button" className={cn('music-library-tab', view === 'all' && 'is-active')} onClick={() => setView('all')}>
          <Music2 className="h-3 w-3" />
          All
        </button>
        <button
          type="button"
          className={cn('music-library-tab', view === 'favorites' && 'is-active')}
          onClick={() => setView('favorites')}
        >
          <Heart className="h-3 w-3" />
          Favorite
        </button>
        <button
          type="button"
          className={cn('music-library-tab', view === 'downloaded' && 'is-active')}
          onClick={() => setView('downloaded')}
        >
          <Download className="h-3 w-3" />
          Downloaded
        </button>
        <button
          type="button"
          className={cn('music-library-tab', view === 'recent' && 'is-active')}
          onClick={() => setView('recent')}
        >
          <Clock className="h-3 w-3" />
          Recent
        </button>
      </div>

      {view === 'all' && (
        <div className="music-search-bar">
          <input
            className="music-download-input"
            value={query}
            placeholder="Find song…"
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => {
              setQuery(event.target.value)
              if (event.target.value.trim().length === 0) clearSearch()
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void runSearch()
            }}
          />
          <button
            type="button"
            className="music-find-btn"
            disabled={query.trim().length < 2 || youtubeSearching}
            onClick={() => void runSearch()}
          >
            {youtubeSearching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
            Find song
          </button>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-1">
        {view === 'all' && hasFindResults && (
          <div className="music-find-results">
            <p className="music-find-label">
              {youtubeSearching && localFindHits.length === 0 ? 'Finding songs…' : 'Found'}
            </p>
            {localFindHits.map((track) => (
              <TrackRow
                key={`local-${track.id}`}
                track={track}
                active={track.id === currentTrackId}
                favorited={favoriteIds.has(track.id)}
                downloading={downloadingId === track.id || isActiveJob(track.sourceUrl)}
                onPlay={() => void playTrack(track.id)}
                onFavorite={() => void toggleFavorite(track.id)}
                onRemove={() => setPendingDelete(track)}
              />
            ))}
            {youtubeFindHits.map((hit) => {
              const saved = tracks.some(
                (track) => isDownloadedTrack(track) && (track.sourceId === hit.videoId || track.sourceUrl === hit.sourceUrl)
              )
              return (
                <SearchHitRow
                  key={hit.videoId}
                  hit={hit}
                  playing={playingId === hit.videoId}
                  downloading={downloadingId === hit.videoId || isActiveJob(hit.sourceUrl)}
                  downloaded={saved || isCompletedJob(hit.sourceUrl)}
                  onPlay={() => void playHit(hit)}
                  onDownload={() => void downloadHit(hit)}
                />
              )
            })}
            {searchError && localFindHits.length === 0 && (
              <p className="px-1 py-1 text-[10px] text-text-muted">{searchError}</p>
            )}
            {youtubeSearching && localFindHits.length > 0 && youtubeFindHits.length === 0 && (
              <p className="px-1 py-1 text-[10px] text-text-muted">Looking on YouTube…</p>
            )}
          </div>
        )}
        {loading && <div className="profile-empty-state">Loading…</div>}
        {!loading && visibleTracks.length === 0 && (view !== 'all' || !hasFindResults) && (
          <div className="profile-empty-state">{emptyCopy}</div>
        )}
        {visibleTracks.map((track) => (
          <TrackRow
            key={track.id}
            track={track}
            active={track.id === currentTrackId}
            favorited={favoriteIds.has(track.id)}
            downloading={downloadingId === track.id || isActiveJob(track.sourceUrl)}
            onPlay={() => void playTrack(track.id)}
            onFavorite={() => void toggleFavorite(track.id)}
            onDownload={canDownloadTrack(track) ? () => void downloadTrack(track) : undefined}
            onRemove={() => setPendingDelete(track)}
          />
        ))}
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
