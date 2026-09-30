import type { IpcMainInvokeEvent } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SECRETARY_IPC } from '@shared/contracts/secretary'

const mocks = vi.hoisted(() => ({
  handle: vi.fn(),
  getManagedMainWindow: vi.fn(),
  getSecretarySettings: vi.fn(),
  saveSecretaryApiKey: vi.fn(),
  clearSecretaryApiKey: vi.fn(),
  resetSecretaryUsage: vi.fn(),
  updateSecretarySettings: vi.fn(),
  testManagerConnection: vi.fn(),
  dispatchSecretaryRun: vi.fn(),
  prepareSecretaryRun: vi.fn()
}))

vi.mock('electron', () => ({ ipcMain: { handle: mocks.handle } }))
vi.mock('../../lifecycle/background', () => ({ getManagedMainWindow: mocks.getManagedMainWindow }))
vi.mock('../../secretary/service', () => ({
  approveSecretaryPlan: vi.fn(),
  cancelSecretaryRun: vi.fn(),
  clearSecretaryApiKey: mocks.clearSecretaryApiKey,
  chatWithSecretary: vi.fn(),
  getDailyLearn: vi.fn(),
  createSecretaryPlan: vi.fn(),
  createSecretaryThread: vi.fn(),
  deleteSecretaryThread: vi.fn(),
  failApprovedSecretaryRun: vi.fn(),
  getSecretaryRun: vi.fn(),
  getSecretarySettings: mocks.getSecretarySettings,
  getSecretaryThread: vi.fn(),
  listSecretaryRuns: vi.fn(),
  listSecretarySessions: vi.fn(),
  listSecretaryThreads: vi.fn(),
  rejectSecretaryPlan: vi.fn(),
  renameSecretaryThread: vi.fn(),
  reviseSecretaryPlan: vi.fn(),
  resetSecretaryUsage: mocks.resetSecretaryUsage,
  saveSecretaryApiKey: mocks.saveSecretaryApiKey,
  testManagerConnection: mocks.testManagerConnection,
  updateSecretarySettings: mocks.updateSecretarySettings
}))
vi.mock('../../secretary/orchestrator', () => ({
  dispatchSecretaryRun: mocks.dispatchSecretaryRun,
  prepareSecretaryRun: mocks.prepareSecretaryRun
}))
vi.mock('../../secretary/result-collector', () => ({
  answerTrackedSecretaryRun: vi.fn(),
  cancelTrackedSecretaryRun: vi.fn(() => [])
}))
vi.mock('../../cli/pty-manager', () => ({ ptyManager: { writeForSecretary: vi.fn() } }))

import { registerSecretaryHandlers } from '../secretary'

const frame = {}
const sender = { isDestroyed: () => false, mainFrame: frame }
const mainWindow = { isDestroyed: () => false, webContents: sender }
const trustedEvent = { sender, senderFrame: frame } as unknown as IpcMainInvokeEvent
const handlers = new Map<string, (event: IpcMainInvokeEvent, payload?: unknown) => unknown>()

const settingsChannels = [
  SECRETARY_IPC.GET_SETTINGS,
  SECRETARY_IPC.SAVE_KEY,
  SECRETARY_IPC.CLEAR_KEY,
  SECRETARY_IPC.RESET_USAGE,
  SECRETARY_IPC.UPDATE_SETTINGS,
  SECRETARY_IPC.TEST_CONNECTION
]

describe('Manager settings IPC', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    handlers.clear()
    mocks.handle.mockImplementation((channel: string, handler: (event: IpcMainInvokeEvent, payload?: unknown) => unknown) => {
      handlers.set(channel, handler)
    })
    mocks.getManagedMainWindow.mockReturnValue(mainWindow)
    registerSecretaryHandlers()
  })

  it('rejects Manager settings calls that do not come from the trusted main window', async () => {
    const guest = { sender: { isDestroyed: () => false, mainFrame: {} }, senderFrame: {} } as unknown as IpcMainInvokeEvent
    for (const channel of settingsChannels) {
      const handler = handlers.get(channel)
      expect(handler).toBeTypeOf('function')
      await expect(Promise.resolve().then(() => handler!(guest, { source: 'api' }))).rejects.toThrow('Unauthorized sender')
    }
    expect(mocks.getSecretarySettings).not.toHaveBeenCalled()
    expect(mocks.saveSecretaryApiKey).not.toHaveBeenCalled()
    expect(mocks.clearSecretaryApiKey).not.toHaveBeenCalled()
    expect(mocks.updateSecretarySettings).not.toHaveBeenCalled()
    expect(mocks.testManagerConnection).not.toHaveBeenCalled()
    expect(mocks.dispatchSecretaryRun).not.toHaveBeenCalled()
  })

  it('updates provider settings from the trusted window without dispatching a coding run', async () => {
    await handlers.get(SECRETARY_IPC.UPDATE_SETTINGS)!(trustedEvent, { provider: { source: 'api' } })
    expect(mocks.updateSecretarySettings).toHaveBeenCalledWith({ provider: { source: 'api' } })
    expect(mocks.dispatchSecretaryRun).not.toHaveBeenCalled()
    expect(mocks.prepareSecretaryRun).not.toHaveBeenCalled()
  })
})
