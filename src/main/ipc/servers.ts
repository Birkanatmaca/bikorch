import { ipcMain } from 'electron'
import { SERVER_HEALTH_IPC } from '@shared/contracts/server-health'
import { checkServerHealth } from '../servers/health'
import { assertTrustedMainWindow } from './trusted-sender'

export function registerServerHandlers(): void {
  ipcMain.handle(SERVER_HEALTH_IPC.CHECK, (event, serverId: unknown, target: unknown) => {
    assertTrustedMainWindow(event)
    if (typeof serverId !== 'string' || !serverId) throw new Error('Missing server id')
    return checkServerHealth(serverId, target)
  })
}
