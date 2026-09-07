import type {
  SpotifyDevice,
  SpotifyPlaybackResult,
  SpotifyPlaybackState
} from '@shared/contracts/music'
import { spotifyTrackUri } from '@shared/music-playback'
import { isSpotifyTrackId, mapSpotifyDevices, mapSpotifyPlaybackState } from './spotify-map'
import { spotifyRequest } from './spotify-client'
import { spotifyError } from './spotify-errors'
import { readMusicSettings, writeMusicSettings } from './store'

export { mapSpotifyDevices, mapSpotifyPlaybackState } from './spotify-map'

const CONFIRM_DELAYS_MS = [350, 700]

export function getSelectedSpotifyDeviceId(): string | null {
  return readMusicSettings().spotifyDeviceId
}

export function selectSpotifyDevice(deviceId: string | null): { ok: true; deviceId: string | null } {
  const settings = readMusicSettings()
  writeMusicSettings({ ...settings, spotifyDeviceId: deviceId })
  return { ok: true, deviceId }
}

export async function listSpotifyDevices(): Promise<
  { ok: true; devices: SpotifyDevice[] } | { ok: false; error: import('@shared/contracts/music').SpotifyError }
> {
  const result = await spotifyRequest({ method: 'GET', path: '/v1/me/player/devices' })
  if (!result.ok) return result
  return { ok: true, devices: mapSpotifyDevices(result.json) }
}

export async function getSpotifyPlaybackState(): Promise<
  { ok: true; state: SpotifyPlaybackState } | { ok: false; error: import('@shared/contracts/music').SpotifyError }
> {
  const result = await spotifyRequest({
    method: 'GET',
    path: '/v1/me/player',
    allowEmpty: true
  })
  if (!result.ok) return result
  const state = mapSpotifyPlaybackState(result.json)
  if (!state) {
    return { ok: false, error: spotifyError('UNKNOWN', 'Spotify returned an unreadable playback state.') }
  }
  return { ok: true, state }
}

function requireSelectedDevice(deviceId?: string): string | null {
  const selected = deviceId?.trim() || getSelectedSpotifyDeviceId()
  return selected && selected.length > 0 ? selected : null
}

async function confirmPlayback(sourceId: string, deviceId: string): Promise<SpotifyPlaybackResult> {
  for (const delay of CONFIRM_DELAYS_MS) {
    await new Promise((resolve) => setTimeout(resolve, delay))
    const confirmed = await getSpotifyPlaybackState()
    if (!confirmed.ok) continue
    const state = confirmed.state
    const matchesTrack = state.trackId === sourceId
    if (matchesTrack && state.isPlaying) {
      return { ok: true, mode: 'connect', deviceId: state.deviceId ?? deviceId, state }
    }
    if (matchesTrack) {
      return { ok: true, mode: 'connect', deviceId: state.deviceId ?? deviceId, state }
    }
  }
  return {
    ok: false,
    mode: 'connect',
    deviceId,
    error: spotifyError(
      'DEVICE_NOT_READY',
      'Spotify accepted the command, but playback was not confirmed. Select the device again or open Spotify.'
    )
  }
}

export async function playSpotifyConnect(sourceId: string, deviceId?: string): Promise<SpotifyPlaybackResult> {
  if (!isSpotifyTrackId(sourceId)) {
    return { ok: false, mode: 'connect', error: spotifyError('UNKNOWN', 'Invalid Spotify track id.') }
  }
  const selected = requireSelectedDevice(deviceId)
  if (!selected) {
    return {
      ok: false,
      mode: 'connect',
      error: spotifyError(
        'NO_ACTIVE_DEVICE',
        'Select a Spotify Connect device in Music → Integration. Open Spotify first if the list is empty.'
      )
    }
  }

  const devices = await listSpotifyDevices()
  if (!devices.ok) return { ok: false, mode: 'connect', error: devices.error }
  const device = devices.devices.find((item) => item.id === selected)
  if (!device) {
    return {
      ok: false,
      mode: 'connect',
      error: spotifyError(
        'DEVICE_NOT_READY',
        'The selected device is gone. Refresh devices and choose an official Spotify device.'
      )
    }
  }
  if (device.isRestricted) {
    return {
      ok: false,
      mode: 'connect',
      deviceId: device.id,
      error: spotifyError('PLAYBACK_RESTRICTED', `${device.name} cannot accept remote playback.`)
    }
  }

  const play = await spotifyRequest({
    method: 'PUT',
    path: '/v1/me/player/play',
    query: { device_id: device.id },
    body: { uris: [spotifyTrackUri(sourceId)] },
    allowEmpty: true
  })
  if (!play.ok) return { ok: false, mode: 'connect', deviceId: device.id, error: play.error }
  return confirmPlayback(sourceId, device.id)
}

async function commandOnDevice(
  method: 'PUT' | 'POST',
  path: string,
  query?: Record<string, string | undefined>
): Promise<SpotifyPlaybackResult> {
  const selected = requireSelectedDevice()
  if (!selected) {
    return {
      ok: false,
      mode: 'connect',
      error: spotifyError('NO_ACTIVE_DEVICE', 'Select a Spotify Connect device first.')
    }
  }
  const result = await spotifyRequest({
    method,
    path,
    query: { device_id: selected, ...query },
    allowEmpty: true
  })
  if (!result.ok) return { ok: false, mode: 'connect', deviceId: selected, error: result.error }
  const state = await getSpotifyPlaybackState()
  return {
    ok: true,
    mode: 'connect',
    deviceId: selected,
    ...(state.ok ? { state: state.state } : {})
  }
}

export function pauseSpotifyConnect(): Promise<SpotifyPlaybackResult> {
  return commandOnDevice('PUT', '/v1/me/player/pause')
}

export function resumeSpotifyConnect(): Promise<SpotifyPlaybackResult> {
  return commandOnDevice('PUT', '/v1/me/player/play')
}

export function nextSpotifyConnect(): Promise<SpotifyPlaybackResult> {
  return commandOnDevice('POST', '/v1/me/player/next')
}

export function previousSpotifyConnect(): Promise<SpotifyPlaybackResult> {
  return commandOnDevice('POST', '/v1/me/player/previous')
}

export function seekSpotifyConnect(positionMs: number): Promise<SpotifyPlaybackResult> {
  return commandOnDevice('PUT', '/v1/me/player/seek', {
    position_ms: String(Math.max(0, Math.round(positionMs)))
  })
}

export function setSpotifyConnectVolume(volume: number): Promise<SpotifyPlaybackResult> {
  const percent = Math.round(Math.min(1, Math.max(0, volume)) * 100)
  return commandOnDevice('PUT', '/v1/me/player/volume', { volume_percent: String(percent) })
}
