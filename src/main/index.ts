import { app, BrowserWindow, session, shell } from 'electron'
import { join } from 'path'
import { ptyManager } from './cli/pty-manager'
import { registerIpcHandlers } from './ipc'
import { installConsoleCapture, recordRendererConsole } from './logs'
import {
  closePersistenceDatabase,
  initPersistenceDatabase
} from './persistence/database'
import { APP_DISPLAY_NAME, applyAppBranding, resolveAppIconPath } from './app-branding'
import { initDeveloperIntelligence } from './developer-intelligence/service'
import { registerMusicSchemes, registerMusicProtocol } from './music/protocol'
import { initMusic } from './music/service'
import { disposeDownloadManager, initDownloadManager } from './music/downloader/service'

const isDev = !app.isPackaged

registerMusicSchemes()

applyAppBranding()
installConsoleCapture()
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

function chromeUserAgent(): string {
  const chrome = process.versions.chrome || '120.0.0.0'
  return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chrome} Safari/537.36`
}

function createWindow(): void {
  const isWin = process.platform === 'win32'
  const isMac = process.platform === 'darwin'

  const iconPath = resolveAppIconPath()

  const mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: APP_DISPLAY_NAME,
    backgroundColor: '#0D0F12',
    ...(iconPath ? { icon: iconPath } : {}),
    frame: !isWin,
    titleBarStyle: isWin ? 'hidden' : isMac ? 'hiddenInset' : undefined,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: true,
      autoplayPolicy: 'no-user-gesture-required'
    }
  })
  mainWindow.webContents.setUserAgent(chromeUserAgent())

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.on(
    'did-fail-load',
    (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      console.error(
        '[spotify] frame failed:',
        errorCode,
        errorDescription,
        validatedURL,
        isMainFrame ? 'main-frame' : 'iframe'
      )
    }
  )

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
  applyAppBranding()
  try {
    await initPersistenceDatabase()
    initDeveloperIntelligence()
    initMusic()
    await initDownloadManager()
  } catch (error) {
    console.error('Persistence init failed, continuing without database:', error)
  }
  registerMusicProtocol()
  registerIpcHandlers()
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === 'media' || permission === 'fullscreen')
  })
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
  disposeDownloadManager()
  ptyManager.killAll()
  closePersistenceDatabase()
})
