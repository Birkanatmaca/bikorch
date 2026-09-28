import type { IpcMainInvokeEvent } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEVELOPER_INTELLIGENCE_IPC as IPC } from '@shared/contracts/developer-intelligence'

const mocks = vi.hoisted(() => ({
  handle: vi.fn(),
  fromWebContents: vi.fn(),
  getManagedMainWindow: vi.fn(),
  showOpenDialog: vi.fn(),
  showSaveDialog: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  learnDeveloperMemoriesWithAi: vi.fn(),
  service: {
    analyzeMemories: vi.fn(), buildExport: vi.fn(), clearData: vi.fn(),
    createMemory: vi.fn(), createSkill: vi.fn(), deleteSkill: vi.fn(),
    importSkillsFromText: vi.fn(), listSkills: vi.fn(), updateSkill: vi.fn(),
    deleteMemory: vi.fn(), deletePrompts: vi.fn(), getDeveloperIntelligenceSettings: vi.fn(),
    getMemoryContext: vi.fn(), getMetrics: vi.fn(), getStats: vi.fn(),
    listMemories: vi.fn(), listPrompts: vi.fn(), recordDeveloperEvent: vi.fn(),
    recordPrompt: vi.fn(), listAgentSessions: vi.fn(), getAgentSession: vi.fn(),
    updateDeveloperIntelligenceSettings: vi.fn(), updateMemory: vi.fn()
  }
}))

vi.mock('electron', () => ({
  ipcMain: { handle: mocks.handle },
  BrowserWindow: { fromWebContents: mocks.fromWebContents },
  dialog: { showOpenDialog: mocks.showOpenDialog, showSaveDialog: mocks.showSaveDialog }
}))
vi.mock('fs/promises', () => ({ readFile: mocks.readFile, writeFile: mocks.writeFile }))
vi.mock('../../lifecycle/background', () => ({ getManagedMainWindow: mocks.getManagedMainWindow }))
vi.mock('../../developer-intelligence/service', () => mocks.service)
vi.mock('../../secretary/service', () => ({ learnDeveloperMemoriesWithAi: mocks.learnDeveloperMemoriesWithAi }))

import { registerDeveloperIntelligenceHandlers } from '../developer-intelligence'

const frame = {}
const sender = { isDestroyed: () => false, mainFrame: frame }
const mainWindow = { isDestroyed: () => false, webContents: sender }
const trustedEvent = { sender, senderFrame: frame } as unknown as IpcMainInvokeEvent
const handlers = new Map<string, (event: IpcMainInvokeEvent, payload?: unknown) => unknown>()
const effects = [...Object.values(mocks.service), mocks.learnDeveloperMemoriesWithAi,
  mocks.showOpenDialog, mocks.showSaveDialog, mocks.readFile, mocks.writeFile]

const routes: Array<[string, unknown, ReturnType<typeof vi.fn>]> = [
  [IPC.RECORD_EVENT, { type: 'project.opened', payload: { name: 'Bikorch' } }, mocks.service.recordDeveloperEvent],
  [IPC.RECORD_PROMPT, { prompt: 'Review this code.', source: 'terminal' }, mocks.service.recordPrompt],
  [IPC.LIST_PROMPTS, {}, mocks.service.listPrompts],
  [IPC.DELETE_PROMPTS, ['prompt-1'], mocks.service.deletePrompts],
  [IPC.GET_METRICS, { range: 'all' }, mocks.service.getMetrics],
  [IPC.LIST_SKILLS, undefined, mocks.service.listSkills],
  [IPC.CREATE_SKILL, { name: 'Review', instructions: 'Review the current code.' }, mocks.service.createSkill],
  [IPC.UPDATE_SKILL, { id: 'skill-1', updates: { enabled: false } }, mocks.service.updateSkill],
  [IPC.DELETE_SKILL, 'skill-1', mocks.service.deleteSkill],
  [IPC.IMPORT_SKILL, undefined, mocks.showOpenDialog],
  [IPC.LIST_MEMORIES, undefined, mocks.service.listMemories],
  [IPC.CREATE_MEMORY, { scope: 'global', content: 'Prefers Turkish replies.' }, mocks.service.createMemory],
  [IPC.UPDATE_MEMORY, { id: 'memory-1', updates: { enabled: false } }, mocks.service.updateMemory],
  [IPC.DELETE_MEMORY, 'memory-1', mocks.service.deleteMemory],
  [IPC.GET_SETTINGS, undefined, mocks.service.getDeveloperIntelligenceSettings],
  [IPC.UPDATE_SETTINGS, { includeMemoryInPrompts: false }, mocks.service.updateDeveloperIntelligenceSettings],
  [IPC.GET_STATS, undefined, mocks.service.getStats],
  [IPC.EXPORT, undefined, mocks.showSaveDialog],
  [IPC.CLEAR, 'all', mocks.service.clearData],
  [IPC.ANALYZE, { range: 'all' }, mocks.service.analyzeMemories],
  [IPC.LEARN_WITH_AI, undefined, mocks.learnDeveloperMemoriesWithAi],
  [IPC.GET_CONTEXT, {}, mocks.service.getMemoryContext],
  [IPC.LIST_SESSIONS, {}, mocks.service.listAgentSessions],
  [IPC.GET_SESSION, 'session-1', mocks.service.getAgentSession]
]

describe('Developer Intelligence IPC sender boundary', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    handlers.clear()
    mocks.handle.mockImplementation((channel, handler) => handlers.set(channel, handler))
    mocks.getManagedMainWindow.mockReturnValue(mainWindow)
    mocks.fromWebContents.mockReturnValue(mainWindow)
    mocks.showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] })
    mocks.showSaveDialog.mockResolvedValue({ canceled: true })
    registerDeveloperIntelligenceHandlers()
  })

  it('registers every contract channel exactly once', () => {
    expect([...handlers.keys()].sort()).toEqual(Object.values(IPC).sort())
    expect(mocks.handle).toHaveBeenCalledTimes(Object.values(IPC).length)
  })

  it.each(Object.values(IPC))('rejects untrusted %s requests before validation, service calls or file dialogs', async (channel) => {
    const handler = handlers.get(channel)!
    const invalidEvents = [
      { sender: { isDestroyed: () => false, mainFrame: {} }, senderFrame: {} }, // guest or another window
      { sender, senderFrame: {} }, // iframe in the managed window
      { sender, senderFrame: null }, // destroyed or navigated frame
      { sender: { isDestroyed: () => true }, senderFrame: frame }
    ]
    for (const event of invalidEvents) {
      await expect(Promise.resolve().then(() => handler(event as unknown as IpcMainInvokeEvent)))
        .rejects.toThrow('Unauthorized sender')
    }
    for (const effect of effects) expect(effect).not.toHaveBeenCalled()
  })

  it.each(routes)('allows the managed main frame to call %s', async (channel, payload, effect) => {
    await handlers.get(channel)!(trustedEvent, payload)
    expect(effect).toHaveBeenCalledTimes(1)
  })

  it('keeps input validation for trusted requests', async () => {
    await expect(Promise.resolve().then(() => handlers.get(IPC.CREATE_MEMORY)!(trustedEvent, {})))
      .rejects.toThrow('Invalid memory')
    expect(mocks.service.createMemory).not.toHaveBeenCalled()
  })
})
