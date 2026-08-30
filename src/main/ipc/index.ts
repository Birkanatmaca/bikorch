import { ipcMain, dialog } from 'electron'
import { registerPtyHandlers } from './pty'
import { registerCliHandlers } from './cli'
import { registerFilesystemHandlers } from './filesystem'
import { registerGitHandlers } from './git'
import { registerPersistenceHandlers } from './persistence'
import { registerWindowHandlers } from './window'
import { registerUsageHandlers } from './usage'
import { registerAuthProfileHandlers } from './auth-profiles'

export function registerIpcHandlers(): void {
  registerPtyHandlers()
  registerCliHandlers()
  registerFilesystemHandlers()
  registerGitHandlers()
  registerPersistenceHandlers()
  registerWindowHandlers()
  registerUsageHandlers()
  registerAuthProfileHandlers()

  ipcMain.handle('dialog:selectFolder', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory']
    })

    if (result.canceled || result.filePaths.length === 0) {
      return null
    }

    return result.filePaths[0]
  })
}
