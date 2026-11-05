export interface RemoteServer {
  id: string
  name: string
  user: string
  host: string
  port: number
}

export interface RemoteServerDraft {
  name: string
  user: string
  host: string
  port: string
}

export interface SshTarget {
  user: string
  host: string
  port: number
}

const USER_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,31}$/
const HOSTNAME_PATTERN =
  /^(?=.{1,253}$)(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)(?:\.(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?))*$/
const IPV4_PATTERN =
  /^(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/

export function sshTargetLabel(target: Pick<RemoteServer, 'user' | 'host' | 'port'>): string {
  const login = `${target.user}@${target.host}`
  return target.port === 22 ? login : `${login}:${target.port}`
}

export function sshCommandArgs(target: Pick<RemoteServer, 'user' | 'host' | 'port'>): string[] {
  return ['-p', String(target.port), `${target.user}@${target.host}`]
}

export function normalizeServerDraft(
  draft: RemoteServerDraft,
  id: string
): { ok: true; server: RemoteServer } | { ok: false; error: string } {
  const name = draft.name.trim()
  const user = draft.user.trim()
  const host = draft.host.trim()
  const portText = draft.port.trim() || '22'

  if (!name) return { ok: false, error: 'Give this server a name.' }
  if (name.length > 48) return { ok: false, error: 'Keep the name under 48 characters.' }
  if (!USER_PATTERN.test(user)) {
    return { ok: false, error: 'User can contain letters, numbers, dots, and dashes.' }
  }
  if (!HOSTNAME_PATTERN.test(host) && !IPV4_PATTERN.test(host)) {
    return { ok: false, error: 'Enter a hostname or an IPv4 address.' }
  }
  if (!/^\d+$/.test(portText)) return { ok: false, error: 'Port must be a number from 1 to 65535.' }
  const port = Number(portText)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return { ok: false, error: 'Port must be a number from 1 to 65535.' }
  }

  return { ok: true, server: { id, name, user, host, port } }
}

export function parseRemoteServer(value: unknown): RemoteServer | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  if (typeof record.id !== 'string' || !record.id.trim()) return null
  const draft = normalizeServerDraft(
    {
      name: typeof record.name === 'string' ? record.name : '',
      user: typeof record.user === 'string' ? record.user : '',
      host: typeof record.host === 'string' ? record.host : '',
      port: typeof record.port === 'number' ? String(record.port) : ''
    },
    record.id.trim()
  )
  return draft.ok ? draft.server : null
}

export function parseRemoteServers(value: unknown): RemoteServer[] {
  if (!Array.isArray(value)) return []
  const servers: RemoteServer[] = []
  const seen = new Set<string>()
  for (const entry of value) {
    const server = parseRemoteServer(entry)
    if (!server || seen.has(server.id)) continue
    seen.add(server.id)
    servers.push(server)
  }
  return servers.slice(0, 40)
}

export function parseSshTarget(value: unknown): SshTarget | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const parsed = parseRemoteServer({
    id: 'target',
    name: 'target',
    user: record.user,
    host: record.host,
    port: record.port
  })
  return parsed ? { user: parsed.user, host: parsed.host, port: parsed.port } : null
}
