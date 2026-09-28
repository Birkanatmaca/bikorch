import type { BrowserWindow, IpcMainInvokeEvent } from 'electron'
import { getManagedMainWindow } from '../lifecycle/background'

/** Only the managed app window's live main frame may invoke privileged IPC. */
export function assertTrustedMainWindow(event: IpcMainInvokeEvent): BrowserWindow {
  if (event.sender.isDestroyed()) throw new Error('Unauthorized sender')
  const win = getManagedMainWindow()
  if (
    !win ||
    win.isDestroyed() ||
    event.sender !== win.webContents ||
    !event.senderFrame ||
    event.senderFrame !== event.sender.mainFrame
  ) {
    throw new Error('Unauthorized sender')
  }
  return win
}
