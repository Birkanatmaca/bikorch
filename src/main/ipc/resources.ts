import { ipcMain } from 'electron'
import {
  RESOURCES_IPC,
  isResourceProfile,
  type ResourceProfile
} from '@shared/contracts/resources'
import { collectResourceSnapshot } from '../resources/snapshot'
import { getCacheAnalysis, respondToCachePressure, setCacheWarnMb } from '../resources/cache-care'
import { clearBrowserCaches, collectDiskSnapshot } from '../resources/disk'
import { getResourceProfile, setResourceProfile } from '../resources/settings'
import { assertTrustedMainWindow } from './trusted-sender'

export function registerResourceHandlers(): void {
  ipcMain.handle(RESOURCES_IPC.GET_PROFILE, (event) => {
    assertTrustedMainWindow(event)
    return getResourceProfile()
  })

  ipcMain.handle(RESOURCES_IPC.SET_PROFILE, (event, raw: unknown) => {
    assertTrustedMainWindow(event)
    if (!isResourceProfile(raw)) throw new Error('Invalid resource profile')
    return setResourceProfile(raw as ResourceProfile)
  })

  ipcMain.handle(RESOURCES_IPC.SNAPSHOT, (event) => {
    assertTrustedMainWindow(event)
    return collectResourceSnapshot()
  })

  ipcMain.handle(RESOURCES_IPC.DISK_SNAPSHOT, (event) => {
    assertTrustedMainWindow(event)
    return collectDiskSnapshot()
  })

  ipcMain.handle(RESOURCES_IPC.CLEAR_BROWSER_CACHE, (event) => {
    assertTrustedMainWindow(event)
    return clearBrowserCaches()
  })

  ipcMain.handle(RESOURCES_IPC.CACHE_ANALYSIS, (event) => {
    assertTrustedMainWindow(event)
    return getCacheAnalysis()
  })

  ipcMain.handle(RESOURCES_IPC.SET_CACHE_WARN, (event, value: unknown) => {
    assertTrustedMainWindow(event)
    return setCacheWarnMb(value)
  })

  ipcMain.handle(RESOURCES_IPC.RESPOND_CACHE, (event, accept: unknown) => {
    assertTrustedMainWindow(event)
    return respondToCachePressure(accept === true)
  })
}
