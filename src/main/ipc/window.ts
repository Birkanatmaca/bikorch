import { ipcMain, BrowserWindow } from 'electron'
import { WINDOW_IPC } from '@shared/contracts/window'

export function registerWindowHandlers(): void {
  ipcMain.handle(WINDOW_IPC.MINIMIZE, (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize()
  })

  ipcMain.handle(WINDOW_IPC.MAXIMIZE, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return false

    if (win.isMaximized()) {
      win.unmaximize()
    } else {
      win.maximize()
    }

    return win.isMaximized()
  })

  ipcMain.handle(WINDOW_IPC.CLOSE, (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close()
  })

  ipcMain.handle(WINDOW_IPC.IS_MAXIMIZED, (event) => {
    return BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false
  })
}
