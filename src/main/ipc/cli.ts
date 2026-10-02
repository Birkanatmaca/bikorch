import { ipcMain } from 'electron'
import { CLI_IPC, type PtyKind } from '@shared/contracts/pty'
import { inspectCli } from '../cli/health'
import { installCli } from '../cli/install-cli'
import { getCliSetupSnapshot } from '../cli/install-state'
import { initializeManagedSetup } from '../cli/setup-recovery'
import { AI_ACCOUNT_KINDS } from '@shared/contracts/accounts'
import { assertTrustedMainWindow } from './trusted-sender'

export function registerCliHandlers(): void {
  getCliSetupSnapshot()
  void initializeManagedSetup()
  ipcMain.handle(CLI_IPC.DETECT, (event, kind: unknown) => {
    assertTrustedMainWindow(event)
    if (
      kind !== 'cursor' &&
      kind !== 'claude' &&
      kind !== 'gemini' &&
      kind !== 'antigravity' &&
      kind !== 'codex'
    ) {
      return { installed: false, command: null }
    }
    return inspectCli(kind)
  })

  ipcMain.handle(CLI_IPC.INSTALL, async (event, kind: unknown) => {
    assertTrustedMainWindow(event)
    if (!AI_ACCOUNT_KINDS.includes(kind as CliDetectKind)) {
      return { ok: false, error: 'Unknown CLI provider' }
    }
    return installCli(kind as CliDetectKind)
  })

  ipcMain.handle(CLI_IPC.STATUS, (event) => {
    assertTrustedMainWindow(event)
    return getCliSetupSnapshot()
  })
}

export type CliDetectKind = Exclude<PtyKind, 'terminal'>
