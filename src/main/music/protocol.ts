import { net, protocol } from 'electron'
import { pathToFileURL } from 'url'
import { parseMusicResource } from '@shared/contracts/music'
import { resolveArtworkFilePath, resolveTrackFilePath } from './library'

export function registerMusicSchemes(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'bikorch-music',
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        corsEnabled: true
      }
    }
  ])
}

async function serveLocalFile(filePath: string): Promise<Response> {
  const response = await net.fetch(pathToFileURL(filePath).href)
  const headers = new Headers(response.headers)
  headers.set('Access-Control-Allow-Origin', '*')
  headers.set('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges')
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  })
}

export function registerMusicProtocol(): void {
  protocol.handle('bikorch-music', async (request) => {
    try {
      const resource = parseMusicResource(request.url)
      if (!resource) return new Response('Not found', { status: 404 })
      const filePath =
        resource.kind === 'art' ? resolveArtworkFilePath(resource.id) : resolveTrackFilePath(resource.id)
      if (!filePath) return new Response('Not found', { status: 404 })
      return await serveLocalFile(filePath)
    } catch {
      return new Response('Error', { status: 500 })
    }
  })
}
