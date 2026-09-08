import { net } from 'electron'

interface OEmbedPayload {
  title?: string
  author_name?: string
  thumbnail_url?: string
}

export async function fetchLinkMetadata(
  sourceUrl: string
): Promise<{ title: string; artist?: string; artworkUrl?: string }> {
  const endpoint = `https://www.youtube.com/oembed?url=${encodeURIComponent(sourceUrl)}&format=json`

  try {
    const response = await net.fetch(endpoint, { method: 'GET' })
    if (!response.ok) throw new Error('Metadata unavailable')
    const payload = (await response.json()) as OEmbedPayload
    const title = typeof payload.title === 'string' ? payload.title.trim() : 'Streaming track'
    const artist = typeof payload.author_name === 'string' ? payload.author_name.trim() : undefined
    const artworkUrl =
      typeof payload.thumbnail_url === 'string' ? payload.thumbnail_url.trim() : undefined
    return {
      title: title || 'Streaming track',
      ...(artist ? { artist } : {}),
      ...(artworkUrl ? { artworkUrl } : {})
    }
  } catch {
    return { title: 'Streaming track' }
  }
}
