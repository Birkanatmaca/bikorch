import { app, Menu, nativeImage, Tray } from 'electron'
import { APP_DISPLAY_NAME, resolveAppIconPath } from '../app-branding'
import { getAutomationSettings, getAutomationStatus, updateAutomationSettings } from '../automation/service'
import { markQuitting, showMainWindow } from './background'

let tray: Tray | null = null

function applyLoginItemSettings(enabled: boolean): void {
  // Packaged Linux autostart uses a desktop-entry file, handled by the
  // installer; app.setLoginItemSettings only applies to macOS/Windows.
  if (process.platform === 'linux') return
  try {
    app.setLoginItemSettings({
      openAtLogin: enabled,
      ...(enabled ? { args: ['--background'] } : {})
    })
  } catch (error) {
    console.error('[automation] failed to update login item settings:', error)
  }
}

function statusLabel(): string {
  try {
    const status = getAutomationStatus()
    return `Automations: ${status.running} running · ${status.enabled} enabled`
  } catch {
    return 'Automations: unavailable'
  }
}

function buildMenu(): Menu {
  let settings
  try {
    settings = getAutomationSettings()
  } catch {
    settings = null
  }

  return Menu.buildFromTemplate([
    { label: `Open ${APP_DISPLAY_NAME}`, click: () => showMainWindow() },
    { label: statusLabel(), enabled: false },
    { type: 'separator' },
    {
      label: 'Run Bikorch in background',
      type: 'checkbox',
      checked: settings?.backgroundMode ?? false,
      click: (item) => {
        try {
          updateAutomationSettings({ backgroundMode: item.checked })
        } catch (error) {
          console.error('[automation] failed to update background mode:', error)
        }
        refreshTrayMenu()
      }
    },
    {
      label: 'Start at login',
      type: 'checkbox',
      checked: settings?.startAtLogin ?? false,
      click: (item) => {
        try {
          updateAutomationSettings({ startAtLogin: item.checked })
          applyLoginItemSettings(item.checked)
        } catch (error) {
          console.error('[automation] failed to update start-at-login:', error)
        }
        refreshTrayMenu()
      }
    },
    { type: 'separator' },
    {
      label: `Quit ${APP_DISPLAY_NAME}`,
      click: () => {
        markQuitting()
        app.quit()
      }
    }
  ])
}

function trayIconImage(): Electron.NativeImage {
  const iconPath = resolveAppIconPath()
  const base = iconPath ? nativeImage.createFromPath(iconPath) : nativeImage.createEmpty()
  if (base.isEmpty()) return base
  // Development fallback only — the spec calls for dedicated monochrome
  // template assets (16/32px mac, 16/20/24/32px win/linux) before release.
  return base.resize({ width: 16, height: 16 })
}

export function initTray(): void {
  if (tray) return
  tray = new Tray(trayIconImage())
  tray.setToolTip(APP_DISPLAY_NAME)
  tray.setContextMenu(buildMenu())
  tray.on('click', () => showMainWindow())
}

export function refreshTrayMenu(): void {
  tray?.setContextMenu(buildMenu())
}

export function disposeTray(): void {
  tray?.destroy()
  tray = null
}
