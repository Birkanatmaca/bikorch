import { ipcMain, shell } from 'electron'
import { SIMULATOR_IPC } from '@shared/contracts/simulator'
import { simulatorSession } from '../simulator/session'
import { assertTrustedMainWindow } from './trusted-sender'

export function registerSimulatorHandlers(): void {
  ipcMain.handle(SIMULATOR_IPC.ATTACH, (event) => {
    const win = assertTrustedMainWindow(event)
    return simulatorSession.attach(win.webContents)
  })

  ipcMain.handle(SIMULATOR_IPC.DETACH, (event) => {
    assertTrustedMainWindow(event)
    simulatorSession.detach()
  })

  ipcMain.handle(SIMULATOR_IPC.ROTATE, (event, raw: unknown) => {
    assertTrustedMainWindow(event)
    simulatorSession.rotate(raw)
  })

  ipcMain.handle(SIMULATOR_IPC.VIEW, (event, raw: unknown) => {
    assertTrustedMainWindow(event)
    simulatorSession.setView(raw)
  })

  ipcMain.handle(SIMULATOR_IPC.POINTER, (event, raw: unknown) => {
    assertTrustedMainWindow(event)
    simulatorSession.pointer(raw)
  })

  ipcMain.handle(SIMULATOR_IPC.KEY, (event, raw: unknown) => {
    assertTrustedMainWindow(event)
    simulatorSession.key(raw)
  })

  ipcMain.handle(SIMULATOR_IPC.BUTTON, (event, raw: unknown) => {
    assertTrustedMainWindow(event)
    simulatorSession.button(raw)
  })

  // Taps and typing need Accessibility for the simulator helper; open that pane.
  ipcMain.handle(SIMULATOR_IPC.OPEN_ACCESSIBILITY, async (event) => {
    assertTrustedMainWindow(event)
    await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility')
  })
}
