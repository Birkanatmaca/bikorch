import { BrowserWindow, ipcMain } from 'electron'
import {
  RESOURCES_IPC,
  isResourceProfile,
  type ResourceProfile
} from '@shared/contracts/resources'
import { collectResourceSnapshot } from '../resources/snapshot'
import { getCacheAnalysis, respondToCachePressure, setCacheWarnMb } from '../resources/cache-care'
import { clearBrowserCaches, collectDiskSnapshot } from '../resources/disk'
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

  ipcMain.handle(RESOURCES_IPC.DISK_SNAPSHOT, (event) => {
    assertTrustedSender(event)
    return collectDiskSnapshot()
  })

  ipcMain.handle(RESOURCES_IPC.CLEAR_BROWSER_CACHE, (event) => {
    assertTrustedSender(event)
    return clearBrowserCaches()
  })

  ipcMain.handle(RESOURCES_IPC.CACHE_ANALYSIS, (event) => {
    assertTrustedSender(event)
    return getCacheAnalysis()
  })

  ipcMain.handle(RESOURCES_IPC.SET_CACHE_WARN, (event, value: unknown) => {
    assertTrustedSender(event)
    return setCacheWarnMb(value)
  })

  ipcMain.handle(RESOURCES_IPC.RESPOND_CACHE, (event, accept: unknown) => {
    assertTrustedSender(event)
    return respondToCachePressure(accept === true)
  })
}
