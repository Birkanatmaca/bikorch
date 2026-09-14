import { Notification, app, nativeImage } from 'electron'
import {
  cliTaskNotificationCopy,
  type CliTaskNotification
} from '@shared/contracts/notifications'
import { resolveAppIconPath } from './app-branding'
import { showMainWindow } from './lifecycle/background'

const activeByPanel = new Map<string, Notification>()
let clickHandler: ((payload: CliTaskNotification) => void) | null = null

export function setNotificationClickHandler(
  handler: ((payload: CliTaskNotification) => void) | null
): void {
  clickHandler = handler
}

function notificationIcon(): Electron.NativeImage | undefined {
  const path = resolveAppIconPath()
  if (!path || path.endsWith('.icns')) return undefined
  const image = nativeImage.createFromPath(path)
  return image.isEmpty() ? undefined : image
}

export function showCliTaskNotification(
  payload: CliTaskNotification
): { ok: true } | { ok: false; error: string } {
  if (!Notification.isSupported()) {
    return { ok: false, error: 'Notifications are not supported on this system' }
  }

  if (process.platform === 'win32') {
    app.setAppUserModelId('com.bikorch.app')
  }

  const copy = cliTaskNotificationCopy(payload)
  const previous = activeByPanel.get(payload.panelId)
  if (previous) {
    try {
      previous.close()
    } catch {
      // already dismissed
    }
  }

  const icon = notificationIcon()
  const notice = new Notification({
    title: copy.title,
    body: copy.body,
    silent: false,
    ...(icon ? { icon } : {})
  })

  notice.on('click', () => {
    showMainWindow()
    clickHandler?.(payload)
  })
  notice.on('close', () => {
    if (activeByPanel.get(payload.panelId) === notice) {
      activeByPanel.delete(payload.panelId)
    }
  })

  activeByPanel.set(payload.panelId, notice)
  notice.show()
  return { ok: true }
}

export function closeAllNotifications(): void {
  for (const notice of activeByPanel.values()) {
    try {
      notice.close()
    } catch {
      // already dismissed
    }
  }
  activeByPanel.clear()
}
