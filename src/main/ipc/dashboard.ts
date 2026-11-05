import { ipcMain } from 'electron'
import { DASHBOARD_IPC } from '@shared/contracts/dashboard'
import { getClaudeActivity } from '../dashboard/claude-activity'
import { getGitActivity } from '../dashboard/git-activity'
import { getSystemMetrics } from '../dashboard/system-metrics'
import { assertTrustedMainWindow } from './trusted-sender'

export function registerDashboardHandlers(): void {
  ipcMain.handle(DASHBOARD_IPC.SYSTEM, (event) => {
    assertTrustedMainWindow(event)
    return getSystemMetrics()
  })
  ipcMain.handle(DASHBOARD_IPC.CLAUDE_ACTIVITY, (event) => {
    assertTrustedMainWindow(event)
    return getClaudeActivity()
  })
  ipcMain.handle(DASHBOARD_IPC.GIT_ACTIVITY, (event, force: unknown) => {
    assertTrustedMainWindow(event)
    return getGitActivity(force === true)
  })
}
