import { ipcMain } from 'electron'
import { SECRETARY_IPC } from '@shared/contracts/secretary'
import {
  approveSecretaryPlan,
  cancelSecretaryRun,
  clearSecretaryApiKey,
  chatWithSecretary,
  getDailyLearn,
  createSecretaryPlan,
  createSecretaryThread,
  deleteSecretaryThread,
  failApprovedSecretaryRun,
  getSecretaryRun,
  getSecretarySettings,
  getSecretaryThread,
  listSecretaryRuns,
  listSecretarySessions,
  listSecretaryThreads,
  rejectSecretaryPlan,
  renameSecretaryThread,
  reviseSecretaryPlan,
  resetSecretaryUsage,
  saveSecretaryApiKey,
  updateSecretarySettings
} from '../secretary/service'
import { dispatchSecretaryRun, prepareSecretaryRun } from '../secretary/orchestrator'
import { answerTrackedSecretaryRun, cancelTrackedSecretaryRun } from '../secretary/result-collector'
import { ptyManager } from '../cli/pty-manager'
import { assertTrustedMainWindow } from './trusted-sender'

export function registerSecretaryHandlers(): void {
  ipcMain.handle(SECRETARY_IPC.GET_SETTINGS, (event) => { assertTrustedMainWindow(event); return getSecretarySettings() })
  ipcMain.handle(SECRETARY_IPC.SAVE_KEY, (event, key: unknown) => { assertTrustedMainWindow(event); return saveSecretaryApiKey(key) })
  ipcMain.handle(SECRETARY_IPC.CLEAR_KEY, (event) => { assertTrustedMainWindow(event); return clearSecretaryApiKey() })
  ipcMain.handle(SECRETARY_IPC.RESET_USAGE, (event) => { assertTrustedMainWindow(event); return resetSecretaryUsage() })
  ipcMain.handle(SECRETARY_IPC.UPDATE_SETTINGS, (event, settings: unknown) => { assertTrustedMainWindow(event); return updateSecretarySettings(settings) })
  ipcMain.handle(SECRETARY_IPC.CREATE_PLAN, (event, request: unknown) => { assertTrustedMainWindow(event); return createSecretaryPlan(request) })
  ipcMain.handle(SECRETARY_IPC.CHAT, (event, request: unknown) => { assertTrustedMainWindow(event); return chatWithSecretary(request) })
  ipcMain.handle(SECRETARY_IPC.GET_DAILY_LEARN, (event) => { assertTrustedMainWindow(event); return getDailyLearn() })
  ipcMain.handle(SECRETARY_IPC.LIST_THREADS, (event, projectId: unknown) => { assertTrustedMainWindow(event); return listSecretaryThreads(projectId) })
  ipcMain.handle(SECRETARY_IPC.LIST_SESSIONS, (event, projectId: unknown) => { assertTrustedMainWindow(event); return listSecretarySessions(projectId) })
  ipcMain.handle(SECRETARY_IPC.CREATE_THREAD, (event, request: unknown) => { assertTrustedMainWindow(event); return createSecretaryThread(request) })
  ipcMain.handle(SECRETARY_IPC.RENAME_THREAD, (event, request: unknown) => { assertTrustedMainWindow(event); return renameSecretaryThread(request) })
  ipcMain.handle(SECRETARY_IPC.DELETE_THREAD, (event, request: unknown) => { assertTrustedMainWindow(event); return deleteSecretaryThread(request) })
  ipcMain.handle(SECRETARY_IPC.GET_THREAD, (event, threadId: unknown, before: unknown) => { assertTrustedMainWindow(event); return getSecretaryThread(threadId, before) })
  ipcMain.handle(SECRETARY_IPC.LIST_RUNS, (event, projectId: unknown) => { assertTrustedMainWindow(event); return listSecretaryRuns(projectId) })
  ipcMain.handle(SECRETARY_IPC.GET_RUN, (event, runId: unknown) => { assertTrustedMainWindow(event); return getSecretaryRun(runId) })
  ipcMain.handle(SECRETARY_IPC.APPROVE_PLAN, (event, runId: unknown) => { assertTrustedMainWindow(event); return approveSecretaryPlan(runId) })
  ipcMain.handle(SECRETARY_IPC.REJECT_PLAN, (event, runId: unknown) => { assertTrustedMainWindow(event); return rejectSecretaryPlan(runId) })
  ipcMain.handle(SECRETARY_IPC.REVISE_PLAN, (event, request: unknown) => { assertTrustedMainWindow(event); return reviseSecretaryPlan(request) })
  ipcMain.handle(SECRETARY_IPC.ANSWER_RUN, (event, request: unknown) => { assertTrustedMainWindow(event); return answerTrackedSecretaryRun(request) })
  ipcMain.handle(SECRETARY_IPC.CANCEL_RUN, async (event, request: unknown) => {
    assertTrustedMainWindow(event)
    const cancelled = cancelSecretaryRun(request)
    const sessionIds = cancelTrackedSecretaryRun(cancelled.id)
    await Promise.all(sessionIds.map((sessionId) => ptyManager.writeForSecretary(sessionId, '\u0003').catch(() => undefined)))
    return cancelled
  })
  ipcMain.handle(SECRETARY_IPC.PREPARE_RUN, (event, request: unknown) => { assertTrustedMainWindow(event); return prepareSecretaryRun(request) })
  ipcMain.handle(SECRETARY_IPC.FAIL_APPROVED_RUN, (event, runId: unknown, reason: unknown) => { assertTrustedMainWindow(event); return failApprovedSecretaryRun(runId, reason) })
  ipcMain.handle(SECRETARY_IPC.DISPATCH_RUN, (event, request: unknown) => { assertTrustedMainWindow(event); return dispatchSecretaryRun(request) })
}
