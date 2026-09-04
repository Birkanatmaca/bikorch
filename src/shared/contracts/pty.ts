export type PtyKind =
  | 'terminal'
  | 'claude'
  | 'cursor'
  | 'gemini'
  | 'antigravity'
  | 'codex'

export type PtySessionStatus =
  | 'starting'
  | 'running'
  | 'waiting'
  | 'busy'
  | 'stopped'
  | 'error'

export type PtyLaunchMode = 'normal' | 'login'

export interface PtyCreateRequest {
  sessionId: string
  cwd: string
  kind: PtyKind
  cols?: number
  rows?: number
  launchMode?: PtyLaunchMode
  accountId?: string
}

export type PtyErrorCode = 'CLI_MISSING' | 'ACCOUNT_REQUIRED'

export interface PtyCreateResponse {
  sessionId: string
  status: PtySessionStatus
  error?: string
  code?: PtyErrorCode
  kind?: PtyKind
}

export interface PtyWriteRequest {
  sessionId: string
  data: string
}

export interface PtyResizeRequest {
  sessionId: string
  cols: number
  rows: number
}

export interface PtyKillRequest {
  sessionId: string
}

export type PtyEvent =
  | { type: 'data'; sessionId: string; data: string }
  | { type: 'exit'; sessionId: string; exitCode: number }
  | {
      type: 'status'
      sessionId: string
      status: PtySessionStatus
      error?: string
      code?: PtyErrorCode
      kind?: PtyKind
    }

export const CLI_IPC = {
  DETECT: 'cli:detect',
  INSTALL: 'cli:install'
} as const

export const PTY_IPC = {
  CREATE: 'pty:create',
  WRITE: 'pty:write',
  RESIZE: 'pty:resize',
  KILL: 'pty:kill',
  EVENT: 'pty:event'
} as const
