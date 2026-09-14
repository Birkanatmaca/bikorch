import { app, BrowserWindow, session, shell } from 'electron'
import { join } from 'path'
import { ptyManager } from './cli/pty-manager'
import { loadUserShellEnv } from './cli/shell-env'
import { registerIpcHandlers } from './ipc'
import { watchWindowChrome } from './ipc/window'
import { installConsoleCapture, recordRendererConsole } from './logs'
import { closePersistenceDatabase, initPersistenceDatabase } from './persistence/database'
import { loadResourceProfile } from './resources/settings'
import { APP_DISPLAY_NAME, applyAppBranding, resolveAppIconPath } from './app-branding'
import { initDeveloperIntelligence } from './developer-intelligence/service'
import { registerMusicSchemes, registerMusicProtocol } from './music/protocol'
import { initMusic } from './music/service'
import { disposeDownloadManager, initDownloadManager } from './music/downloader/service'
import { disposeAutomationService, getAutomationSettings, initAutomationService } from './automation/service'
import { reconcilePersistedProjects } from './git/reconcile'
import {
  acquireSingleInstanceLock,
  isAppQuitting,
  registerMainWindow,
  watchPowerEvents
} from './lifecycle/background'
import { disposeTray, initTray } from './lifecycle/tray'
import { closeAllNotifications } from './notifications'

const isDev = !app.isPackaged
const isBackgroundStart = process.argv.includes('--background')

if (!acquireSingleInstanceLock()) {
  // Another instance owns the lock; exit immediately rather than continuing
  // to register schemes/handlers for a process that is about to die.
  app.exit(0)
}

registerMusicSchemes()

applyAppBranding()
installConsoleCapture()
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

function chromeUserAgent(): string {
  const chrome = process.versions.chrome || '120.0.0.0'
  return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chrome} Safari/537.36`
}

function createWindow(): BrowserWindow {
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

  watchWindowChrome(mainWindow)
  registerMainWindow(mainWindow, createWindow)

  mainWindow.on('ready-to-show', () => {
    // A `--background` launch (login start) initializes services and the
    // tray without flashing the workspace window (spec §5).
    if (!isBackgroundStart) mainWindow.show()
  })

  mainWindow.webContents.on(
    'did-fail-load',
    (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      console.error(
        '[music] frame failed:',
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

  return mainWindow
}

app.whenReady().then(async () => {
  applyAppBranding()
  // Dock/Finder launches miss the user's shell PATH; load it before any PTY spawn.
  loadUserShellEnv()
  // PTY host is spawned on first terminal/CLI open (and reconnects if a durable
  // host is already alive). Do not pay for a host process at startup.
  try {
    await initPersistenceDatabase()
    loadResourceProfile()
    initDeveloperIntelligence()
    initMusic()
    await initDownloadManager()
    try {
      initAutomationService()
    } catch (error) {
      console.error('Automation service failed to start:', error)
    }
    void reconcilePersistedProjects().catch((error) => {
      console.error('Agent run reconcile failed:', error)
    })
  } catch (error) {
    console.error('Persistence init failed, continuing without database:', error)
  }
  registerMusicProtocol()
  registerIpcHandlers()
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === 'media' || permission === 'fullscreen')
  })
  createWindow()
  initTray()
  watchPowerEvents()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (isAppQuitting()) return
  let backgroundMode = false
  try {
    backgroundMode = getAutomationSettings().backgroundMode
  } catch {
    backgroundMode = false
  }
  // The tray keeps the process alive when background mode is enabled, even
  // on platforms that would otherwise quit once every window closes.
  if (backgroundMode) return
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  disposeAutomationService()
  disposeTray()
  disposeDownloadManager()
  closeAllNotifications()
  // Keep durable host sessions alive so updates/restarts can reattach.
  ptyManager.releaseForAppQuit()
  closePersistenceDatabase()
})
