import { BrowserWindow, ipcMain } from 'electron'
import { SECRETARY_IPC } from '@shared/contracts/secretary'
import { clearSecretaryApiKey, chatWithSecretary, createSecretaryPlan, getSecretarySettings, resetSecretaryUsage, saveSecretaryApiKey, updateSecretarySettings } from '../secretary/service'

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
}
