import { dialog, ipcMain } from 'electron'
import type { OpenDialogOptions } from 'electron'
import { readFile, writeFile } from 'fs/promises'
import { DEVELOPER_INTELLIGENCE_IPC, type SkillUpdate } from '@shared/contracts/developer-intelligence'
import {
  analyzeMemories,
  buildExport,
  clearData,
  createMemory,
  createSkill,
  deleteSkill,
  importSkillsFromText,
  listSkills,
  updateSkill,
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
import { learnDeveloperMemoriesWithAi } from '../secretary/service'
import { normalizeSkillDraft } from '../developer-intelligence/skills'
import { assertTrustedMainWindow } from './trusted-sender'

export function registerDeveloperIntelligenceHandlers(): void {
  ipcMain.handle(DEVELOPER_INTELLIGENCE_IPC.RECORD_EVENT, (event, payload: unknown) => {
    assertTrustedMainWindow(event)
    const input = parseEventInput(payload)
    if (!input) throw new Error('Invalid developer event')
    return recordDeveloperEvent(input)
  })

  ipcMain.handle(DEVELOPER_INTELLIGENCE_IPC.RECORD_PROMPT, (event, payload: unknown) => {
    assertTrustedMainWindow(event)
    const request = parsePromptRequest(payload)
    if (!request) throw new Error('Invalid prompt record request')
    return recordPrompt(request)
  })

  ipcMain.handle(DEVELOPER_INTELLIGENCE_IPC.LIST_PROMPTS, (event, payload: unknown) => {
    assertTrustedMainWindow(event)
    return listPrompts(parsePromptFilter(payload))
  })

  ipcMain.handle(DEVELOPER_INTELLIGENCE_IPC.DELETE_PROMPTS, (event, payload: unknown) => {
    assertTrustedMainWindow(event)
    const ids = parseIdList(payload)
    if (!ids) throw new Error('Invalid prompt id list')
    return deletePrompts(ids)
  })

  ipcMain.handle(DEVELOPER_INTELLIGENCE_IPC.GET_METRICS, (event, payload: unknown) => {
    assertTrustedMainWindow(event)
    const request = parseMetricsRequest(payload)
    if (!request) throw new Error('Invalid metrics request')
    return getMetrics(request)
  })

  ipcMain.handle(DEVELOPER_INTELLIGENCE_IPC.LIST_SKILLS, (event) => {
    assertTrustedMainWindow(event)
    return listSkills()
  })

  ipcMain.handle(DEVELOPER_INTELLIGENCE_IPC.CREATE_SKILL, (event, payload: unknown) => {
    assertTrustedMainWindow(event)
    const draft = normalizeSkillDraft(payload)
    if (!draft) throw new Error('Invalid skill')
    return createSkill(draft, 'user')
  })

  ipcMain.handle(DEVELOPER_INTELLIGENCE_IPC.UPDATE_SKILL, (event, payload: unknown) => {
    assertTrustedMainWindow(event)
    if (!payload || typeof payload !== 'object') throw new Error('Invalid skill update')
    const body = payload as { id?: unknown; updates?: unknown }
    if (typeof body.id !== 'string' || !body.id) throw new Error('Invalid skill update')
    const updates = body.updates
    if (!updates || typeof updates !== 'object') throw new Error('Invalid skill update')
    return updateSkill(body.id, updates as SkillUpdate)
  })

  ipcMain.handle(DEVELOPER_INTELLIGENCE_IPC.DELETE_SKILL, (event, payload: unknown) => {
    assertTrustedMainWindow(event)
    if (typeof payload !== 'string' || payload.length === 0 || payload.length > 200) {
      throw new Error('Invalid skill id')
    }
    return { ok: deleteSkill(payload) }
  })

  ipcMain.handle(DEVELOPER_INTELLIGENCE_IPC.IMPORT_SKILL, async (event) => {
    const win = assertTrustedMainWindow(event)
    const options: OpenDialogOptions = {
      title: 'Import skill',
      filters: [{ name: 'Skill', extensions: ['md', 'json', 'txt'] }],
      properties: ['openFile']
    }
    const result = await dialog.showOpenDialog(win, options)
    if (result.canceled || !result.filePaths[0]) return { ok: false as const, canceled: true as const }
    const text = await readFile(result.filePaths[0], 'utf8')
    const skills = importSkillsFromText(text)
    if (skills.length === 0) throw new Error('No skill found in that file')
    return { ok: true as const, skills }
  })

  ipcMain.handle(DEVELOPER_INTELLIGENCE_IPC.LIST_MEMORIES, (event) => {
    assertTrustedMainWindow(event)
    return listMemories()
  })

  ipcMain.handle(DEVELOPER_INTELLIGENCE_IPC.CREATE_MEMORY, (event, payload: unknown) => {
    assertTrustedMainWindow(event)
    const draft = parseMemoryDraft(payload)
    if (!draft) throw new Error('Invalid memory')
    return createMemory(draft)
  })

  ipcMain.handle(DEVELOPER_INTELLIGENCE_IPC.UPDATE_MEMORY, (event, payload: unknown) => {
    assertTrustedMainWindow(event)
    const parsed = parseMemoryUpdate(payload)
    if (!parsed) throw new Error('Invalid memory update')
    return updateMemory(parsed.id, parsed.updates)
  })

  ipcMain.handle(DEVELOPER_INTELLIGENCE_IPC.DELETE_MEMORY, (event, payload: unknown) => {
    assertTrustedMainWindow(event)
    if (typeof payload !== 'string' || payload.length === 0 || payload.length > 200) {
      throw new Error('Invalid memory id')
    }
    return { ok: deleteMemory(payload) }
  })

  ipcMain.handle(DEVELOPER_INTELLIGENCE_IPC.GET_SETTINGS, (event) => {
    assertTrustedMainWindow(event)
    return getDeveloperIntelligenceSettings()
  })

  ipcMain.handle(DEVELOPER_INTELLIGENCE_IPC.UPDATE_SETTINGS, (event, payload: unknown) => {
    assertTrustedMainWindow(event)
    const updates = parseSettingsUpdate(payload)
    if (!updates) throw new Error('Invalid settings update')
    return updateDeveloperIntelligenceSettings(updates)
  })

  ipcMain.handle(DEVELOPER_INTELLIGENCE_IPC.GET_STATS, (event) => {
    assertTrustedMainWindow(event)
    return getStats()
  })

  ipcMain.handle(DEVELOPER_INTELLIGENCE_IPC.EXPORT, async (event) => {
    const win = assertTrustedMainWindow(event)
    const defaultName = `bikorch-developer-intelligence-${new Date().toISOString().slice(0, 10)}.json`
    const options = {
      title: 'Export Developer Intelligence data',
      defaultPath: defaultName,
      filters: [{ name: 'JSON', extensions: ['json'] }]
    }
    const result = await dialog.showSaveDialog(win, options)
    if (result.canceled || !result.filePath) return { ok: false as const, canceled: true as const }

    const data = buildExport()
    await writeFile(result.filePath, JSON.stringify(data, null, 2), 'utf8')
    return {
      ok: true as const,
      filePath: result.filePath,
      counts: { events: data.events.length, prompts: data.prompts.length, memories: data.memories.length }
    }
  })

  ipcMain.handle(DEVELOPER_INTELLIGENCE_IPC.CLEAR, (event, payload: unknown) => {
    assertTrustedMainWindow(event)
    const target = parseClearTarget(payload)
    if (!target) throw new Error('Invalid clear target')
    return clearData(target)
  })

  ipcMain.handle(DEVELOPER_INTELLIGENCE_IPC.ANALYZE, (event, payload: unknown) => {
    assertTrustedMainWindow(event)
    const request = parseMetricsRequest(payload)
    if (!request) throw new Error('Invalid analysis request')
    return analyzeMemories(request)
  })

  ipcMain.handle(DEVELOPER_INTELLIGENCE_IPC.LEARN_WITH_AI, (event) => {
    assertTrustedMainWindow(event)
    return learnDeveloperMemoriesWithAi()
  })

  ipcMain.handle(DEVELOPER_INTELLIGENCE_IPC.GET_CONTEXT, (event, payload: unknown) => {
    assertTrustedMainWindow(event)
    const request = parseContextRequest(payload)
    if (!request) throw new Error('Invalid context request')
    return getMemoryContext(request)
  })

  ipcMain.handle(DEVELOPER_INTELLIGENCE_IPC.LIST_SESSIONS, (event, payload: unknown) => {
    assertTrustedMainWindow(event)
    return listAgentSessions(parseSessionListRequest(payload))
  })

  ipcMain.handle(DEVELOPER_INTELLIGENCE_IPC.GET_SESSION, async (event, payload: unknown) => {
    assertTrustedMainWindow(event)
    if (typeof payload !== 'string' || payload.length === 0 || payload.length > 300) {
      throw new Error('Invalid session id')
    }
    return getAgentSession(payload)
  })
}
