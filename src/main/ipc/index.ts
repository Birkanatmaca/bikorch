import { BrowserWindow, ipcMain, dialog } from 'electron'
import { registerPtyHandlers } from './pty'
import { registerCliHandlers } from './cli'
import { registerFilesystemHandlers } from './filesystem'
import { registerGitHandlers } from './git'
import { registerPersistenceHandlers } from './persistence'
import { registerWindowHandlers } from './window'
import { registerUsageHandlers } from './usage'
import { registerAuthProfileHandlers } from './auth-profiles'
import { registerLogsHandlers } from './logs'
import { registerDeveloperIntelligenceHandlers } from './developer-intelligence'
import { registerMusicHandlers } from './music'

export function registerIpcHandlers(): void {
  registerPtyHandlers()
  registerCliHandlers()
  registerFilesystemHandlers()
  registerGitHandlers()
  registerPersistenceHandlers()
  registerWindowHandlers()
  registerUsageHandlers()
  registerAuthProfileHandlers()
  registerLogsHandlers()
  registerDeveloperIntelligenceHandlers()
  registerMusicHandlers()

  ipcMain.handle('dialog:selectFolder', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const result = win
      ? await dialog.showOpenDialog(win, {
          title: 'Select project folder',
          properties: ['openDirectory']
        })
      : await dialog.showOpenDialog({
          title: 'Select project folder',
          properties: ['openDirectory']
        })

    if (result.canceled || result.filePaths.length === 0) {
      return null
    }

    return result.filePaths[0]
  })
}
