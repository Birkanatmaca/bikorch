import { net } from 'electron'
import type { SpotifyError } from '@shared/contracts/music'
import { classifySpotifyHttpError, spotifyError } from './spotify-errors'
import { getSpotifyAccessToken } from './spotify-auth'

const API_ROOT = 'https://api.spotify.com'

export interface SpotifyRequestOptions {
  method: 'GET' | 'PUT' | 'POST' | 'DELETE'
  path: string
  query?: Record<string, string | undefined>
  body?: unknown
  allowEmpty?: boolean
}

export type SpotifyRequestResult =
  | { ok: true; status: number; json: unknown | null }
  | { ok: false; error: SpotifyError }

function buildUrl(path: string, query?: Record<string, string | undefined>): string {
  const url = new URL(path.startsWith('http') ? path : `${API_ROOT}${path}`)
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value) url.searchParams.set(key, value)
    }
  }
  return url.toString()
}

async function readBody(response: Response): Promise<string> {
  try {
    return await response.text()
  } catch {
    return ''
  }
}

async function authorizedFetch(
  token: string,
  options: SpotifyRequestOptions
): Promise<Response> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`
  }
  if (options.body !== undefined) headers['Content-Type'] = 'application/json'
  return net.fetch(buildUrl(options.path, options.query), {
    method: options.method,
    headers,
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {})
  })
}

export async function spotifyRequest(options: SpotifyRequestOptions): Promise<SpotifyRequestResult> {
  const first = await getSpotifyAccessToken()
  if (!first.token) {
    return {
      ok: false,
      error: spotifyError(
        first.error?.includes('expired') ? 'TOKEN_EXPIRED' : 'NOT_CONNECTED',
        first.error ?? 'Spotify is not connected.'
      )
    }
  }

  let response: Response
  try {
    response = await authorizedFetch(first.token, options)
  } catch {
    return { ok: false, error: spotifyError('NETWORK_ERROR', 'Could not reach Spotify.') }
  }

  if (response.status === 401) {
    const refreshed = await getSpotifyAccessToken({ forceRefresh: true })
    if (!refreshed.token) {
      return {
        ok: false,
        error: spotifyError('TOKEN_EXPIRED', refreshed.error ?? 'Spotify session expired. Connect again.')
      }
    }
    try {
      response = await authorizedFetch(refreshed.token, options)
    } catch {
      return { ok: false, error: spotifyError('NETWORK_ERROR', 'Could not reach Spotify.') }
    }
  }

  if (response.ok || response.status === 204) {
    if (options.allowEmpty || response.status === 204) {
      return { ok: true, status: response.status, json: null }
    }
    const text = await readBody(response)
    if (!text.trim()) return { ok: true, status: response.status, json: null }
    try {
      return { ok: true, status: response.status, json: JSON.parse(text) as unknown }
    } catch {
      return { ok: false, error: spotifyError('UNKNOWN', 'Spotify returned an unreadable response.') }
    }
  }

  const body = await readBody(response)
  return {
    ok: false,
    error: classifySpotifyHttpError({
      status: response.status,
      body,
      retryAfter: response.headers.get('retry-after'),
      endpoint: options.path
    })
  }
}
