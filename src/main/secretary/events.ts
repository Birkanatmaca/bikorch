import { BrowserWindow } from 'electron'
import { SECRETARY_IPC, type SecretaryEvent } from '@shared/contracts/secretary'

export function emitSecretaryEvent(event: SecretaryEvent): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(SECRETARY_IPC.EVENT, event)
  }
}
