import { BrowserWindow, dialog, ipcMain } from 'electron'
import { writeFile } from 'fs/promises'
import { DEVELOPER_INTELLIGENCE_IPC } from '@shared/contracts/developer-intelligence'
import {
  analyzeMemories,
  buildExport,
  clearData,
  createMemory,
  deleteMemory,
  deletePrompts,
  getDeveloperIntelligenceSettings,
  getMemoryContext,
  getMetrics,
  getStats,
  listMemories,
  listPrompts,
  recordDeveloperEvent,
  recordPrompt,
  listAgentSessions,
  getAgentSession,
  updateDeveloperIntelligenceSettings,
  updateMemory
} from '../developer-intelligence/service'
import {
  parseClearTarget,
  parseContextRequest,
  parseEventInput,
  parseIdList,
  parseMemoryDraft,
  parseMemoryUpdate,
  parseMetricsRequest,
  parsePromptFilter,
  parsePromptRequest,
  parseSettingsUpdate,
  parseSessionListRequest
} from '../developer-intelligence/validation'

export function registerDeveloperIntelligenceHandlers(): void {
  ipcMain.handle(DEVELOPER_INTELLIGENCE_IPC.RECORD_EVENT, (_event, payload: unknown) => {
    const input = parseEventInput(payload)
    if (!input) throw new Error('Invalid developer event')
    return recordDeveloperEvent(input)
  })

  ipcMain.handle(DEVELOPER_INTELLIGENCE_IPC.RECORD_PROMPT, (_event, payload: unknown) => {
    const request = parsePromptRequest(payload)
    if (!request) throw new Error('Invalid prompt record request')
    return recordPrompt(request)
  })

  ipcMain.handle(DEVELOPER_INTELLIGENCE_IPC.LIST_PROMPTS, (_event, payload: unknown) => {
    return listPrompts(parsePromptFilter(payload))
  })

  ipcMain.handle(DEVELOPER_INTELLIGENCE_IPC.DELETE_PROMPTS, (_event, payload: unknown) => {
    const ids = parseIdList(payload)
    if (!ids) throw new Error('Invalid prompt id list')
    return deletePrompts(ids)
  })

  ipcMain.handle(DEVELOPER_INTELLIGENCE_IPC.GET_METRICS, (_event, payload: unknown) => {
    const request = parseMetricsRequest(payload)
    if (!request) throw new Error('Invalid metrics request')
    return getMetrics(request)
  })

  ipcMain.handle(DEVELOPER_INTELLIGENCE_IPC.LIST_MEMORIES, () => listMemories())

  ipcMain.handle(DEVELOPER_INTELLIGENCE_IPC.CREATE_MEMORY, (_event, payload: unknown) => {
    const draft = parseMemoryDraft(payload)
    if (!draft) throw new Error('Invalid memory')
    return createMemory(draft)
  })

  ipcMain.handle(DEVELOPER_INTELLIGENCE_IPC.UPDATE_MEMORY, (_event, payload: unknown) => {
    const parsed = parseMemoryUpdate(payload)
    if (!parsed) throw new Error('Invalid memory update')
    return updateMemory(parsed.id, parsed.updates)
  })

  ipcMain.handle(DEVELOPER_INTELLIGENCE_IPC.DELETE_MEMORY, (_event, payload: unknown) => {
    if (typeof payload !== 'string' || payload.length === 0 || payload.length > 200) {
      throw new Error('Invalid memory id')
    }
    return { ok: deleteMemory(payload) }
  })

  ipcMain.handle(DEVELOPER_INTELLIGENCE_IPC.GET_SETTINGS, () => getDeveloperIntelligenceSettings())

  ipcMain.handle(DEVELOPER_INTELLIGENCE_IPC.UPDATE_SETTINGS, (_event, payload: unknown) => {
    const updates = parseSettingsUpdate(payload)
    if (!updates) throw new Error('Invalid settings update')
    return updateDeveloperIntelligenceSettings(updates)
  })

  ipcMain.handle(DEVELOPER_INTELLIGENCE_IPC.GET_STATS, () => getStats())

  ipcMain.handle(DEVELOPER_INTELLIGENCE_IPC.EXPORT, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const defaultName = `bikorch-developer-intelligence-${new Date().toISOString().slice(0, 10)}.json`
    const options = {
      title: 'Export Developer Intelligence data',
      defaultPath: defaultName,
      filters: [{ name: 'JSON', extensions: ['json'] }]
    }
    const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return { ok: false as const, canceled: true as const }

    const data = buildExport()
    await writeFile(result.filePath, JSON.stringify(data, null, 2), 'utf8')
    return {
      ok: true as const,
      filePath: result.filePath,
      counts: { events: data.events.length, prompts: data.prompts.length, memories: data.memories.length }
    }
  })

  ipcMain.handle(DEVELOPER_INTELLIGENCE_IPC.CLEAR, (_event, payload: unknown) => {
    const target = parseClearTarget(payload)
    if (!target) throw new Error('Invalid clear target')
    return clearData(target)
  })

  ipcMain.handle(DEVELOPER_INTELLIGENCE_IPC.ANALYZE, (_event, payload: unknown) => {
    const request = parseMetricsRequest(payload)
    if (!request) throw new Error('Invalid analysis request')
    return analyzeMemories(request)
  })

  ipcMain.handle(DEVELOPER_INTELLIGENCE_IPC.GET_CONTEXT, (_event, payload: unknown) => {
    const request = parseContextRequest(payload)
    if (!request) throw new Error('Invalid context request')
    return getMemoryContext(request)
  })

  ipcMain.handle(DEVELOPER_INTELLIGENCE_IPC.LIST_SESSIONS, (_event, payload: unknown) => {
    return listAgentSessions(parseSessionListRequest(payload))
  })

  ipcMain.handle(DEVELOPER_INTELLIGENCE_IPC.GET_SESSION, async (_event, payload: unknown) => {
    if (typeof payload !== 'string' || payload.length === 0 || payload.length > 300) {
      throw new Error('Invalid session id')
    }
    return getAgentSession(payload)
  })
}
