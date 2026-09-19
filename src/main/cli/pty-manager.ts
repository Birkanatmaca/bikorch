import type { IPty } from '@homebridge/node-pty-prebuilt-multiarch'
import * as pty from '@homebridge/node-pty-prebuilt-multiarch'
import type { WebContents } from 'electron'
import {
  type PtyCreateRequest,
  type PtyCreateResponse,
  type PtyEvent,
  type PtySessionStatus,
  PTY_IPC
} from '@shared/contracts/pty'
import { resolveSpawnConfigCandidates, getKindLabel, spawnEnv, cliLaunchArgs } from './adapters'
import { isValidSessionId, resolveSafeCwd } from './path-validator'
import {
  getAuthProfileEnv,
  prepareAuthProfileLaunch
} from '../accounts/profile-manager'
import { withAntigravityCredentialLock } from '../accounts/credential-lock'
import { withCursorAccountLock } from '../accounts/cursor-profile'
import { logoutAntigravityCli } from '../accounts/antigravity-logout'
import { markAntigravitySessionAccount } from '../accounts/antigravity-credential'
import { recordLog } from '../logs'
import { ptyHostClient } from './pty-host/client'
import { appendOutputBuffer } from './pty-host/session-store'

interface PtySession {
  id: string
  projectId: string
  kind: PtyCreateRequest['kind']
  accountId?: string
  /** Canonical working directory actually given to the spawned process. */
  cwd: string
  /** Equal to cwd when this session starts in an isolated/integration worktree. */
  worktreePath?: string
  /** Present only for in-process (non-host) sessions. */
  process: IPty | null
  /** True when the process lives in the durable PTY host. */
  durable: boolean
  webContents: WebContents
  status: PtySessionStatus
  cols: number
  rows: number
  /** Bounded output is kept for reattach and trusted internal observers. */
  outputBuffer?: string
}

export interface PtySessionSnapshot {
  sessionId: string
  projectId: string
  kind: PtyCreateRequest['kind']
  accountId?: string
  cwd: string
  worktreePath?: string
  status: PtySessionStatus
}

const OUTPUT_BUFFER_LIMIT = 120_000
const HOST_RELEASE_MS = 8_000

class PtyManager {
  private sessions = new Map<string, PtySession>()
  private observers = new Set<(event: PtyEvent) => void>()
  private hostEventsBound = false
  private hostReleaseTimer: ReturnType<typeof setTimeout> | null = null

  runtimeStats(): { bound: number; durable: number; inProcess: number } {
    let durable = 0
    let inProcess = 0
    for (const session of this.sessions.values()) {
      if (session.durable) durable += 1
      else inProcess += 1
    }
    return { bound: this.sessions.size, durable, inProcess }
  }

  getSessionSnapshot(sessionId: string): PtySessionSnapshot | null {
    const session = this.sessions.get(sessionId)
    if (!session) return null
    return {
      sessionId: session.id,
      projectId: session.projectId,
      kind: session.kind,
      ...(session.accountId ? { accountId: session.accountId } : {}),
      cwd: session.cwd,
      ...(session.worktreePath ? { worktreePath: session.worktreePath } : {}),
      status: session.status
    }
  }

  observe(listener: (event: PtyEvent) => void): () => void {
    this.observers.add(listener)
    return () => this.observers.delete(listener)
  }

  getOutputTail(sessionId: string, maxLength = 8_000): string {
    const output = this.sessions.get(sessionId)?.outputBuffer ?? ''
    return output.slice(-Math.max(1, Math.min(maxLength, OUTPUT_BUFFER_LIMIT)))
  }

  /** Main-process-only write that reports a disconnected session as an error. */
  async writeForSecretary(sessionId: string, data: string): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (!session || session.status === 'stopped' || session.status === 'error') {
      throw new Error('The selected CLI session is no longer available')
    }
    if (session.durable) {
      await ptyHostClient.write(sessionId, data)
      return
    }
    if (!session.process) throw new Error('The selected CLI session is no longer available')
    session.process.write(data)
  }

  async create(request: PtyCreateRequest, webContents: WebContents): Promise<PtyCreateResponse> {
    this.bindHostEvents()
    if (request.kind === 'cursor') {
      if (!request.accountId) {
        return {
          sessionId: request.sessionId,
          status: 'error',
          error: 'Accounts bölümünden bir Cursor hesabı seçin.'
        }
      }
      return withCursorAccountLock(request.accountId, () => this.createSession(request, webContents))
    }
    return this.createSession(request, webContents)
  }

  private bindHostEvents(): void {
    if (this.hostEventsBound) return
    this.hostEventsBound = true
    ptyHostClient.onMessage((message) => {
      if (message.type !== 'event') return
      const event = message.payload
      const session = this.sessions.get(event.sessionId)
      if (!session?.durable) return

      if (event.type === 'data') {
        session.outputBuffer = appendOutputBuffer(session.outputBuffer ?? '', event.data, OUTPUT_BUFFER_LIMIT)
        this.emit(session.webContents, { type: 'data', sessionId: event.sessionId, data: event.data })
        return
      }
      if (event.type === 'exit') {
        this.sessions.delete(event.sessionId)
        this.emit(session.webContents, {
          type: 'exit',
          sessionId: event.sessionId,
          exitCode: event.exitCode
        })
        this.emit(session.webContents, {
          type: 'status',
          sessionId: event.sessionId,
          status: 'stopped'
        })
        this.scheduleHostRelease()
        return
      }
      if (event.type === 'status') {
        session.status = event.status
        this.emit(session.webContents, {
          type: 'status',
          sessionId: event.sessionId,
          status: event.status,
          error: event.error,
          kind: session.kind
        })
      }
    })
  }

  private async createSession(
    request: PtyCreateRequest,
    webContents: WebContents
  ): Promise<PtyCreateResponse> {
    const { sessionId, kind, cols = 80, rows = 24 } = request

    if (!isValidSessionId(sessionId)) {
      return { sessionId, status: 'error', error: 'Invalid session ID' }
    }

    const cwd = resolveSafeCwd(request.cwd)
    const worktreePath = request.worktreePath?.trim() ? cwd : undefined
    const existing = this.sessions.get(sessionId)

    if (existing?.kind === kind && existing.accountId === request.accountId) {
      if (
        existing.projectId !== request.projectId ||
        existing.cwd !== cwd ||
        existing.worktreePath !== worktreePath
      ) {
        return {
          sessionId,
          status: 'error',
          error: 'This CLI session is already bound to a different project or workspace.'
        }
      }
      existing.webContents = webContents
      const nextCols = Math.max(20, Math.min(400, Math.floor(cols) || 80))
      const nextRows = Math.max(6, Math.min(200, Math.floor(rows) || 24))
      if (existing.durable) {
        if (existing.cols !== nextCols || existing.rows !== nextRows) {
          existing.cols = nextCols
          existing.rows = nextRows
          void ptyHostClient.resize(sessionId, nextCols, nextRows)
        }
        const connected = await ptyHostClient.ensureConnected()
        if (connected) {
          try {
            const replay = await ptyHostClient.replay(sessionId)
            this.emit(webContents, { type: 'status', sessionId, status: existing.status, kind })
            if (replay.outputBuffer) {
              existing.outputBuffer = replay.outputBuffer.slice(-OUTPUT_BUFFER_LIMIT)
              this.emit(webContents, { type: 'data', sessionId, data: replay.outputBuffer })
            }
            recordLog('debug', `${getKindLabel(kind)} session reattached (${sessionId})`, 'pty')
            return { sessionId, status: existing.status, reattached: true }
          } catch {
            this.sessions.delete(sessionId)
          }
        } else {
          this.sessions.delete(sessionId)
        }
      } else {
        if (existing.process && (existing.cols !== nextCols || existing.rows !== nextRows)) {
          this.resize(sessionId, nextCols, nextRows)
        }
        this.emit(webContents, { type: 'status', sessionId, status: existing.status, kind })
        if (existing.outputBuffer) {
          this.emit(webContents, { type: 'data', sessionId, data: existing.outputBuffer })
        }
        recordLog('debug', `${getKindLabel(kind)} session reattached (${sessionId})`, 'pty')
        return { sessionId, status: existing.status, reattached: true }
      }
    }

    if (this.sessions.has(sessionId)) {
      this.kill(sessionId)
    }

    if (kind === 'antigravity') {
      for (const session of this.sessions.values()) {
        if (session.kind === kind && session.id !== sessionId) {
          this.kill(session.id)
        }
      }
    }
    if (kind === 'cursor') {
      for (const session of this.sessions.values()) {
        if (session.kind !== kind || session.id === sessionId) continue
        const sameAccount = Boolean(request.accountId && session.accountId === request.accountId)
        if (request.launchMode === 'login' && sameAccount) {
          this.kill(session.id)
        }
      }
    }

    const candidates = resolveSpawnConfigCandidates(kind)
    let lastError: string | null = null

    if (kind !== 'terminal' && candidates.length === 0) {
      const message = `${getKindLabel(kind)} is not installed on this computer.`
      this.emit(webContents, {
        type: 'status',
        sessionId,
        status: 'error',
        error: message,
        code: 'CLI_MISSING',
        kind
      })
      return { sessionId, status: 'error', error: message, code: 'CLI_MISSING', kind }
    }

    const safeCols = Math.max(20, Math.min(400, Math.floor(cols) || 80))
    const safeRows = Math.max(6, Math.min(200, Math.floor(rows) || 24))
    let profileEnv: Record<string, string> = {}
    if (kind === 'antigravity' && !request.accountId) {
      try {
        await withAntigravityCredentialLock(() => logoutAntigravityCli())
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : 'Could not sign out the previous Antigravity account'
        this.emit(webContents, {
          type: 'status',
          sessionId,
          status: 'error',
          error: message,
          kind
        })
        return { sessionId, status: 'error', error: message, kind }
      }
    }
    if (request.accountId && kind !== 'terminal') {
      const accountId = request.accountId
      const prepareLaunch = (): Promise<Awaited<ReturnType<typeof prepareAuthProfileLaunch>>> =>
        prepareAuthProfileLaunch({ kind, accountId }, request.launchMode ?? 'normal')
      const prepared =
        kind === 'antigravity'
          ? await withAntigravityCredentialLock(prepareLaunch)
          : await prepareLaunch()
      if (!prepared.ok) {
        const message = prepared.error ?? `Could not prepare ${getKindLabel(kind)} account`
        this.emit(webContents, {
          type: 'status',
          sessionId,
          status: 'error',
          error: message,
          kind
        })
        return { sessionId, status: 'error', error: message, kind }
      }
      if (request.launchMode !== 'login' && !prepared.ready) {
        const message = `This ${getKindLabel(kind)} account needs to be signed in first.`
        this.emit(webContents, {
          type: 'status',
          sessionId,
          status: 'error',
          error: message,
          kind
        })
        return { sessionId, status: 'error', error: message, kind }
      }
      profileEnv = getAuthProfileEnv(kind, request.accountId)
    }
    const launchArgs = cliLaunchArgs(kind, request.launchMode ?? 'normal')

    const useHost = await ptyHostClient.ensureConnected()

    for (const spawnConfig of candidates) {
      try {
        const command = spawnConfig.command
        const args = [...spawnConfig.args, ...launchArgs]
        const env = { ...spawnEnv(), ...profileEnv, ...(spawnConfig.env ?? {}) }

        if (useHost) {
          const hosted = await ptyHostClient.spawn({
            sessionId,
            kind,
            ...(request.accountId ? { accountId: request.accountId } : {}),
            command,
            args,
            cwd,
            cols: safeCols,
            rows: safeRows,
            env
          })
          if (hosted.status === 'error') {
            lastError = hosted.error ?? `Failed to start ${getKindLabel(kind)}`
            continue
          }

          const session: PtySession = {
            id: sessionId,
            projectId: request.projectId,
            kind,
            ...(request.accountId ? { accountId: request.accountId } : {}),
            cwd,
            ...(worktreePath ? { worktreePath } : {}),
            process: null,
            durable: true,
            webContents,
            status: hosted.status === 'stopped' ? 'stopped' : 'running',
            cols: safeCols,
            rows: safeRows,
            outputBuffer: hosted.outputBuffer ?? ''
          }
          this.sessions.set(sessionId, session)
          this.clearHostRelease()
          this.emit(webContents, { type: 'status', sessionId, status: session.status })
          if (hosted.outputBuffer) {
            this.emit(webContents, { type: 'data', sessionId, data: hosted.outputBuffer })
          }
          if (kind === 'antigravity') {
            markAntigravitySessionAccount(request.accountId ?? null)
          }
          recordLog(
            'info',
            `${getKindLabel(kind)} session ${hosted.reattached ? 'reattached' : 'started'} via host (${sessionId})`,
            'pty'
          )
          return {
            sessionId,
            status: session.status,
            reattached: hosted.reattached
          }
        }

        const shellProcess = pty.spawn(command, args, {
          name: 'xterm-256color',
          cols: safeCols,
          rows: safeRows,
          cwd,
          env,
          ...(process.platform === 'win32' ? { useConpty: false } : {})
        })

        const session: PtySession = {
          id: sessionId,
          projectId: request.projectId,
          kind,
          ...(request.accountId ? { accountId: request.accountId } : {}),
          cwd,
          ...(worktreePath ? { worktreePath } : {}),
          process: shellProcess,
          durable: false,
          webContents,
          status: 'running',
          cols: safeCols,
          rows: safeRows,
          outputBuffer: ''
        }

        this.sessions.set(sessionId, session)
        this.emit(webContents, { type: 'status', sessionId, status: 'running' })
        if (kind === 'antigravity') {
          markAntigravitySessionAccount(request.accountId ?? null)
        }
        recordLog('info', `${getKindLabel(kind)} session started (${sessionId})`, 'pty')

        shellProcess.onData((data) => {
          session.outputBuffer = appendOutputBuffer(session.outputBuffer ?? '', data, OUTPUT_BUFFER_LIMIT)
          this.emit(session.webContents, { type: 'data', sessionId, data })
        })

        shellProcess.onExit(({ exitCode }) => {
          const current = this.sessions.get(sessionId)
          if (!current || current.process !== shellProcess) return
          this.sessions.delete(sessionId)
          this.emit(current.webContents, { type: 'exit', sessionId, exitCode })
          this.emit(current.webContents, { type: 'status', sessionId, status: 'stopped' })
          recordLog(
            exitCode === 0 ? 'info' : 'warn',
            `${getKindLabel(kind)} session exited with code ${exitCode ?? 'unknown'} (${sessionId})`,
            'pty'
          )
        })

        return { sessionId, status: 'running' }
      } catch (error) {
        lastError =
          error instanceof Error ? error.message : `Failed to start ${getKindLabel(kind)}`
      }
    }

    const message =
      lastError ??
      `Failed to start ${getKindLabel(kind)}. Install the CLI and ensure it is on PATH.`

    this.emit(webContents, {
      type: 'status',
      sessionId,
      status: 'error',
      error: message,
      ...(kind !== 'terminal' ? { code: 'CLI_MISSING' as const, kind } : {})
    })
    recordLog('error', message, 'pty')
    if (useHost) this.scheduleHostRelease()

    return {
      sessionId,
      status: 'error',
      error: message,
      ...(kind !== 'terminal' ? { code: 'CLI_MISSING' as const, kind } : {})
    }
  }

  write(sessionId: string, data: string): void {
    const session = this.sessions.get(sessionId)
    if (!session) return
    if (session.durable) {
      void ptyHostClient.write(sessionId, data)
      return
    }
    session.process?.write(data)
  }

  resize(sessionId: string, cols: number, rows: number): void {
    const session = this.sessions.get(sessionId)
    if (!session) return
    const nextCols = Math.max(20, Math.min(400, Math.floor(cols)))
    const nextRows = Math.max(6, Math.min(200, Math.floor(rows)))
    if (nextCols === session.cols && nextRows === session.rows) return
    session.cols = nextCols
    session.rows = nextRows
    if (session.durable) {
      void ptyHostClient.resize(sessionId, nextCols, nextRows)
      return
    }
    session.process?.resize(nextCols, nextRows)
  }

  kill(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (!session) return

    this.sessions.delete(sessionId)
    if (session.durable) {
      void ptyHostClient.kill(sessionId)
      this.scheduleHostRelease()
      return
    }
    if (!session.process) return
    try {
      session.process.kill()
    } catch {
      // Process may already be dead
    }
  }

  killForAccount(kind: Exclude<PtyCreateRequest['kind'], 'terminal'>, accountId: string): void {
    const sessionIds = [...this.sessions.values()]
      .filter(
        (session) =>
          session.kind === kind &&
          (kind === 'antigravity' ||
            session.accountId === accountId ||
            (kind !== 'cursor' && !session.accountId))
      )
      .map((session) => session.id)
    for (const sessionId of sessionIds) this.kill(sessionId)
  }

  killAll(): void {
    for (const sessionId of this.sessions.keys()) {
      this.kill(sessionId)
    }
  }

  /**
   * App quit / update path: drop local UI bindings but leave durable host
   * sessions running so the next launch can reattach.
   */
  releaseForAppQuit(): void {
    this.clearHostRelease()
    for (const [sessionId, session] of [...this.sessions.entries()]) {
      if (session.durable) {
        this.sessions.delete(sessionId)
        continue
      }
      this.kill(sessionId)
    }
    ptyHostClient.disconnect()
    recordLog('info', 'Released durable PTY sessions for app quit/update', 'pty')
  }

  private hasDurableSessions(): boolean {
    for (const session of this.sessions.values()) {
      if (session.durable) return true
    }
    return false
  }

  private scheduleHostRelease(): void {
    if (this.hasDurableSessions()) {
      this.clearHostRelease()
      return
    }
    this.clearHostRelease()
    this.hostReleaseTimer = setTimeout(() => {
      this.hostReleaseTimer = null
      if (this.hasDurableSessions()) return
      ptyHostClient.disconnect()
    }, HOST_RELEASE_MS)
  }

  private clearHostRelease(): void {
    if (!this.hostReleaseTimer) return
    clearTimeout(this.hostReleaseTimer)
    this.hostReleaseTimer = null
  }

  private emit(webContents: WebContents, event: PtyEvent): void {
    for (const observer of this.observers) {
      try {
        observer(event)
      } catch (error) {
        console.warn('[pty] internal observer failed:', error)
      }
    }
    if (webContents.isDestroyed()) return
    webContents.send(PTY_IPC.EVENT, event)
  }
}

export const ptyManager = new PtyManager()
