import { createHash, randomBytes } from 'crypto'
import { app, safeStorage, shell } from 'electron'
import { createServer, type Server } from 'http'
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'fs'
import { join } from 'path'
import { net } from 'electron'
import { readMetaValue, writeMetaValue } from '../persistence/database'

const REDIRECT_PORT = 45893
const REDIRECT_PATH = '/callback'
const REDIRECT_URI = `http://127.0.0.1:${REDIRECT_PORT}${REDIRECT_PATH}`
const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token'
const SPOTIFY_AUTH_URL = 'https://accounts.spotify.com/authorize'

const SCOPES = [
  'streaming',
  'user-read-email',
  'user-read-private',
  'user-modify-playback-state',
  'user-read-playback-state',
  'user-top-read',
  'user-library-read'
].join(' ')

interface SpotifyTokens {
  accessToken: string
  refreshToken: string
  expiresAt: number
  email?: string
  displayName?: string
  product?: 'premium' | 'free' | 'unknown'
}

export interface SpotifyConnectionStatus {
  connected: boolean
  email?: string
  hasClientId: boolean
  redirectUri: string
  premiumRequiredNote: string
}

function credentialPath(): string {
  return join(app.getPath('userData'), 'music', 'spotify-session.bin')
}

function readClientId(): string | null {
  const fromMeta = readMetaValue('music_spotify_client_id')
  if (fromMeta?.trim()) return fromMeta.trim()
  const fromEnv = process.env['BIKORCH_SPOTIFY_CLIENT_ID']?.trim()
  return fromEnv || null
}

export function setSpotifyClientId(clientId: string): void {
  writeMetaValue('music_spotify_client_id', clientId.trim())
}

export function getSpotifyClientId(): string | null {
  return readClientId()
}

function base64Url(buffer: Buffer): string {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function pkcePair(): { verifier: string; challenge: string } {
  const verifier = base64Url(randomBytes(32))
  const challenge = base64Url(createHash('sha256').update(verifier).digest())
  return { verifier, challenge }
}

function loadTokens(): SpotifyTokens | null {
  const path = credentialPath()
  if (!existsSync(path) || !safeStorage.isEncryptionAvailable()) return null
  try {
    const parsed = JSON.parse(safeStorage.decryptString(readFileSync(path))) as SpotifyTokens
    if (!parsed.accessToken || !parsed.refreshToken) return null
    return parsed
  } catch {
    return null
  }
}

function saveTokens(tokens: SpotifyTokens): void {
  if (!safeStorage.isEncryptionAvailable()) return
  writeFileSync(credentialPath(), safeStorage.encryptString(JSON.stringify(tokens)))
}

function clearTokens(): void {
  const path = credentialPath()
  if (existsSync(path)) unlinkSync(path)
}

async function exchangeCode(clientId: string, code: string, verifier: string): Promise<SpotifyTokens> {
  const body = new URLSearchParams({
    client_id: clientId,
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
    code_verifier: verifier
  })
  const response = await net.fetch(SPOTIFY_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  })
  if (!response.ok) throw new Error('Spotify token exchange failed')
  const payload = (await response.json()) as {
    access_token: string
    refresh_token: string
    expires_in: number
  }
  const tokens: SpotifyTokens = {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    expiresAt: Date.now() + payload.expires_in * 1000 - 30_000
  }
  const profile = await fetchProfile(tokens.accessToken)
  if (profile) Object.assign(tokens, profile)
  saveTokens(tokens)
  return tokens
}

async function refreshAccessToken(clientId: string, refreshToken: string): Promise<SpotifyTokens> {
  const previous = loadTokens()
  const body = new URLSearchParams({
    client_id: clientId,
    grant_type: 'refresh_token',
    refresh_token: refreshToken
  })
  const response = await net.fetch(SPOTIFY_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  })
  if (!response.ok) throw new Error('Spotify refresh failed')
  const payload = (await response.json()) as {
    access_token: string
    expires_in: number
    refresh_token?: string
  }
  const tokens: SpotifyTokens = {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token ?? refreshToken,
    expiresAt: Date.now() + payload.expires_in * 1000 - 30_000,
    ...(previous?.email ? { email: previous.email } : {}),
    ...(previous?.displayName ? { displayName: previous.displayName } : {}),
    ...(previous?.product ? { product: previous.product } : {})
  }
  saveTokens(tokens)
  return tokens
}

async function fetchProfile(
  accessToken: string
): Promise<{ email?: string; displayName?: string; product?: 'premium' | 'free' | 'unknown' } | null> {
  const response = await net.fetch('https://api.spotify.com/v1/me', {
    headers: { Authorization: `Bearer ${accessToken}` }
  })
  if (!response.ok) return null
  const payload = (await response.json()) as { email?: string; display_name?: string; product?: string }
  const product =
    payload.product === 'premium' ? 'premium' : payload.product === 'free' ? 'free' : 'unknown'
  return {
    ...(payload.email ? { email: payload.email } : {}),
    ...(payload.display_name ? { displayName: payload.display_name } : {}),
    product
  }
}

export function getSpotifyStatus(): SpotifyConnectionStatus {
  const tokens = loadTokens()
  const clientId = readClientId()
  return {
    connected: Boolean(tokens?.refreshToken),
    ...(tokens?.email ? { email: tokens.email } : {}),
    ...(tokens?.displayName ? { displayName: tokens.displayName } : {}),
    ...(tokens?.product ? { product: tokens.product } : {}),
    hasClientId: Boolean(clientId),
    redirectUri: REDIRECT_URI,
    premiumRequiredNote:
      tokens?.product === 'free'
        ? 'This account is Free. You can browse and add tracks, but in-app playback needs Spotify Premium.'
        : 'In-app Spotify playback uses the official Web Playback SDK and needs Premium.'
  }
}

export async function getSpotifyAccessToken(): Promise<{ token: string | null; error?: string }> {
  const clientId = readClientId()
  if (!clientId) return { token: null, error: 'Add a Spotify Client ID in Music settings first.' }
  let tokens = loadTokens()
  if (!tokens?.refreshToken) return { token: null, error: 'Spotify is not connected.' }
  if (tokens.expiresAt <= Date.now()) {
    try {
      tokens = await refreshAccessToken(clientId, tokens.refreshToken)
    } catch {
      clearTokens()
      return { token: null, error: 'Spotify session expired. Connect again.' }
    }
  }
  return { token: tokens.accessToken }
}

function waitForOAuthCode(authUrl: string, expectedState: string): Promise<string | null> {
  return new Promise((resolve) => {
    let settled = false
    let server: Server | null = null

    const finish = (code: string | null): void => {
      if (settled) return
      settled = true
      if (server) server.close()
      resolve(code)
    }

    server = createServer((request, response) => {
      if (!request.url?.startsWith(REDIRECT_PATH)) {
        response.writeHead(404)
        response.end()
        return
      }
      const url = new URL(request.url, `http://127.0.0.1:${REDIRECT_PORT}`)
      const state = url.searchParams.get('state')
      const code = url.searchParams.get('code')
      const error = url.searchParams.get('error')
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      response.end(
        '<html><body style="font-family:sans-serif;background:#111;color:#eee;padding:24px">' +
          '<h2>Spotify connected</h2><p>You can close this tab and return to Bikorch.</p>' +
          '<script>window.close()</script></body></html>'
      )
      if (error || !code || state !== expectedState) finish(null)
      else finish(code)
    })

    server.listen(REDIRECT_PORT, '127.0.0.1', () => {
      void shell.openExternal(authUrl)
    })

    setTimeout(() => finish(null), 120_000)
  })
}

export async function connectSpotify(): Promise<{ ok: true } | { ok: false; error: string }> {
  const clientId = readClientId()
  if (!clientId) {
    return {
      ok: false,
      error: 'Set a Spotify Client ID in Music → Privacy, then register the redirect URI in your Spotify app.'
    }
  }

  const { verifier, challenge } = pkcePair()
  const state = base64Url(randomBytes(16))

  const authUrl = new URL(SPOTIFY_AUTH_URL)
  authUrl.searchParams.set('client_id', clientId)
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set('redirect_uri', REDIRECT_URI)
  authUrl.searchParams.set('code_challenge_method', 'S256')
  authUrl.searchParams.set('code_challenge', challenge)
  authUrl.searchParams.set('state', state)
  authUrl.searchParams.set('scope', SCOPES)

  const code = await waitForOAuthCode(authUrl.toString(), state)
  if (!code) return { ok: false, error: 'Spotify sign-in was canceled or timed out.' }

  try {
    await exchangeCode(clientId, code, verifier)
    return { ok: true }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Spotify connection failed'
    }
  }
}

export function disconnectSpotify(): { ok: true } {
  clearTokens()
  return { ok: true }
}

export function openExternalUrl(url: string): { ok: true } {
  void shell.openExternal(url)
  return { ok: true }
}
