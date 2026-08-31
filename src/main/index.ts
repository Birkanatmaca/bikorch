import { app, BrowserWindow, shell } from 'electron'
import { join } from 'path'
import { ptyManager } from './cli/pty-manager'
import { registerIpcHandlers } from './ipc'
import { installConsoleCapture, recordRendererConsole } from './logs'
import {
  closePersistenceDatabase,
  initPersistenceDatabase
} from './persistence/database'

const isDev = !app.isPackaged

installConsoleCapture()

function createWindow(): void {
  const isWin = process.platform === 'win32'
  const isMac = process.platform === 'darwin'

  const mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: '#0D0F12',
    icon: join(__dirname, '../../app-logo.png'),
    frame: !isWin,
    titleBarStyle: isWin ? 'hidden' : isMac ? 'hiddenInset' : undefined,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: true
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
    console.error('Renderer failed to load:', errorCode, errorDescription)
  })

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error('Render process gone:', details)
  })

  mainWindow.webContents.on('console-message', (_event, level, message, _line, sourceId) => {
    recordRendererConsole(level, message, sourceId)
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  try {
    await initPersistenceDatabase()
  } catch (error) {
    console.error('Persistence init failed, continuing without database:', error)
  }
  registerIpcHandlers()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  ptyManager.killAll()
  closePersistenceDatabase()
})
