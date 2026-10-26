import { ipcMain, shell } from 'electron'
import { STORAGE_IPC } from '@shared/contracts/storage'
import { cleanStorageItems } from '../storage/clean'
import { scanStorage, scannedItem } from '../storage/scan'
import { assertTrustedMainWindow } from './trusted-sender'

export function registerStorageHandlers(): void {
  ipcMain.handle(STORAGE_IPC.SCAN, (event) => {
    assertTrustedMainWindow(event)
    return scanStorage()
  })

  ipcMain.handle(STORAGE_IPC.CLEAN, (event, ids: unknown) => {
    assertTrustedMainWindow(event)
    return cleanStorageItems(ids)
  })

  ipcMain.handle(STORAGE_IPC.REVEAL, (event, id: unknown) => {
    assertTrustedMainWindow(event)
    const scanned = typeof id === 'string' ? scannedItem(id) : undefined
    if (scanned) shell.showItemInFolder(scanned.item.path)
  })
}
