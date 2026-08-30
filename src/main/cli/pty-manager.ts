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
import { resolveSpawnConfigCandidates, getKindLabel, spawnEnv } from './adapters'
import { isValidSessionId, resolveSafeCwd } from './path-validator'
import {
  getAuthProfileEnv,
  prepareAuthProfileLaunch
} from '../accounts/profile-manager'

interface PtySession {
  id: string
  kind: PtyCreateRequest['kind']
  process: IPty
  webContents: WebContents
  status: PtySessionStatus
  cols: number
  rows: number
}

class PtyManager {
  private sessions = new Map<string, PtySession>()

  async create(request: PtyCreateRequest, webContents: WebContents): Promise<PtyCreateResponse> {
    const { sessionId, kind, cols = 80, rows = 24 } = request

    if (!isValidSessionId(sessionId)) {
      return { sessionId, status: 'error', error: 'Invalid session ID' }
    }

    if (this.sessions.has(sessionId)) {
      this.kill(sessionId)
    }

    const cwd = resolveSafeCwd(request.cwd)
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
    if (request.accountId && kind !== 'terminal') {
      const prepared = await prepareAuthProfileLaunch(
        { kind, accountId: request.accountId },
        request.launchMode ?? 'normal'
      )
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
    const launchArgs =
      request.launchMode === 'login' && (kind === 'cursor' || kind === 'codex')
        ? ['login']
        : []

    for (const spawnConfig of candidates) {
      try {
        const shellProcess = pty.spawn(spawnConfig.command, [...spawnConfig.args, ...launchArgs], {
          name: 'xterm-256color',
          cols: safeCols,
          rows: safeRows,
          cwd,
          env: { ...spawnEnv(), ...profileEnv, ...(spawnConfig.env ?? {}) },
          ...(process.platform === 'win32' ? { useConpty: false } : {})
        })

        const session: PtySession = {
          id: sessionId,
          kind,
          process: shellProcess,
          webContents,
          status: 'running',
          cols: safeCols,
          rows: safeRows
        }

        this.sessions.set(sessionId, session)
        this.emit(webContents, { type: 'status', sessionId, status: 'running' })

        shellProcess.onData((data) => {
          this.emit(webContents, { type: 'data', sessionId, data })
        })

        shellProcess.onExit(({ exitCode }) => {
          const existing = this.sessions.get(sessionId)
          if (!existing || existing.process !== shellProcess) return
          existing.status = 'stopped'
          this.emit(webContents, { type: 'exit', sessionId, exitCode })
          this.emit(webContents, { type: 'status', sessionId, status: 'stopped' })
          this.sessions.delete(sessionId)
        })

        return { sessionId, status: 'running' }
      } catch (error) {
        lastError =
          error instanceof Error
            ? error.message
            : `Failed to start ${getKindLabel(kind)}`
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
    session.process.write(data)
  }

  resize(sessionId: string, cols: number, rows: number): void {
    const session = this.sessions.get(sessionId)
    if (!session) return
    const nextCols = Math.max(20, Math.min(400, Math.floor(cols)))
    const nextRows = Math.max(6, Math.min(200, Math.floor(rows)))
    if (nextCols === session.cols && nextRows === session.rows) return
    session.cols = nextCols
    session.rows = nextRows
    session.process.resize(nextCols, nextRows)
  }

  kill(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (!session) return

    this.sessions.delete(sessionId)
    try {
      session.process.kill()
    } catch {
      // Process may already be dead
    }
  }

  killAll(): void {
    for (const sessionId of this.sessions.keys()) {
      this.kill(sessionId)
    }
  }

  private emit(webContents: WebContents, event: PtyEvent): void {
    if (webContents.isDestroyed()) return
    webContents.send(PTY_IPC.EVENT, event)
  }
}

export const ptyManager = new PtyManager()
