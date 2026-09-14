import { BrowserWindow, ipcMain } from 'electron'
import {
  NOTIFICATION_IPC,
  type CliTaskNotification,
  type CliTaskNotificationOutcome
} from '@shared/contracts/notifications'
import { setNotificationClickHandler, showCliTaskNotification } from '../notifications'

function assertTrustedSender(event: Electron.IpcMainInvokeEvent): void {
  if (event.sender.isDestroyed()) throw new Error('Unauthorized sender')
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win || win.isDestroyed()) throw new Error('Unauthorized sender')
}

function asTrimmed(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim().replace(/\s+/g, ' ')
  if (trimmed.length === 0 || trimmed.length > max) return null
  return trimmed
}

function parsePayload(raw: unknown): CliTaskNotification | null {
  if (!raw || typeof raw !== 'object') return null
  const body = raw as Partial<CliTaskNotification>
  const projectId = asTrimmed(body.projectId, 80)
  const panelId = asTrimmed(body.panelId, 80)
  const projectName = asTrimmed(body.projectName, 120)
  const title = asTrimmed(body.title, 120)
  const outcome: CliTaskNotificationOutcome | null =
    body.outcome === 'done' || body.outcome === 'error' ? body.outcome : null
  if (!projectId || !panelId || !projectName || !title || !outcome) return null
  if (projectId.length < 8 || panelId.length < 8) return null
  return { projectId, panelId, projectName, title, outcome }
}

function sendClicked(win: BrowserWindow, payload: CliTaskNotification): void {
  if (win.isDestroyed()) return
  const send = (): void => {
    if (!win.isDestroyed()) win.webContents.send(NOTIFICATION_IPC.CLICKED, payload)
  }
  if (win.webContents.isLoadingMainFrame()) {
    win.webContents.once('did-finish-load', send)
    return
  }
  send()
}

export function registerNotificationHandlers(): void {
  setNotificationClickHandler((payload) => {
    for (const win of BrowserWindow.getAllWindows()) {
      sendClicked(win, payload)
    }
  })

  ipcMain.handle(NOTIFICATION_IPC.SHOW_CLI_TASK, (event, raw: unknown) => {
    assertTrustedSender(event)
    const payload = parsePayload(raw)
    if (!payload) throw new Error('Invalid notification payload')
    return showCliTaskNotification(payload)
  })
}
