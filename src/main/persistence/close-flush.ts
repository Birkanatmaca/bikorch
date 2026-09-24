import { app, ipcMain, type BrowserWindow } from 'electron'
import { randomUUID } from 'crypto'
import { PERSISTENCE_IPC } from '@shared/contracts/persistence'

const FLUSH_TIMEOUT_MS = 2_000

/** Wait for the renderer's latest workspace snapshot before closing its window. */
export function guardWindowPersistenceClose(win: BrowserWindow, shouldFlush: () => boolean, shouldQuit: () => boolean): void {
  let readyToClose = false
  let waiting = false

  win.on('close', (event) => {
    if (readyToClose || win.webContents.isDestroyed() || !shouldFlush()) return
    event.preventDefault()
    if (waiting) return
    waiting = true

    const token = randomUUID()
    let finished = false
    const finish = (): void => {
      if (finished) return
      finished = true
      waiting = false
      clearTimeout(timeout)
      ipcMain.removeListener(PERSISTENCE_IPC.FLUSH_COMPLETE, onComplete)
      readyToClose = true
      if (win.isDestroyed()) return
      if (shouldQuit()) win.once('closed', () => app.quit())
      win.close()
    }
    const onComplete = (reply: Electron.IpcMainEvent, receivedToken: unknown): void => {
      if (reply.sender === win.webContents && receivedToken === token) finish()
    }
    const timeout = setTimeout(() => {
      console.warn('Workspace flush timed out while closing the window')
      finish()
    }, FLUSH_TIMEOUT_MS)
    ipcMain.on(PERSISTENCE_IPC.FLUSH_COMPLETE, onComplete)
    win.webContents.send(PERSISTENCE_IPC.FLUSH_REQUEST, token)
  })
}
