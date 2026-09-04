import { app, nativeImage } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'

export const APP_DISPLAY_NAME = 'Bikorch'

function iconCandidates(): string[] {
  return [
    join(__dirname, '../../build/icon.icns'),
    join(__dirname, '../../app-logo.png'),
    join(__dirname, '../renderer/assets/app-logo.png'),
    join(app.getAppPath(), 'build/icon.icns'),
    join(app.getAppPath(), 'app-logo.png'),
    join(process.cwd(), 'build/icon.icns'),
    join(process.cwd(), 'app-logo.png')
  ]
}

export function resolveAppIconPath(): string | null {
  for (const candidate of iconCandidates()) {
    if (existsSync(candidate)) return candidate
  }
  return null
}

export function applyAppBranding(): void {
  app.setName(APP_DISPLAY_NAME)

  if (process.platform !== 'darwin') return

  const iconPath = resolveAppIconPath()
  if (!iconPath) return

  const icon = nativeImage.createFromPath(iconPath)
  if (icon.isEmpty()) return

  app.dock?.setIcon(icon)
}
