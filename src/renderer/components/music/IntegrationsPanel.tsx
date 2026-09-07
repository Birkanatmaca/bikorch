import { useEffect, useState } from 'react'
import { FolderOpen, Play, Upload } from 'lucide-react'
import { Button } from '@renderer/components/ui/Button'
import { formatTrackDuration, useMusicStore } from '@renderer/stores/music-store'
import type { SpotifyTimeRange } from '@shared/contracts/music'

const DASHBOARD_URL = 'https://developer.spotify.com/dashboard'

export function IntegrationsPanel(): React.JSX.Element {
  const [spotifyClientId, setSpotifyClientIdLocal] = useState('')
  const [timeRange, setTimeRange] = useState<SpotifyTimeRange>('long_term')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const importFiles = useMusicStore((state) => state.importFiles)
  const importFolder = useMusicStore((state) => state.importFolder)
  const spotifyStatus = useMusicStore((state) => state.spotifyStatus)
  const spotifyTopTracks = useMusicStore((state) => state.spotifyTopTracks)
  const setSpotifyClientId = useMusicStore((state) => state.setSpotifyClientId)
  const connectSpotify = useMusicStore((state) => state.connectSpotify)
  const disconnectSpotify = useMusicStore((state) => state.disconnectSpotify)
  const loadSpotifyTopTracks = useMusicStore((state) => state.loadSpotifyTopTracks)
  const importSpotifyTopTracks = useMusicStore((state) => state.importSpotifyTopTracks)
  const playSpotifyCatalogTrack = useMusicStore((state) => state.playSpotifyCatalogTrack)
  const openExternal = useMusicStore((state) => state.openExternal)
  const settings = useMusicStore((state) => state.settings)
  const updateSettings = useMusicStore((state) => state.updateSettings)

  useEffect(() => {
    if (spotifyStatus?.clientId) setSpotifyClientIdLocal(spotifyStatus.clientId)
  }, [spotifyStatus?.clientId])

  useEffect(() => {
    if (!spotifyStatus?.connected) return
    void loadSpotifyTopTracks(timeRange, 5).then((error) => {
      if (error) setMessage(error)
    })
  }, [loadSpotifyTopTracks, spotifyStatus?.connected, timeRange])

  return (
    <div className="music-page">
      <section className="music-page-card">
        <h3>Local files</h3>
        <p>Add music from this computer to the library.</p>
        <div className="flex flex-wrap gap-1">
          <Button variant="secondary" size="sm" onClick={() => void importFiles()}>
            <Upload className="h-3 w-3" />
            Add files
          </Button>
          <Button variant="secondary" size="sm" onClick={() => void importFolder()}>
            <FolderOpen className="h-3 w-3" />
            Add folder
          </Button>
        </div>
        <label className="mt-2 block">
          <span className="mb-1 block text-text-muted">How files are stored</span>
          <select
            className="profile-search w-full"
            value={settings.libraryMode}
            onChange={(event) =>
              void updateSettings({
                libraryMode: event.target.value === 'managed' ? 'managed' : 'reference'
              })
            }
          >
            <option value="reference">Keep original location</option>
            <option value="managed">Copy into Bikorch</option>
          </select>
        </label>
      </section>

      <section className="music-page-card">
        <h3>Spotify</h3>
        <p>
          Connect your account with a Spotify app Client ID to import your top tracks. Bikorch
          plays them in its own player by finding a public YouTube match. Spotify streams are not
          ripped.
        </p>
        <button
          type="button"
          className="text-left text-[10px] text-accent underline-offset-2 hover:underline"
          onClick={() => void openExternal(DASHBOARD_URL)}
        >
          Open Spotify Developer Dashboard
        </button>
        <label className="mt-2 block">
          <span className="mb-1 block text-text-muted">Client ID</span>
          <input
            className="profile-search w-full"
            value={spotifyClientId}
            placeholder="Spotify app Client ID"
            onChange={(event) => setSpotifyClientIdLocal(event.target.value)}
          />
        </label>
        {spotifyStatus?.redirectUri && (
          <p className="text-[10px] text-text-muted">
            Add this Redirect URI in the Spotify app: {spotifyStatus.redirectUri}
          </p>
        )}
        <div className="flex flex-wrap gap-1">
          <Button
            variant="secondary"
            size="sm"
            disabled={!spotifyClientId.trim() || busy}
            onClick={() => {
              void setSpotifyClientId(spotifyClientId.trim())
              setMessage('Client ID saved.')
            }}
          >
            Save
          </Button>
          {spotifyStatus?.connected ? (
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => void disconnectSpotify()}>
              Disconnect
            </Button>
          ) : (
            <Button
              variant="secondary"
              size="sm"
              disabled={busy || !spotifyStatus?.hasClientId}
              onClick={() => {
                setBusy(true)
                void connectSpotify().then((error) => {
                  setBusy(false)
                  setMessage(error)
                })
              }}
            >
              Connect
            </Button>
          )}
        </div>
        {spotifyStatus?.connected && (
          <p className="text-[10px] text-text-muted">
            Connected as {spotifyStatus.displayName ?? spotifyStatus.email ?? 'Spotify'}
            {spotifyStatus.product === 'premium' ? ' · Premium' : ''}
          </p>
        )}
        <p className="text-[10px] text-text-muted">
          {spotifyStatus?.premiumRequiredNote}
        </p>

        {spotifyStatus?.connected && (
          <div className="mt-3 flex flex-col gap-2">
            <label className="block">
              <span className="mb-1 block text-text-muted">Top tracks</span>
              <select
                className="profile-search w-full"
                value={timeRange}
                onChange={(event) => setTimeRange(event.target.value as SpotifyTimeRange)}
              >
                <option value="short_term">Last 4 weeks</option>
                <option value="medium_term">Last 6 months</option>
                <option value="long_term">All time</option>
              </select>
            </label>
            <div className="flex flex-wrap gap-1">
              <Button
                variant="secondary"
                size="sm"
                disabled={busy}
                onClick={() => {
                  setBusy(true)
                  void importSpotifyTopTracks(timeRange, 5).then((error) => {
                    setBusy(false)
                    setMessage(error ?? 'Top tracks added to the library.')
                  })
                }}
              >
                Add to library
              </Button>
            </div>
            {spotifyTopTracks.length === 0 ? (
              <p className="text-[10px] text-text-muted">No top tracks yet. Play more on Spotify, then refresh.</p>
            ) : (
              <div className="flex flex-col gap-1">
                {spotifyTopTracks.map((track) => (
                  <div key={track.sourceId} className="music-spotify-row">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[11px] text-text-primary">{track.title}</p>
                      <p className="truncate text-[10px] text-text-muted">{track.artist}</p>
                    </div>
                    <span className="text-[10px] tabular-nums text-text-muted">
                      {formatTrackDuration(track.durationMs)}
                    </span>
                    <button
                      type="button"
                      className="music-icon-btn"
                      aria-label={`Play ${track.title}`}
                      disabled={busy}
                      onClick={() => {
                        setBusy(true)
                        void playSpotifyCatalogTrack(track.sourceId).then((error) => {
                          setBusy(false)
                          if (error) setMessage(error)
                        })
                      }}
                    >
                      <Play className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        {message && <p className="text-[10px] text-text-muted">{message}</p>}
      </section>

      <section className="music-page-card">
        <h3>YouTube</h3>
        <p>Paste a YouTube link in Downloads to save the audio into the library.</p>
      </section>
    </div>
  )
}
