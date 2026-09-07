import { useEffect, useState } from 'react'
import { FolderOpen, Play, RefreshCw, Upload } from 'lucide-react'
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
  const spotifyDevices = useMusicStore((state) => state.spotifyDevices)
  const spotifyPlayback = useMusicStore((state) => state.spotifyPlayback)
  const spotifyTopTracks = useMusicStore((state) => state.spotifyTopTracks)
  const settings = useMusicStore((state) => state.settings)
  const setSpotifyClientId = useMusicStore((state) => state.setSpotifyClientId)
  const connectSpotify = useMusicStore((state) => state.connectSpotify)
  const disconnectSpotify = useMusicStore((state) => state.disconnectSpotify)
  const refreshSpotifyDevices = useMusicStore((state) => state.refreshSpotifyDevices)
  const selectSpotifyDevice = useMusicStore((state) => state.selectSpotifyDevice)
  const loadSpotifyTopTracks = useMusicStore((state) => state.loadSpotifyTopTracks)
  const importSpotifyTopTracks = useMusicStore((state) => state.importSpotifyTopTracks)
  const playSpotifyCatalogTrack = useMusicStore((state) => state.playSpotifyCatalogTrack)
  const openExternal = useMusicStore((state) => state.openExternal)
  const openSpotifyTrack = useMusicStore((state) => state.openSpotifyTrack)
  const updateSettings = useMusicStore((state) => state.updateSettings)

  const selectedDevice =
    spotifyDevices.find((device) => device.id === settings.spotifyDeviceId) ?? null
  const deviceStatus = !spotifyStatus?.connected
    ? 'Disconnected'
    : selectedDevice?.isRestricted
      ? 'Restricted'
      : selectedDevice
        ? selectedDevice.isActive
          ? 'Ready'
          : 'Selected'
        : spotifyDevices.length === 0
          ? 'No devices'
          : 'Select a device'

  useEffect(() => {
    if (spotifyStatus?.clientId) setSpotifyClientIdLocal(spotifyStatus.clientId)
  }, [spotifyStatus?.clientId])

  useEffect(() => {
    if (!spotifyStatus?.connected) return
    void loadSpotifyTopTracks(timeRange, 5).then((error) => {
      if (error) setMessage(error)
    })
    void refreshSpotifyDevices()
  }, [loadSpotifyTopTracks, refreshSpotifyDevices, spotifyStatus?.connected, timeRange])

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
          Connect your account, pick an official Spotify device, then play catalog tracks through
          Spotify Connect. Audio plays on that device — not as a YouTube substitute inside Bikorch.
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
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => void openSpotifyTrack()}>
            Open Spotify
          </Button>
        </div>

        {spotifyStatus?.connected && (
          <div className="music-spotify-status">
            <p>
              Spotify connected
              {spotifyStatus.displayName || spotifyStatus.email
                ? ` · ${spotifyStatus.displayName ?? spotifyStatus.email}`
                : ''}
              {spotifyStatus.product && spotifyStatus.product !== 'unknown'
                ? ` · ${spotifyStatus.product === 'premium' ? 'Premium' : 'Free'}`
                : ''}
            </p>
            <p>Mode: Spotify Connect</p>
            <p>Device: {selectedDevice?.name ?? 'None selected'}</p>
            <p>Status: {deviceStatus}</p>
            {spotifyPlayback?.title && (
              <p>
                Now: {spotifyPlayback.isPlaying ? 'Playing' : 'Paused'} {spotifyPlayback.title}
              </p>
            )}
          </div>
        )}

        <p className="text-[10px] text-text-muted">{spotifyStatus?.premiumRequiredNote}</p>
        <p className="text-[10px] text-text-muted">
          In-app Spotify audio is unavailable in this runtime. Select an authorized Spotify Connect
          device or open Spotify. If a command fails, the real provider reason is shown — not every
          403 means Premium is missing.
        </p>

        {spotifyStatus?.connected && (
          <div className="mt-2 flex flex-col gap-2">
            <label className="block">
              <span className="mb-1 block text-text-muted">Playback device</span>
              <select
                className="profile-search w-full"
                value={settings.spotifyDeviceId ?? ''}
                onChange={(event) => {
                  const value = event.target.value
                  void selectSpotifyDevice(value || null)
                }}
              >
                <option value="">Select a Spotify device…</option>
                {spotifyDevices.map((device) => (
                  <option key={device.id} value={device.id} disabled={device.isRestricted}>
                    {device.name}
                    {device.isActive ? ' · active' : ''}
                    {device.isRestricted ? ' · restricted' : ''}
                  </option>
                ))}
              </select>
            </label>
            <Button
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={() => {
                setBusy(true)
                void refreshSpotifyDevices().then((error) => {
                  setBusy(false)
                  setMessage(error ?? (spotifyDevices.length === 0 ? 'No devices yet. Open Spotify, then refresh.' : 'Devices refreshed.'))
                })
              }}
            >
              <RefreshCw className="h-3 w-3" />
              Refresh devices
            </Button>
            {spotifyDevices.length === 0 && (
              <p className="text-[10px] text-text-muted">
                Open Spotify Desktop or another official device, then refresh. Bikorch will not pick
                a device for you.
              </p>
            )}
          </div>
        )}

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
