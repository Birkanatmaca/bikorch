import { createServer, type Server, type Socket } from 'net'
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'fs'
import { dirname } from 'path'
import type { IPty } from '@homebridge/node-pty-prebuilt-multiarch'
import * as pty from '@homebridge/node-pty-prebuilt-multiarch'
import {
  encodeMessage,
  feedNdjson,
  type PtyHostClientMessage,
  type PtyHostServerMessage,
  type PtyHostSpawnRequest
} from './protocol'
import { appendOutputBuffer, hostHasRunningSessions } from './session-store'
import { resolveSafeCwd, resolveWindowsSpawnPath } from '../path-validator'

interface HostSession {
  id: string
  kind: string
  accountId?: string
  process: IPty | null
  status: 'running' | 'stopped'
  cols: number
  rows: number
  outputBuffer: string
}

function socketPath(): string {
  const fromEnv = process.env.BIKORCH_PTY_HOST_SOCKET
  if (!fromEnv) throw new Error('BIKORCH_PTY_HOST_SOCKET is required')
  return fromEnv
}

function pidPath(): string {
  const fromEnv = process.env.BIKORCH_PTY_HOST_PID
  if (!fromEnv) throw new Error('BIKORCH_PTY_HOST_PID is required')
  return fromEnv
}

class PtyHostRuntime {
  private sessions = new Map<string, HostSession>()
  private clients = new Set<Socket>()
  private server: Server | null = null
  private idleTimer: ReturnType<typeof setTimeout> | null = null

  start(): void {
    const path = socketPath()
    mkdirSync(dirname(path), { recursive: true })
    if (existsSync(path)) {
      try {
        unlinkSync(path)
      } catch {
        // stale socket
      }
    }

    this.server = createServer((socket) => this.accept(socket))
    this.server.listen(path, () => {
      writeFileSync(pidPath(), String(process.pid))
      this.broadcast({
        v: 1,
        type: 'hello',
        payload: { sessions: this.listSessions() }
      })
    })

    const shutdown = (): void => {
      this.shutdown(false)
      process.exit(0)
    }
    process.on('SIGTERM', shutdown)
    process.on('SIGINT', shutdown)
  }

  private accept(socket: Socket): void {
    this.clients.add(socket)
    this.clearIdleTimer()
    let buffer = ''
    socket.write(
      encodeMessage({
        v: 1,
        type: 'hello',
        payload: { sessions: this.listSessions() }
      })
    )

    socket.on('data', (chunk) => {
      const fed = feedNdjson(buffer, chunk.toString('utf8'))
      buffer = fed.buffer
      for (const line of fed.messages) {
        try {
          const message = JSON.parse(line) as PtyHostClientMessage
          this.handle(socket, message)
        } catch {
          socket.write(encodeMessage({ v: 1, id: 'unknown', type: 'error', error: 'Invalid message' }))
        }
      }
    })

    const onClose = (): void => {
      this.clients.delete(socket)
      this.scheduleIdleExit()
    }
    socket.on('close', onClose)
    socket.on('error', onClose)
  }

  private handle(socket: Socket, message: PtyHostClientMessage): void {
    switch (message.type) {
      case 'ping':
        socket.write(encodeMessage({ v: 1, id: message.id, type: 'pong' }))
        return
      case 'list':
        socket.write(
          encodeMessage({
            v: 1,
            id: message.id,
            type: 'ok',
            payload: undefined
          })
        )
        socket.write(
          encodeMessage({
            v: 1,
            type: 'hello',
            payload: { sessions: this.listSessions() }
          })
        )
        return
      case 'spawn':
        socket.write(encodeMessage(this.spawn(message.id, message.payload)))
        return
      case 'write': {
        const session = this.sessions.get(message.payload.sessionId)
        if (!session?.process || session.status !== 'running') {
          socket.write(encodeMessage({ v: 1, id: message.id, type: 'error', error: 'Terminal session is no longer running' }))
          return
        }
        session.process.write(message.payload.data)
        socket.write(encodeMessage({ v: 1, id: message.id, type: 'ok' }))
        return
      }
      case 'resize': {
        const session = this.sessions.get(message.payload.sessionId)
        if (!session?.process || session.status !== 'running') {
          socket.write(encodeMessage({ v: 1, id: message.id, type: 'error', error: 'Terminal session is no longer running' }))
          return
        }
        const cols = Math.max(20, Math.min(400, Math.floor(message.payload.cols)))
        const rows = Math.max(6, Math.min(200, Math.floor(message.payload.rows)))
        session.cols = cols
        session.rows = rows
        session.process.resize(cols, rows)
        socket.write(encodeMessage({ v: 1, id: message.id, type: 'ok' }))
        return
      }
      case 'kill':
        this.kill(message.payload.sessionId, true)
        socket.write(encodeMessage({ v: 1, id: message.id, type: 'ok' }))
        this.scheduleIdleExit()
        return
      case 'replay': {
        const session = this.sessions.get(message.payload.sessionId)
        socket.write(
          encodeMessage({
            v: 1,
            id: message.id,
            type: 'ok',
            payload: session
              ? {
                  sessionId: session.id,
                  status: session.status,
                  outputBuffer: session.outputBuffer
                }
              : { sessionId: message.payload.sessionId, status: 'stopped', outputBuffer: '' }
          })
        )
        return
      }
    }
  }

  private spawn(requestId: string, payload: PtyHostSpawnRequest): PtyHostServerMessage {
    const existing = this.sessions.get(payload.sessionId)
    if (existing?.process && existing.status === 'running') {
      if (existing.cols !== payload.cols || existing.rows !== payload.rows) {
        existing.cols = payload.cols
        existing.rows = payload.rows
        existing.process.resize(payload.cols, payload.rows)
      }
      return {
        v: 1,
        id: requestId,
        type: 'ok',
        payload: {
          sessionId: payload.sessionId,
          status: 'running',
          reattached: true,
          outputBuffer: existing.outputBuffer
        }
      }
    }

    if (existing) this.kill(payload.sessionId, true)

    const backends =
      process.platform === 'win32' ? [{ useConpty: true }, { useConpty: false }] : [{}]
    let shellProcess: IPty | null = null
    let lastError: unknown = null
    for (const backend of backends) {
      try {
        shellProcess = pty.spawn(
          resolveWindowsSpawnPath(payload.command),
          payload.args.map((arg) =>
            arg.includes('\\') || arg.includes('/') ? resolveWindowsSpawnPath(arg) : arg
          ),
          {
            name: 'xterm-256color',
            cols: payload.cols,
            rows: payload.rows,
            cwd: resolveSafeCwd(payload.cwd),
            env: payload.env,
            ...backend
          }
        )
        break
      } catch (error) {
        lastError = error
      }
    }

    try {
      if (!shellProcess) throw lastError ?? new Error('Unable to start terminal process')

      const session: HostSession = {
        id: payload.sessionId,
        kind: payload.kind,
        ...(payload.accountId ? { accountId: payload.accountId } : {}),
        process: shellProcess,
        status: 'running',
        cols: payload.cols,
        rows: payload.rows,
        outputBuffer: ''
      }
      this.sessions.set(payload.sessionId, session)
      this.clearIdleTimer()

      shellProcess.onData((data) => {
        session.outputBuffer = appendOutputBuffer(session.outputBuffer, data)
        this.broadcast({
          v: 1,
          type: 'event',
          payload: { type: 'data', sessionId: payload.sessionId, data }
        })
      })

      shellProcess.onExit(({ exitCode }) => {
        const current = this.sessions.get(payload.sessionId)
        if (!current || current.process !== shellProcess) return
        this.sessions.delete(payload.sessionId)
        this.broadcast({
          v: 1,
          type: 'event',
          payload: { type: 'exit', sessionId: payload.sessionId, exitCode: exitCode ?? 0 }
        })
        this.broadcast({
          v: 1,
          type: 'event',
          payload: { type: 'status', sessionId: payload.sessionId, status: 'stopped' }
        })
        this.scheduleIdleExit()
      })

      this.broadcast({
        v: 1,
        type: 'event',
        payload: { type: 'status', sessionId: payload.sessionId, status: 'running' }
      })

      return {
        v: 1,
        id: requestId,
        type: 'ok',
        payload: { sessionId: payload.sessionId, status: 'running', reattached: false }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to spawn'
      return { v: 1, id: requestId, type: 'error', error: message }
    }
  }

  private kill(sessionId: string, force: boolean): void {
    const session = this.sessions.get(sessionId)
    if (!session) return
    this.sessions.delete(sessionId)
    if (!session.process) return
    try {
      if (force) session.process.kill()
    } catch {
      // already dead
    }
  }

  private listSessions(): Array<{
    sessionId: string
    kind: string
    accountId?: string
    status: 'running' | 'stopped'
  }> {
    return [...this.sessions.values()].map((session) => ({
      sessionId: session.id,
      kind: session.kind,
      ...(session.accountId ? { accountId: session.accountId } : {}),
      status: session.status
    }))
  }

  private broadcast(message: PtyHostServerMessage): void {
    const encoded = encodeMessage(message)
    for (const client of this.clients) {
      try {
        client.write(encoded)
      } catch {
        // drop broken client
      }
    }
  }

  private scheduleIdleExit(): void {
    if (hostHasRunningSessions(this.sessions) || this.clients.size > 0) return
    this.clearIdleTimer()
    this.idleTimer = setTimeout(() => {
      if (hostHasRunningSessions(this.sessions) || this.clients.size > 0) return
      this.shutdown(true)
      process.exit(0)
    }, 30_000)
  }

  private clearIdleTimer(): void {
    if (!this.idleTimer) return
    clearTimeout(this.idleTimer)
    this.idleTimer = null
  }

  private shutdown(killSessions: boolean): void {
    this.clearIdleTimer()
    if (killSessions) {
      for (const id of [...this.sessions.keys()]) this.kill(id, true)
    }
    for (const client of this.clients) {
      try {
        client.destroy()
      } catch {
        // ignore
      }
    }
    this.clients.clear()
    const path = socketPath()
    this.server?.close()
    if (existsSync(path)) {
      try {
        unlinkSync(path)
      } catch {
        // ignore
      }
    }
  }
}

new PtyHostRuntime().start()
