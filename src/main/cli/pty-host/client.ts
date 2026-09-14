import { connect, type Socket } from 'net'
import { spawn } from 'child_process'
import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync } from 'fs'
import { join } from 'path'
import {
  encodeMessage,
  feedNdjson,
  type PtyHostClientMessage,
  type PtyHostServerMessage,
  type PtyHostSpawnRequest
} from './protocol'
import { recordLog } from '../../logs'

type Pending = {
  resolve: (message: Extract<PtyHostServerMessage, { id: string }>) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export type HostSessionSnapshot = {
  sessionId: string
  kind: string
  accountId?: string
  status: 'running' | 'stopped'
}

class PtyHostClient {
  private socket: Socket | null = null
  private buffer = ''
  private pending = new Map<string, Pending>()
  private seq = 0
  private connecting: Promise<boolean> | null = null
  readonly knownSessions = new Map<string, HostSessionSnapshot>()
  private listeners = new Set<(message: PtyHostServerMessage) => void>()

  paths(): { socketPath: string; pidPath: string; hostScript: string } {
    const root = app.getPath('userData')
    mkdirSync(root, { recursive: true })
    return {
      socketPath: join(root, 'pty-host.sock'),
      pidPath: join(root, 'pty-host.pid'),
      hostScript: join(__dirname, 'pty-host.js')
    }
  }

  onMessage(listener: (message: PtyHostServerMessage) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async ensureConnected(): Promise<boolean> {
    if (this.socket && !this.socket.destroyed) return true
    if (this.connecting) return this.connecting
    this.connecting = this.connectOrSpawn()
    try {
      return await this.connecting
    } finally {
      this.connecting = null
    }
  }

  private async connectOrSpawn(): Promise<boolean> {
    if (await this.tryConnect()) return true
    if (!this.spawnHost()) return false
    for (let attempt = 0; attempt < 40; attempt += 1) {
      await delay(50)
      if (await this.tryConnect()) return true
    }
    recordLog('warn', 'PTY host did not become ready in time', 'pty-host')
    return false
  }

  private spawnHost(): boolean {
    const { socketPath, pidPath, hostScript } = this.paths()
    if (!existsSync(hostScript)) {
      recordLog('warn', `PTY host script missing at ${hostScript}`, 'pty-host')
      return false
    }
    try {
      const child = spawn(process.execPath, [hostScript], {
        detached: true,
        stdio: 'ignore',
        env: {
          ...process.env,
          ELECTRON_RUN_AS_NODE: '1',
          BIKORCH_PTY_HOST_SOCKET: socketPath,
          BIKORCH_PTY_HOST_PID: pidPath
        }
      })
      child.unref()
      recordLog('info', `PTY host spawned (pid ${child.pid ?? 'unknown'})`, 'pty-host')
      return true
    } catch (error) {
      recordLog(
        'error',
        `Failed to spawn PTY host: ${error instanceof Error ? error.message : 'unknown'}`,
        'pty-host'
      )
      return false
    }
  }

  private tryConnect(): Promise<boolean> {
    const { socketPath } = this.paths()
    if (!existsSync(socketPath)) return Promise.resolve(false)

    return new Promise((resolve) => {
      const socket = connect(socketPath)
      let settled = false

      const fail = (): void => {
        if (settled) return
        settled = true
        socket.destroy()
        resolve(false)
      }

      socket.once('connect', () => {
        if (settled) return
        settled = true
        this.attachSocket(socket)
        resolve(true)
      })
      socket.once('error', fail)
      setTimeout(fail, 200)
    })
  }

  private attachSocket(socket: Socket): void {
    this.socket?.destroy()
    this.socket = socket
    this.buffer = ''

    socket.on('data', (chunk) => {
      const fed = feedNdjson(this.buffer, chunk.toString('utf8'))
      this.buffer = fed.buffer
      for (const line of fed.messages) {
        try {
          const message = JSON.parse(line) as PtyHostServerMessage
          this.dispatch(message)
        } catch {
          // ignore malformed
        }
      }
    })

    const onClose = (): void => {
      if (this.socket === socket) this.socket = null
      for (const [id, pending] of this.pending) {
        clearTimeout(pending.timer)
        pending.reject(new Error('PTY host disconnected'))
        this.pending.delete(id)
      }
    }
    socket.on('close', onClose)
    socket.on('error', onClose)
  }

  private dispatch(message: PtyHostServerMessage): void {
    if (message.type === 'hello') {
      this.knownSessions.clear()
      for (const session of message.payload.sessions) {
        this.knownSessions.set(session.sessionId, {
          sessionId: session.sessionId,
          kind: session.kind,
          ...(session.accountId ? { accountId: session.accountId } : {}),
          status: session.status
        })
      }
    }
    if ('id' in message && message.id) {
      const pending = this.pending.get(message.id)
      if (pending) {
        clearTimeout(pending.timer)
        this.pending.delete(message.id)
        pending.resolve(message)
      }
    }
    for (const listener of this.listeners) listener(message)
    if (message.type === 'event') {
      const event = message.payload
      if (event.type === 'exit' || (event.type === 'status' && event.status === 'stopped')) {
        this.knownSessions.delete(event.sessionId)
      } else if (event.type === 'status' && (event.status === 'running' || event.status === 'error')) {
        const existing = this.knownSessions.get(event.sessionId)
        if (existing) existing.status = event.status === 'running' ? 'running' : 'stopped'
      }
    }
  }

  private nextId(): string {
    this.seq += 1
    return `m${this.seq}-${Date.now()}`
  }

  private request(
    message: Exclude<PtyHostClientMessage, { type: 'ping' } | { type: 'list' }> | PtyHostClientMessage
  ): Promise<Extract<PtyHostServerMessage, { id: string }>> {
    return new Promise((resolve, reject) => {
      if (!this.socket || this.socket.destroyed) {
        reject(new Error('PTY host is not connected'))
        return
      }
      const timer = setTimeout(() => {
        this.pending.delete(message.id)
        reject(new Error('PTY host request timed out'))
      }, 15_000)
      this.pending.set(message.id, { resolve, reject, timer })
      this.socket.write(encodeMessage(message))
    })
  }

  async spawn(payload: PtyHostSpawnRequest): Promise<{
    status: 'running' | 'stopped' | 'error'
    reattached?: boolean
    error?: string
    outputBuffer?: string
  }> {
    const response = await this.request({
      v: 1,
      id: this.nextId(),
      type: 'spawn',
      payload
    })
    if (response.type === 'error') {
      return { status: 'error', error: response.error }
    }
    if (response.type === 'ok' && response.payload) {
      return {
        status: response.payload.status,
        reattached: response.payload.reattached,
        error: response.payload.error,
        outputBuffer: response.payload.outputBuffer
      }
    }
    return { status: 'error', error: 'Unexpected host response' }
  }

  async write(sessionId: string, data: string): Promise<void> {
    await this.request({ v: 1, id: this.nextId(), type: 'write', payload: { sessionId, data } })
  }

  async resize(sessionId: string, cols: number, rows: number): Promise<void> {
    await this.request({ v: 1, id: this.nextId(), type: 'resize', payload: { sessionId, cols, rows } })
  }

  async kill(sessionId: string): Promise<void> {
    await this.request({ v: 1, id: this.nextId(), type: 'kill', payload: { sessionId } })
    this.knownSessions.delete(sessionId)
  }

  async replay(sessionId: string): Promise<{ status: 'running' | 'stopped' | 'error'; outputBuffer: string }> {
    const response = await this.request({
      v: 1,
      id: this.nextId(),
      type: 'replay',
      payload: { sessionId }
    })
    if (response.type === 'error') return { status: 'error', outputBuffer: '' }
    if (response.type !== 'ok') return { status: 'stopped', outputBuffer: '' }
    return {
      status: response.payload?.status ?? 'stopped',
      outputBuffer: response.payload?.outputBuffer ?? ''
    }
  }

  /** Disconnect UI from host without killing durable CLI sessions. */
  disconnect(): void {
    this.socket?.destroy()
    this.socket = null
  }

  isConnected(): boolean {
    return Boolean(this.socket && !this.socket.destroyed)
  }

  hostPid(): number | null {
    const { pidPath } = this.paths()
    if (!existsSync(pidPath)) return null
    try {
      const pid = Number(readFileSync(pidPath, 'utf8').trim())
      return Number.isFinite(pid) && pid > 0 ? pid : null
    } catch {
      return null
    }
  }

  runningSessionCount(): number {
    let count = 0
    for (const session of this.knownSessions.values()) {
      if (session.status === 'running') count += 1
    }
    return count
  }

  isHostAlive(): boolean {
    const { pidPath } = this.paths()
    if (!existsSync(pidPath)) return false
    try {
      const pid = Number(readFileSync(pidPath, 'utf8').trim())
      if (!Number.isFinite(pid) || pid <= 0) return false
      process.kill(pid, 0)
      return true
    } catch {
      return false
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export const ptyHostClient = new PtyHostClient()
