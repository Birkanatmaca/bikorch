import { ipcMain } from 'electron'
import { USAGE_IPC } from '@shared/contracts/usage'
import { readCliUsage } from '../usage'

export function registerUsageHandlers(): void {
  ipcMain.handle(USAGE_IPC.READ, () => readCliUsage())
}
