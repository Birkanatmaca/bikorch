import { BrowserWindow, ipcMain, screen } from 'electron'
import { WINDOW_IPC } from '@shared/contracts/window'

const EDGE_KEEP = 80
const TITLE_KEEP = 40

let windowDrag: { windowId: number; dx: number; dy: number } | null = null

function windowFromEvent(event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender)
}

function beginDrag(win: BrowserWindow): void {
  if (win.isDestroyed() || win.isFullScreen() || !win.isMovable()) {
    windowDrag = null
    return
  }

  const cursor = screen.getCursorScreenPoint()

  if (win.isMaximized()) {
    const maxBounds = win.getBounds()
    const ratio = maxBounds.width > 0 ? (cursor.x - maxBounds.x) / maxBounds.width : 0.5
    win.unmaximize()
    const restored = win.getBounds()
    win.setPosition(Math.round(cursor.x - restored.width * ratio), restored.y)
  }

  const [x, y] = win.getPosition()
  windowDrag = {
    windowId: win.id,
    dx: cursor.x - x,
    dy: cursor.y - y
  }
}

function moveDrag(win: BrowserWindow): void {
  if (!windowDrag || windowDrag.windowId !== win.id || win.isDestroyed()) return
  if (win.isMaximized() || win.isFullScreen() || !win.isMovable()) return

  const cursor = screen.getCursorScreenPoint()
  const bounds = win.getBounds()
  const display = screen.getDisplayNearestPoint(cursor)
  const area = display.workArea
  const nextX = cursor.x - windowDrag.dx
  const nextY = cursor.y - windowDrag.dy
  const minX = area.x - bounds.width + EDGE_KEEP
  const maxX = area.x + area.width - EDGE_KEEP
  const minY = area.y
  const maxY = area.y + area.height - TITLE_KEEP

  win.setPosition(
    Math.round(Math.min(maxX, Math.max(minX, nextX))),
    Math.round(Math.min(maxY, Math.max(minY, nextY)))
  )
}

export function registerWindowHandlers(): void {
  ipcMain.handle(WINDOW_IPC.MINIMIZE, (event) => {
    windowFromEvent(event)?.minimize()
  })

  ipcMain.handle(WINDOW_IPC.MAXIMIZE, (event) => {
    const win = windowFromEvent(event)
    if (!win) return false

    if (win.isMaximized()) {
      win.unmaximize()
    } else {
      win.maximize()
    }

    return win.isMaximized()
  })

  ipcMain.handle(WINDOW_IPC.CLOSE, (event) => {
    windowFromEvent(event)?.close()
  })

  ipcMain.handle(WINDOW_IPC.IS_MAXIMIZED, (event) => {
    return windowFromEvent(event)?.isMaximized() ?? false
  })

  ipcMain.on(WINDOW_IPC.DRAG_START, (event) => {
    const win = windowFromEvent(event)
    if (!win) return
    beginDrag(win)
  })

  ipcMain.on(WINDOW_IPC.DRAG_MOVE, (event) => {
    const win = windowFromEvent(event)
    if (!win) return
    moveDrag(win)
  })

  ipcMain.on(WINDOW_IPC.DRAG_END, () => {
    windowDrag = null
  })
}
