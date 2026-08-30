import { ipcMain } from 'electron'
import { CLI_IPC, type PtyKind } from '@shared/contracts/pty'
import { detectCli } from '../cli/adapters'
import { installCursorCli } from '../cli/install-cli'

export function registerCliHandlers(): void {
  ipcMain.handle(CLI_IPC.DETECT, (_event, kind: unknown) => {
    if (
      kind !== 'cursor' &&
      kind !== 'claude' &&
      kind !== 'gemini' &&
      kind !== 'antigravity' &&
      kind !== 'codex'
    ) {
      return { installed: false, command: null }
    }
    return detectCli(kind)
  })

  ipcMain.handle(CLI_IPC.INSTALL, async (_event, kind: unknown) => {
    if (kind !== 'cursor') {
      return { ok: false, error: 'Only Cursor CLI install is supported right now' }
    }
    return installCursorCli()
  })
}

export type CliDetectKind = Exclude<PtyKind, 'terminal'>
