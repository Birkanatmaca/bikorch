import { ipcMain } from 'electron'
import { DASHBOARD_IPC, type BriefingKind, type BriefingMode } from '@shared/contracts/dashboard'
import { getBriefing } from '../dashboard/briefing'
import { getHomeChatImage, getHomeChatState, resetHomeChat, sendHomeChat, stopHomeChat } from '../dashboard/home-chat'
import { getClaudeActivity } from '../dashboard/claude-activity'
import { getGitActivity } from '../dashboard/git-activity'
import { getSystemMetrics } from '../dashboard/system-metrics'
import { getCleanupAdvice } from '../dashboard/cleanup-advice'
import { assertTrustedMainWindow } from './trusted-sender'

export function registerDashboardHandlers(): void {
  ipcMain.handle(DASHBOARD_IPC.SYSTEM, (event) => {
    assertTrustedMainWindow(event)
    return getSystemMetrics()
  })
  ipcMain.handle(DASHBOARD_IPC.CLEANUP_ADVICE, (event, mode: unknown) => {
    assertTrustedMainWindow(event)
    return getCleanupAdvice(mode === 'force' || mode === 'auto' ? mode : 'cached')
  })
  ipcMain.handle(DASHBOARD_IPC.CLAUDE_ACTIVITY, (event) => {
    assertTrustedMainWindow(event)
    return getClaudeActivity()
  })
  ipcMain.handle(DASHBOARD_IPC.GIT_ACTIVITY, (event, force: unknown) => {
    assertTrustedMainWindow(event)
    return getGitActivity(force === true)
  })
  ipcMain.handle(DASHBOARD_IPC.BRIEFING, (event, kind: unknown, mode: unknown) => {
    assertTrustedMainWindow(event)
    if (kind !== 'news' && kind !== 'tips') throw new Error('Unknown briefing')
    const safeMode: BriefingMode = mode === 'force' || mode === 'auto' ? mode : 'cached'
    return getBriefing(kind as BriefingKind, safeMode)
  })
  ipcMain.handle(DASHBOARD_IPC.CHAT_HISTORY, (event) => {
    assertTrustedMainWindow(event)
    return getHomeChatState()
  })
  ipcMain.handle(DASHBOARD_IPC.CHAT_SEND, (event, input: unknown) => {
    assertTrustedMainWindow(event)
    return sendHomeChat(input)
  })
  ipcMain.handle(DASHBOARD_IPC.CHAT_IMAGE, (event, id: unknown) => {
    assertTrustedMainWindow(event)
    return getHomeChatImage(id)
  })
  ipcMain.handle(DASHBOARD_IPC.CHAT_STOP, (event) => {
    assertTrustedMainWindow(event)
    return stopHomeChat()
  })
  ipcMain.handle(DASHBOARD_IPC.CHAT_RESET, (event) => {
    assertTrustedMainWindow(event)
    return resetHomeChat()
  })
}
