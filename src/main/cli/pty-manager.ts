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
import { withAntigravityCredentialLock, withCursorCredentialLock } from '../accounts/credential-lock'
import { logoutAntigravityCli } from '../accounts/antigravity-logout'
import { logoutCursorCli } from '../accounts/cursor-logout'
import { markAntigravitySessionAccount } from '../accounts/antigravity-credential'
import { markCursorSessionAccount } from '../accounts/cursor-credential'
import { recordLog } from '../logs'

interface PtySession {
  id: string
  kind: PtyCreateRequest['kind']
  accountId?: string
  process: IPty | null
  webContents: WebContents
  status: PtySessionStatus
  cols: number
  rows: number
  outputBuffer: string
}

const OUTPUT_BUFFER_LIMIT = 120_000

class PtyManager {
  private sessions = new Map<string, PtySession>()

  async create(request: PtyCreateRequest, webContents: WebContents): Promise<PtyCreateResponse> {
    const { sessionId, kind, cols = 80, rows = 24 } = request

    if (!isValidSessionId(sessionId)) {
      return { sessionId, status: 'error', error: 'Invalid session ID' }
    }

    const existing = this.sessions.get(sessionId)

    if (existing?.kind === kind && existing.accountId === request.accountId) {
      existing.webContents = webContents
      const nextCols = Math.max(20, Math.min(400, Math.floor(cols) || 80))
      const nextRows = Math.max(6, Math.min(200, Math.floor(rows) || 24))
      if (existing.process && (existing.cols !== nextCols || existing.rows !== nextRows)) {
        this.resize(sessionId, nextCols, nextRows)
      }
      this.emit(webContents, { type: 'status', sessionId, status: existing.status, kind })
      if (existing.outputBuffer) {
        this.emit(webContents, { type: 'data', sessionId, data: existing.outputBuffer })
      }
      recordLog('debug', `${getKindLabel(kind)} session reattached (${sessionId})`, 'pty')
      return { sessionId, status: existing.status }
    }

    if (existing) {
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
        if (request.launchMode === 'login' || sameAccount) {
          this.kill(session.id)
        }
      }
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
    if (kind === 'antigravity' && !request.accountId) {
      try {
        await withAntigravityCredentialLock(() => logoutAntigravityCli())
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Could not sign out the previous Antigravity account'
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
    if (kind === 'cursor' && !request.accountId) {
      try {
        await withCursorCredentialLock(() => logoutCursorCli())
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Could not sign out the previous Cursor account'
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
          : kind === 'cursor'
            ? await withCursorCredentialLock(prepareLaunch)
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
    const launchArgs =
      request.launchMode === 'login' && (kind === 'codex' || kind === 'cursor') ? ['login'] : []

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
          ...(request.accountId ? { accountId: request.accountId } : {}),
          process: shellProcess,
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
        if (kind === 'cursor') {
          markCursorSessionAccount(request.accountId ?? null)
        }
        recordLog('info', `${getKindLabel(kind)} session started (${sessionId})`, 'pty')

        shellProcess.onData((data) => {
          session.outputBuffer = `${session.outputBuffer}${data}`.slice(-OUTPUT_BUFFER_LIMIT)
          this.emit(session.webContents, { type: 'data', sessionId, data })
        })

        shellProcess.onExit(({ exitCode }) => {
          const existing = this.sessions.get(sessionId)
          if (!existing || existing.process !== shellProcess) return
          existing.status = 'stopped'
          existing.process = null
          this.emit(existing.webContents, { type: 'exit', sessionId, exitCode })
          this.emit(existing.webContents, { type: 'status', sessionId, status: 'stopped' })
          recordLog(
            exitCode === 0 ? 'info' : 'warn',
            `${getKindLabel(kind)} session exited with code ${exitCode ?? 'unknown'} (${sessionId})`,
            'pty'
          )
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
    recordLog('error', message, 'pty')

    return {
      sessionId,
      status: 'error',
      error: message,
      ...(kind !== 'terminal' ? { code: 'CLI_MISSING' as const, kind } : {})
    }
  }

  write(sessionId: string, data: string): void {
    const session = this.sessions.get(sessionId)
    if (!session?.process) return
    session.process.write(data)
  }

  resize(sessionId: string, cols: number, rows: number): void {
    const session = this.sessions.get(sessionId)
    if (!session?.process) return
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
            kind === 'cursor' ||
            !session.accountId ||
            session.accountId === accountId)
      )
      .map((session) => session.id)
    for (const sessionId of sessionIds) this.kill(sessionId)
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
