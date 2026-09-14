import { BrowserWindow, ipcMain } from 'electron'
import {
  RESOURCES_IPC,
  isResourceProfile,
  type ResourceProfile
} from '@shared/contracts/resources'
import { collectResourceSnapshot } from '../resources/snapshot'
import { getResourceProfile, setResourceProfile } from '../resources/settings'

function assertTrustedSender(event: Electron.IpcMainInvokeEvent): void {
  if (event.sender.isDestroyed()) throw new Error('Unauthorized sender')
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win || win.isDestroyed()) throw new Error('Unauthorized sender')
}

export function registerResourceHandlers(): void {
  ipcMain.handle(RESOURCES_IPC.GET_PROFILE, (event) => {
    assertTrustedSender(event)
    return getResourceProfile()
  })

  ipcMain.handle(RESOURCES_IPC.SET_PROFILE, (event, raw: unknown) => {
    assertTrustedSender(event)
    if (!isResourceProfile(raw)) throw new Error('Invalid resource profile')
    return setResourceProfile(raw as ResourceProfile)
  })

  ipcMain.handle(RESOURCES_IPC.SNAPSHOT, (event) => {
    assertTrustedSender(event)
    return collectResourceSnapshot()
  })
}
