import { BrowserWindow, ipcMain } from 'electron'
import { SECRETARY_IPC } from '@shared/contracts/secretary'
import {
  approveSecretaryPlan,
  cancelSecretaryRun,
  clearSecretaryApiKey,
  chatWithSecretary,
  createSecretaryPlan,
  createSecretaryThread,
  failApprovedSecretaryRun,
  getSecretaryRun,
  getSecretarySettings,
  getSecretaryThread,
  listSecretaryRuns,
  listSecretaryThreads,
  rejectSecretaryPlan,
  reviseSecretaryPlan,
  resetSecretaryUsage,
  saveSecretaryApiKey,
  updateSecretarySettings
} from '../secretary/service'
import { dispatchSecretaryRun, prepareSecretaryRun } from '../secretary/orchestrator'
import { answerTrackedSecretaryRun, cancelTrackedSecretaryRun } from '../secretary/result-collector'
import { ptyManager } from '../cli/pty-manager'

function assertTrustedSender(event: Electron.IpcMainInvokeEvent): void {
  if (event.sender.isDestroyed() || !BrowserWindow.fromWebContents(event.sender)) throw new Error('Unauthorized sender')
}

export function registerSecretaryHandlers(): void {
  ipcMain.handle(SECRETARY_IPC.GET_SETTINGS, (event) => { assertTrustedSender(event); return getSecretarySettings() })
  ipcMain.handle(SECRETARY_IPC.SAVE_KEY, (event, key: unknown) => { assertTrustedSender(event); return saveSecretaryApiKey(key) })
  ipcMain.handle(SECRETARY_IPC.CLEAR_KEY, (event) => { assertTrustedSender(event); return clearSecretaryApiKey() })
  ipcMain.handle(SECRETARY_IPC.RESET_USAGE, (event) => { assertTrustedSender(event); return resetSecretaryUsage() })
  ipcMain.handle(SECRETARY_IPC.UPDATE_SETTINGS, (event, settings: unknown) => { assertTrustedSender(event); return updateSecretarySettings(settings) })
  ipcMain.handle(SECRETARY_IPC.CREATE_PLAN, (event, request: unknown) => { assertTrustedSender(event); return createSecretaryPlan(request) })
  ipcMain.handle(SECRETARY_IPC.CHAT, (event, request: unknown) => { assertTrustedSender(event); return chatWithSecretary(request) })
  ipcMain.handle(SECRETARY_IPC.LIST_THREADS, (event, projectId: unknown) => { assertTrustedSender(event); return listSecretaryThreads(projectId) })
  ipcMain.handle(SECRETARY_IPC.CREATE_THREAD, (event, request: unknown) => { assertTrustedSender(event); return createSecretaryThread(request) })
  ipcMain.handle(SECRETARY_IPC.GET_THREAD, (event, threadId: unknown, before: unknown) => { assertTrustedSender(event); return getSecretaryThread(threadId, before) })
  ipcMain.handle(SECRETARY_IPC.LIST_RUNS, (event, projectId: unknown) => { assertTrustedSender(event); return listSecretaryRuns(projectId) })
  ipcMain.handle(SECRETARY_IPC.GET_RUN, (event, runId: unknown) => { assertTrustedSender(event); return getSecretaryRun(runId) })
  ipcMain.handle(SECRETARY_IPC.APPROVE_PLAN, (event, runId: unknown) => { assertTrustedSender(event); return approveSecretaryPlan(runId) })
  ipcMain.handle(SECRETARY_IPC.REJECT_PLAN, (event, runId: unknown) => { assertTrustedSender(event); return rejectSecretaryPlan(runId) })
  ipcMain.handle(SECRETARY_IPC.REVISE_PLAN, (event, request: unknown) => { assertTrustedSender(event); return reviseSecretaryPlan(request) })
  ipcMain.handle(SECRETARY_IPC.ANSWER_RUN, (event, request: unknown) => { assertTrustedSender(event); return answerTrackedSecretaryRun(request) })
  ipcMain.handle(SECRETARY_IPC.CANCEL_RUN, async (event, request: unknown) => {
    assertTrustedSender(event)
    const cancelled = cancelSecretaryRun(request)
    const sessionIds = cancelTrackedSecretaryRun(cancelled.id)
    await Promise.all(sessionIds.map((sessionId) => ptyManager.writeForSecretary(sessionId, '\u0003').catch(() => undefined)))
    return cancelled
  })
  ipcMain.handle(SECRETARY_IPC.PREPARE_RUN, (event, request: unknown) => { assertTrustedSender(event); return prepareSecretaryRun(request) })
  ipcMain.handle(SECRETARY_IPC.FAIL_APPROVED_RUN, (event, runId: unknown, reason: unknown) => { assertTrustedSender(event); return failApprovedSecretaryRun(runId, reason) })
  ipcMain.handle(SECRETARY_IPC.DISPATCH_RUN, (event, request: unknown) => { assertTrustedSender(event); return dispatchSecretaryRun(request) })
}
