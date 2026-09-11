import { app, type BrowserWindow, powerMonitor } from 'electron'
import { getAutomationSettings, reconcileAutomationsNow } from '../automation/service'

let mainWindow: BrowserWindow | null = null
let createWindowFn: (() => BrowserWindow) | null = null
let isQuitting = false
let powerWatched = false

/**
 * Must be called before app.whenReady(). Returns false if another instance
 * already owns the lock — in that case the caller should quit immediately.
 */
export function acquireSingleInstanceLock(): boolean {
  const gotLock = app.requestSingleInstanceLock()
  if (!gotLock) return false
  app.on('second-instance', () => {
    showMainWindow()
  })
  return true
}

function readBackgroundMode(): boolean {
  try {
    return getAutomationSettings().backgroundMode
  } catch {
    return false
  }
}

/** Wires close-to-tray behavior onto the app's single BrowserWindow. */
export function registerMainWindow(win: BrowserWindow, createWindow: () => BrowserWindow): void {
  mainWindow = win
  createWindowFn = createWindow

  win.on('close', (event) => {
    if (isQuitting) return
    if (!readBackgroundMode()) return
    event.preventDefault()
    win.hide()
  })

  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })
}

export function showMainWindow(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    if (!mainWindow.isVisible()) mainWindow.show()
    mainWindow.focus()
    return
  }
  if (createWindowFn) {
    mainWindow = createWindowFn()
  }
}

export function getManagedMainWindow(): BrowserWindow | null {
  return mainWindow
}

/** Call once, right before an explicit quit, so close-to-tray does not intercept it. */
export function markQuitting(): void {
  isQuitting = true
}

export function isAppQuitting(): boolean {
  return isQuitting
}

/** Reconcile automation schedules on system resume/unlock (spec §5, §6.1). */
export function watchPowerEvents(): void {
  if (powerWatched) return
  powerWatched = true
  powerMonitor.on('resume', () => reconcileAutomationsNow())
  powerMonitor.on('unlock-screen', () => reconcileAutomationsNow())
}
