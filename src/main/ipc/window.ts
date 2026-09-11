import { ipcMain, BrowserWindow } from 'electron'
import { WINDOW_IPC, type WindowChromeState } from '@shared/contracts/window'

function chromeState(win: BrowserWindow): WindowChromeState {
  return {
    maximized: win.isMaximized(),
    fullScreen: win.isFullScreen()
  }
}

function emitChromeState(win: BrowserWindow): void {
  if (win.isDestroyed()) return
  win.webContents.send(WINDOW_IPC.STATE_CHANGED, chromeState(win))
}

export function watchWindowChrome(win: BrowserWindow): void {
  const emit = (): void => emitChromeState(win)
  win.on('enter-full-screen', emit)
  win.on('leave-full-screen', emit)
  win.on('maximize', emit)
  win.on('unmaximize', emit)
}

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

  ipcMain.handle(WINDOW_IPC.IS_FULL_SCREEN, (event) => {
    return BrowserWindow.fromWebContents(event.sender)?.isFullScreen() ?? false
  })

  ipcMain.handle(WINDOW_IPC.GET_STATE, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    return win ? chromeState(win) : { maximized: false, fullScreen: false }
  })
}
