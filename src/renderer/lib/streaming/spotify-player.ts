/* eslint-disable @typescript-eslint/no-explicit-any */

function spotifyLog(message: string, extra?: unknown): void {
  if (extra === undefined) {
    console.log(`[spotify] ${message}`)
    return
  }
  try {
    console.log(`[spotify] ${message} ${JSON.stringify(extra)}`)
  } catch {
    console.log(`[spotify] ${message}`)
  }
}

let embeddedBlocked = false

let player: any = null
let deviceId: string | null = null
let initPromise: Promise<string> | null = null
let lastError: string | null = null
let stateHandler: ((state: { positionMs: number; durationMs: number; paused: boolean }) => void) | null =
  null

export function setSpotifyStateHandler(
  handler: ((state: { positionMs: number; durationMs: number; paused: boolean }) => void) | null
): void {
  stateHandler = handler
}

function loadSpotifySdk(): Promise<void> {
  return new Promise((resolve, reject) => {
    if ((window as any).Spotify) {
      spotifyLog('SDK already on window')
      resolve()
      return
    }

    const existing = document.querySelector('script[data-spotify-sdk="1"]')
    if (existing) {
      const started = Date.now()
      const timer = window.setInterval(() => {
        if ((window as any).Spotify) {
          window.clearInterval(timer)
          resolve()
        } else if (Date.now() - started > 15_000) {
          window.clearInterval(timer)
          reject(new Error('Spotify player script loaded but did not start'))
        }
      }, 50)
      return
    }

    let settled = false
    const done = (error?: Error): void => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      if (error) {
        spotifyLog('SDK load failed', error.message)
        reject(error)
      } else {
        spotifyLog('SDK ready callback fired')
        resolve()
      }
    }
    ;(window as any).onSpotifyWebPlaybackSDKReady = () => done()
    const script = document.createElement('script')
    script.src = 'https://sdk.scdn.co/spotify-player.js'
    script.async = true
    script.dataset.spotifySdk = '1'
    script.onerror = () => done(new Error('Could not load the Spotify player script'))
    spotifyLog('injecting SDK script', script.src)
    document.head.appendChild(script)
    const timer = window.setTimeout(() => {
      if ((window as any).Spotify) done()
      else done(new Error('Spotify player script timed out'))
    }, 15_000)
  })
}

async function fetchToken(): Promise<string> {
  const response = await window.api.music.spotify.accessToken()
  if (!response.token) {
    spotifyLog('token missing', response.error ?? 'no error string')
    throw new Error(response.error ?? 'Spotify token unavailable')
  }
  spotifyLog('token ok', { length: response.token.length })
  return response.token
}

function waitForDevice(instance: any): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (ok: string | null, error?: string): void => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      if (ok) resolve(ok)
      else reject(new Error(error || lastError || 'Spotify player device is not ready'))
    }
    const timer = window.setTimeout(() => {
      spotifyLog('ready timed out after 20s', lastError)
      finish(null, lastError || 'Spotify player did not become ready. Premium is required.')
    }, 20_000)

    instance.addListener('ready', ({ device_id }: { device_id: string }) => {
      spotifyLog('device ready', device_id)
      deviceId = device_id
      finish(device_id)
    })
    instance.addListener('not_ready', ({ device_id }: { device_id?: string }) => {
      spotifyLog('device not_ready', device_id ?? 'unknown')
      deviceId = null
    })
    instance.addListener('initialization_error', ({ message }: { message: string }) => {
      lastError = message || 'Spotify player failed to start'
      spotifyLog('initialization_error', lastError)
      finish(null, lastError)
    })
    instance.addListener('authentication_error', ({ message }: { message: string }) => {
      lastError = message || 'Spotify authentication failed. Connect again.'
      spotifyLog('authentication_error', lastError)
      finish(null, lastError)
    })
    instance.addListener('account_error', ({ message }: { message: string }) => {
      lastError = message || 'Spotify Premium is required for in-app playback'
      spotifyLog('account_error', lastError)
      finish(null, lastError)
    })
    instance.addListener('playback_error', ({ message }: { message: string }) => {
      lastError = message || 'Spotify playback error'
      spotifyLog('playback_error', lastError)
    })
    instance.addListener('player_state_changed', (state: any) => {
      if (!state) {
        spotifyLog('player_state_changed empty')
        return
      }
      spotifyLog('player_state_changed', {
        paused: Boolean(state.paused),
        position: Number(state.position) || 0,
        duration: Number(state.duration) || 0,
        track: state.track_window?.current_track?.name
      })
      if (!stateHandler) return
      stateHandler({
        positionMs: Number(state.position) || 0,
        durationMs: Number(state.duration) || 0,
        paused: Boolean(state.paused)
      })
    })
  })
}

export async function ensureSpotifyPlayer(): Promise<string> {
  if (player && deviceId) {
    spotifyLog('reusing device', deviceId)
    return deviceId
  }
  if (initPromise) {
    spotifyLog('waiting for in-flight player init')
    return initPromise
  }

  initPromise = (async () => {
    lastError = null
    spotifyLog('starting player init')
    await loadSpotifySdk()
    if (!(window as any).Spotify) {
      throw new Error('Spotify player SDK is unavailable')
    }

    player = new (window as any).Spotify.Player({
      name: 'Bikorch',
      getOAuthToken: (callback: (token: string) => void) => {
        spotifyLog('SDK asked for OAuth token')
        void fetchToken()
          .then(callback)
          .catch((error) => {
            spotifyLog('token callback failed', error instanceof Error ? error.message : error)
            callback('')
          })
      },
      volume: 0.8
    })

    const ready = waitForDevice(player)
    const connected = await player.connect()
    spotifyLog('player.connect()', connected)
    if (!connected) {
      throw new Error('Spotify player could not connect')
    }
    return ready
  })().catch((error) => {
    spotifyLog('player init failed', error instanceof Error ? error.message : error)
    disconnectSpotifyPlayer()
    throw error
  })

  return initPromise
}

async function playOnDevice(token: string, trackId: string, id: string): Promise<Response> {
  return fetch(`https://api.spotify.com/v1/me/player/play?device_id=${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ uris: [`spotify:track:${trackId}`] })
  })
}

async function readErrorBody(response: Response): Promise<string> {
  try {
    const text = await response.text()
    return text.slice(0, 400)
  } catch {
    return ''
  }
}

interface SpotifyDevice {
  id: string
  name: string
  type: string
  is_active: boolean
}

async function listDevices(token: string): Promise<SpotifyDevice[]> {
  const response = await fetch('https://api.spotify.com/v1/me/player/devices', {
    headers: { Authorization: `Bearer ${token}` }
  })
  spotifyLog('devices API', { status: response.status })
  if (!response.ok) return []
  const payload = (await response.json()) as { devices?: Array<Partial<SpotifyDevice>> }
  return (payload.devices ?? []).flatMap((device) =>
    typeof device.id === 'string' && device.id
      ? [
          {
            id: device.id,
            name: typeof device.name === 'string' ? device.name : 'Spotify',
            type: typeof device.type === 'string' ? device.type : 'unknown',
            is_active: device.is_active === true
          }
        ]
      : []
  )
}

async function hasWidevine(): Promise<boolean> {
  const request = navigator.requestMediaKeySystemAccess
  if (typeof request !== 'function') return false
  try {
    await request.call(navigator, 'com.widevine.alpha', [
      {
        initDataTypes: ['cenc'],
        audioCapabilities: [{ contentType: 'audio/mp4; codecs="mp4a.40.2"' }]
      }
    ])
    return true
  } catch {
    return false
  }
}

async function playOnExistingDevice(token: string, trackId: string): Promise<boolean> {
  const devices = await listDevices(token)
  spotifyLog(
    'devices',
    devices.map((device) => ({ name: device.name, type: device.type, active: device.is_active }))
  )
  const target = devices.find((device) => device.is_active) ?? devices[0]
  if (!target) return false
  spotifyLog('using existing device', { name: target.name, type: target.type })
  const play = await playOnDevice(token, trackId, target.id)
  spotifyLog('existing-device play', { status: play.status })
  if (play.ok || play.status === 204) return true
  if (play.status === 404) {
    await new Promise((resolve) => setTimeout(resolve, 600))
    const retry = await playOnDevice(token, trackId, target.id)
    spotifyLog('existing-device retry', { status: retry.status })
    return retry.ok || retry.status === 204
  }
  return false
}

async function openInSpotify(trackId: string): Promise<void> {
  const desktop = `spotify:track:${trackId}`
  const web = `https://open.spotify.com/track/${trackId}`
  spotifyLog('opening Spotify app/web', trackId)
  try {
    await window.api.music.openExternal(desktop)
  } catch {
    await window.api.music.openExternal(web)
  }
}

const SPOTIFY_EMBED_EVENT = 'bikorch-spotify-embed'

export function spotifyEmbedSrc(trackId: string, generation: number): string {
  const url = new URL(`https://open.spotify.com/embed/track/${encodeURIComponent(trackId)}`)
  url.searchParams.set('utm_source', 'generator')
  url.searchParams.set('theme', '0')
  url.searchParams.set('autoplay', '1')
  url.searchParams.set('t', String(generation))
  return url.toString()
}

export async function playSpotifyTrack(trackId: string): Promise<void> {
  spotifyLog('play requested', trackId)
  const generation = Date.now()
  window.dispatchEvent(
    new CustomEvent(SPOTIFY_EMBED_EVENT, { detail: { trackId, generation } })
  )
  spotifyLog('in-app official embed', trackId)

  const widevine = await hasWidevine()
  spotifyLog('widevine', widevine)
  if (!embeddedBlocked && widevine) {
    try {
      await playViaEmbeddedPlayer(trackId)
      return
    } catch (error) {
      spotifyLog('sdk fallback failed', error instanceof Error ? error.message : error)
      embeddedBlocked = true
    }
  }

  const token = await fetchToken().catch(() => null)
  if (token && (await playOnExistingDevice(token, trackId))) {
    spotifyLog('also playing on an existing Spotify device')
  }
}

export function onSpotifyEmbedChange(
  handler: (detail: { trackId: string; generation: number }) => void
): () => void {
  const listener = (event: Event): void => {
    const detail = (event as CustomEvent<{ trackId: string; generation: number }>).detail
    if (detail?.trackId) handler(detail)
  }
  window.addEventListener(SPOTIFY_EMBED_EVENT, listener)
  return () => window.removeEventListener(SPOTIFY_EMBED_EVENT, listener)
}

async function playViaEmbeddedPlayer(trackId: string): Promise<void> {
  const id = await ensureSpotifyPlayer()
  const token = await fetchToken()

  const transfer = await fetch('https://api.spotify.com/v1/me/player', {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ device_ids: [id], play: false })
  }).catch((error) => {
    spotifyLog('transfer threw', error instanceof Error ? error.message : error)
    return null
  })
  if (transfer) {
    spotifyLog('transfer device', { status: transfer.status, deviceId: id })
    if (!transfer.ok && transfer.status !== 204 && transfer.status !== 404) {
      spotifyLog('transfer body', await readErrorBody(transfer))
    }
  }

  await new Promise((resolve) => setTimeout(resolve, 250))

  let play = await playOnDevice(token, trackId, id)
  spotifyLog('play API', { status: play.status, trackId, deviceId: id })
  if (play.status === 404 || play.status === 202) {
    spotifyLog('play retry after', play.status)
    await new Promise((resolve) => setTimeout(resolve, 700))
    play = await playOnDevice(token, trackId, id)
    spotifyLog('play API retry', { status: play.status })
  }
  if (play.ok || play.status === 204) {
    spotifyLog('play accepted')
    return
  }
  const body = await readErrorBody(play)
  spotifyLog('play failed', { status: play.status, body })
  if (play.status === 401) throw new Error('Spotify session expired. Connect again.')
  if (play.status === 403) throw new Error('Spotify Premium is required to play this track here.')
  if (play.status === 404) throw new Error('Spotify player device is not ready')
  throw new Error(body || 'Spotify playback failed.')
}

export async function pauseSpotify(): Promise<void> {
  if (player) {
    await player.pause?.()
    return
  }
  const token = await fetchToken().catch(() => null)
  if (!token) return
  await fetch('https://api.spotify.com/v1/me/player/pause', {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}` }
  }).catch(() => undefined)
}

export async function resumeSpotify(): Promise<void> {
  if (player) {
    await player.resume?.()
    return
  }
  const token = await fetchToken().catch(() => null)
  if (!token) return
  await fetch('https://api.spotify.com/v1/me/player/play', {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}` }
  }).catch(() => undefined)
}

export async function setSpotifyVolume(volume: number): Promise<void> {
  if (player) {
    await player.setVolume?.(Math.min(1, Math.max(0, volume)))
    return
  }
  const token = await fetchToken().catch(() => null)
  if (!token) return
  await fetch(`https://api.spotify.com/v1/me/player/volume?volume_percent=${Math.round(Math.min(1, Math.max(0, volume)) * 100)}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}` }
  }).catch(() => undefined)
}

export function disconnectSpotifyPlayer(): void {
  void player?.disconnect?.()
  player = null
  deviceId = null
  initPromise = null
}
