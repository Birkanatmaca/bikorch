import { BrowserWindow, ipcMain } from 'electron'
import { AUTOMATION_IPC } from '@shared/contracts/automation'
import {
  cancelAutomationRun,
  createAutomation,
  getAutomation,
  getAutomationSettings,
  getAutomationStatus,
  listAutomationRuns,
  listAutomations,
  removeAutomation,
  runAutomationNow,
  setAutomationEnabled,
  updateAutomation,
  updateAutomationSettings
} from '../automation/service'

/**
 * Automations schedule unattended CLI execution, so every handler here must
 * only be reachable from the app's own top-level window — never from an
 * embedded webview/iframe guest (e.g. ChatGPT, YouTube).
 */
function assertTrustedSender(event: Electron.IpcMainInvokeEvent): void {
  if (event.sender.isDestroyed()) throw new Error('Unauthorized sender')
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win || win.isDestroyed()) throw new Error('Unauthorized sender')
}

function parseId(payload: unknown): string {
  if (typeof payload !== 'string' || payload.length === 0 || payload.length > 200) {
    throw new Error('Invalid id')
  }
  return payload
}

export function registerAutomationHandlers(): void {
  ipcMain.handle(AUTOMATION_IPC.LIST, (event) => {
    assertTrustedSender(event)
    return listAutomations()
  })

  ipcMain.handle(AUTOMATION_IPC.GET, (event, payload: unknown) => {
    assertTrustedSender(event)
    return getAutomation(parseId(payload))
  })

  ipcMain.handle(AUTOMATION_IPC.CREATE, (event, payload: unknown) => {
    assertTrustedSender(event)
    return createAutomation(payload)
  })

  ipcMain.handle(AUTOMATION_IPC.UPDATE, (event, payload: unknown) => {
    assertTrustedSender(event)
    const { id, patch } = (payload ?? {}) as { id?: unknown; patch?: unknown }
    return updateAutomation(parseId(id), patch)
  })

  ipcMain.handle(AUTOMATION_IPC.REMOVE, (event, payload: unknown) => {
    assertTrustedSender(event)
    removeAutomation(parseId(payload))
  })

  ipcMain.handle(AUTOMATION_IPC.SET_ENABLED, (event, payload: unknown) => {
    assertTrustedSender(event)
    const { id, enabled } = (payload ?? {}) as { id?: unknown; enabled?: unknown }
    return setAutomationEnabled(parseId(id), enabled === true)
  })

  ipcMain.handle(AUTOMATION_IPC.RUN_NOW, (event, payload: unknown) => {
    assertTrustedSender(event)
    return runAutomationNow(parseId(payload))
  })

  ipcMain.handle(AUTOMATION_IPC.CANCEL_RUN, (event, payload: unknown) => {
    assertTrustedSender(event)
    cancelAutomationRun(parseId(payload))
  })

  ipcMain.handle(AUTOMATION_IPC.LIST_RUNS, (event, payload: unknown) => {
    assertTrustedSender(event)
    const automationId = typeof payload === 'string' ? payload : undefined
    return listAutomationRuns(automationId)
  })

  ipcMain.handle(AUTOMATION_IPC.GET_SETTINGS, (event) => {
    assertTrustedSender(event)
    return getAutomationSettings()
  })

  ipcMain.handle(AUTOMATION_IPC.UPDATE_SETTINGS, (event, payload: unknown) => {
    assertTrustedSender(event)
    return updateAutomationSettings(payload)
  })

  ipcMain.handle(AUTOMATION_IPC.GET_STATUS, (event) => {
    assertTrustedSender(event)
    return getAutomationStatus()
  })
}
