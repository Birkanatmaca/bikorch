export const PTY_HOST_PROTOCOL = 1

export type PtyHostSpawnRequest = {
  sessionId: string
  kind: string
  accountId?: string
  command: string
  args: string[]
  cwd: string
  cols: number
  rows: number
  env: Record<string, string>
}

export type PtyHostClientMessage =
  | { v: 1; id: string; type: 'ping' }
  | { v: 1; id: string; type: 'spawn'; payload: PtyHostSpawnRequest }
  | { v: 1; id: string; type: 'write'; payload: { sessionId: string; data: string } }
  | { v: 1; id: string; type: 'resize'; payload: { sessionId: string; cols: number; rows: number } }
  | { v: 1; id: string; type: 'kill'; payload: { sessionId: string } }
  | { v: 1; id: string; type: 'replay'; payload: { sessionId: string } }
  | { v: 1; id: string; type: 'list' }

export type PtyHostServerMessage =
  | { v: 1; id: string; type: 'pong' }
  | {
      v: 1
      id: string
      type: 'ok'
      payload?: {
        sessionId: string
        status: 'running' | 'stopped' | 'error'
        reattached?: boolean
        error?: string
        outputBuffer?: string
      }
    }
  | { v: 1; id: string; type: 'error'; error: string }
  | {
      v: 1
      type: 'event'
      payload:
        | { type: 'data'; sessionId: string; data: string }
        | { type: 'exit'; sessionId: string; exitCode: number }
        | { type: 'status'; sessionId: string; status: 'running' | 'stopped' | 'error'; error?: string }
    }
  | {
      v: 1
      type: 'hello'
      payload: {
        sessions: Array<{
          sessionId: string
          kind: string
          accountId?: string
          status: 'running' | 'stopped'
        }>
      }
    }

export function encodeMessage(message: PtyHostClientMessage | PtyHostServerMessage): string {
  return `${JSON.stringify(message)}\n`
}

export function feedNdjson(buffer: string, chunk: string): { buffer: string; messages: string[] } {
  const combined = `${buffer}${chunk}`
  const parts = combined.split('\n')
  return {
    buffer: parts.pop() ?? '',
    messages: parts.filter((line) => line.trim().length > 0)
  }
}
