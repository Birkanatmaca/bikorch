import { app, safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'fs'
import { join } from 'path'
import type {
  SecretaryAssignment,
  SecretaryChatRequest,
  SecretaryChatResponse,
  SecretaryPlan,
  SecretaryPlanRequest,
  SecretarySettings,
  SecretaryUsageStats
} from '@shared/contracts/secretary'
import { AI_ACCOUNT_KINDS } from '@shared/contracts/accounts'
import type { CliUsageKind } from '@shared/contracts/usage'
import { readMetaValue, writeMetaValue } from '../persistence/database'
import {
  estimateSecretaryCostUsd,
  type SecretaryResponseUsage
} from './pricing'
import { extractResponseText, readSecretaryReply } from './response-text'

const DEFAULT_MODEL = 'gpt-5'
const KEY_FILE = 'developer-secretary-key.bin'
const MODEL_META_KEY = 'developer_secretary_model'
const USAGE_META_KEY = 'developer_secretary_usage'

const EMPTY_USAGE: SecretaryUsageStats = {
  requests: 0,
  inputTokens: 0,
  cachedInputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  estimatedCostUsd: 0,
  lastRequestAt: null
}

function safeCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0
}

function readUsage(): SecretaryUsageStats {
  const saved = readMetaValue(USAGE_META_KEY)
  if (!saved) return { ...EMPTY_USAGE }
  try {
    const value = JSON.parse(saved) as Partial<SecretaryUsageStats>
    const requests = safeCount(value.requests)
    return {
      requests,
      inputTokens: safeCount(value.inputTokens),
      cachedInputTokens: safeCount(value.cachedInputTokens),
      outputTokens: safeCount(value.outputTokens),
      totalTokens: safeCount(value.totalTokens),
      estimatedCostUsd: value.estimatedCostUsd === null
        ? null
        : typeof value.estimatedCostUsd === 'number' && Number.isFinite(value.estimatedCostUsd) && value.estimatedCostUsd >= 0
          ? value.estimatedCostUsd
          : requests === 0 ? 0 : null,
      lastRequestAt: typeof value.lastRequestAt === 'number' && Number.isFinite(value.lastRequestAt)
        ? value.lastRequestAt
        : null
    }
  } catch {
    return { ...EMPTY_USAGE }
  }
}

function recordUsage(model: string, usage: SecretaryResponseUsage | undefined): void {
  if (!usage) return
  const current = readUsage()
  const inputTokens = safeCount(usage.input_tokens)
  const cachedInputTokens = Math.min(inputTokens, safeCount(usage.input_tokens_details?.cached_tokens))
  const outputTokens = safeCount(usage.output_tokens)
  const measuredTotal = safeCount(usage.total_tokens)
  const requestCost = estimateSecretaryCostUsd(model, usage)
  const estimatedCostUsd = current.estimatedCostUsd === null || requestCost === null
    ? null
    : current.estimatedCostUsd + requestCost
  writeMetaValue(USAGE_META_KEY, JSON.stringify({
    requests: current.requests + 1,
    inputTokens: current.inputTokens + inputTokens,
    cachedInputTokens: current.cachedInputTokens + cachedInputTokens,
    outputTokens: current.outputTokens + outputTokens,
    totalTokens: current.totalTokens + (measuredTotal || inputTokens + outputTokens),
    estimatedCostUsd,
    lastRequestAt: Date.now()
  } satisfies SecretaryUsageStats))
}

function keyPath(): string {
  return join(app.getPath('userData'), KEY_FILE)
}

function readApiKey(): string | null {
  if (!safeStorage.isEncryptionAvailable() || !existsSync(keyPath())) return null
  try {
    const value = safeStorage.decryptString(readFileSync(keyPath())).trim()
    return value || null
  } catch {
    return null
  }
}

export function getSecretarySettings(): SecretarySettings {
  const savedModel = readMetaValue(MODEL_META_KEY)?.trim()
  return {
    configured: Boolean(readApiKey()),
    model: savedModel && savedModel.length <= 100 ? savedModel : DEFAULT_MODEL,
    usage: readUsage()
  }
}

export function updateSecretarySettings(payload: unknown): SecretarySettings {
  const model = (payload as { model?: unknown })?.model
  if (typeof model !== 'string' || !/^[a-zA-Z0-9._-]{2,100}$/.test(model)) {
    throw new Error('Enter a valid model identifier')
  }
  writeMetaValue(MODEL_META_KEY, model)
  return getSecretarySettings()
}

export function saveSecretaryApiKey(value: unknown): SecretarySettings {
  if (typeof value !== 'string' || value.trim().length < 16 || value.length > 500) {
    throw new Error('Enter a valid API key')
  }
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Secure local credential encryption is not available on this computer')
  }
  mkdirSync(app.getPath('userData'), { recursive: true })
  writeFileSync(keyPath(), safeStorage.encryptString(value.trim()), { mode: 0o600 })
  return getSecretarySettings()
}

export function clearSecretaryApiKey(): SecretarySettings {
  if (existsSync(keyPath())) unlinkSync(keyPath())
  return getSecretarySettings()
}

export function resetSecretaryUsage(): SecretarySettings {
  writeMetaValue(USAGE_META_KEY, JSON.stringify(EMPTY_USAGE))
  return getSecretarySettings()
}

function parsePlan(raw: unknown, request: Pick<SecretaryPlanRequest, 'panels' | 'usage'>, required: boolean): SecretaryPlan | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    if (required) throw new Error('The planning response was incomplete')
    return null
  }
  const parsed = raw as Partial<SecretaryPlan>
  if (typeof parsed.overview !== 'string' || !Array.isArray(parsed.assignments)) {
    if (required) throw new Error('The planning response was incomplete')
    return null
  }
  const panels = new Map(request.panels.map((panel) => [panel.id, panel]))
  const assignments: SecretaryAssignment[] = parsed.assignments.slice(0, 8).flatMap((item, index) => {
    if (!item || typeof item !== 'object') return []
    const panel = typeof item.panelId === 'string' ? panels.get(item.panelId) : undefined
    const kind = panel?.kind ?? (AI_ACCOUNT_KINDS.includes(item.kind as CliUsageKind) ? item.kind as CliUsageKind : null)
    if (!kind || typeof item.instruction !== 'string' || !item.instruction.trim()) return []
    const providerUsage = panel?.accountId
      ? request.usage.find((provider) => provider.accountId === panel.accountId)
      : request.usage.find((provider) => provider.kind === kind && !provider.accountId)
    const usedPercent = providerUsage?.primary?.usedPercent ?? 0
    const usageNote = typeof item.usageNote === 'string'
      ? item.usageNote.slice(0, 240)
      : usedPercent >= 80
        ? `Usage looks high (~${Math.round(usedPercent)}%). Still opening this CLI because you asked for it.`
        : 'Review account availability before dispatching.'
    return [{
      id: `assignment-${index + 1}`,
      panelId: panel?.id ?? null,
      kind,
      title: typeof item.title === 'string' ? item.title.slice(0, 120) : `Task ${index + 1}`,
      instruction: item.instruction.trim().slice(0, 6000),
      rationale: typeof item.rationale === 'string' ? item.rationale.slice(0, 500) : 'Selected by the planner.',
      usageNote
    }]
  })
  if (assignments.length === 0) {
    if (required) throw new Error('The planner did not select an available CLI task')
    return null
  }
  return {
    overview: parsed.overview.slice(0, 1000),
    assumptions: Array.isArray(parsed.assumptions)
      ? parsed.assumptions.filter((item): item is string => typeof item === 'string').slice(0, 6)
      : [],
    assignments,
    approvalRequired: true
  }
}

async function callSecretaryModel(
  input: Array<{ role: 'system' | 'user' | 'assistant'; content: Array<{ type: 'input_text'; text: string }> }>
): Promise<string> {
  const apiKey = readApiKey()
  if (!apiKey) throw new Error('Add an OpenAI API key in Developer Secretary settings first')
  const model = getSecretarySettings().model
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      store: false,
      input,
      text: { format: { type: 'json_object' } }
    })
  })
  if (!response.ok) {
    const message = await response.text()
    throw new Error(`Secretary request failed (${response.status}): ${message.slice(0, 240)}`)
  }
  const result = await response.json() as { usage?: SecretaryResponseUsage }
  recordUsage(model, result.usage)
  const text = extractResponseText(result)
  if (!text) throw new Error('The secretary returned no text')
  return text
}

const PLAN_SYSTEM =
  'You are Bikorch Developer Secretary. Plan work for existing CLI sessions. Return only JSON with overview, assumptions, assignments. Assign only listed panel IDs. Respect usage data: avoid providers with 80%+ used. Keep tasks independent, concrete, and do not ask a CLI to commit, push, delete files, or expose secrets. Every assignment needs panelId, kind, title, instruction, rationale, usageNote.'

const CHAT_SYSTEM = `You are Bikorch Developer Secretary, a workspace operator — not a helpdesk.
Reply in the user's language. Return ONLY JSON:
{"reply":"short status the user should read","openKinds":[],"plan":null}

You operate CLIs yourself. Never tell the user to open a panel, skip trust, click Approve, or paste a prompt.
When they say "open CLI", "cli aç", or name an agent (cursor/claude/gemini/antigravity/codex), put that kind in openKinds.
If they say CLI without naming one, use cursor.
If they also want work done (analyze, implement, fix, review, run), plan MUST include assignments. panelId may be null; Bikorch opens the panel, skips workspace trust, and types the instruction.
assignment.instruction is the exact prompt for that CLI.
From the usage payload, prefer the Cursor/account with remaining quota. If one account is exhausted, still assign cursor and note the usable account in usageNote. Do not refuse because usage looks high.
Keep tasks concrete. Do not ask CLIs to commit, push, delete files, or expose secrets.
If they want analysis then implementation, the first instruction should analyze and list prioritized gaps; Bikorch will send follow-up implementation prompts after the CLI reports.
Each assignment needs kind, title, instruction, rationale, usageNote.`

export async function createSecretaryPlan(payload: unknown): Promise<SecretaryPlan> {
  const request = payload as SecretaryPlanRequest
  if (!request?.project?.id || !request.project.name || typeof request.brief !== 'string' || !request.brief.trim()) {
    throw new Error('Project and task brief are required')
  }
  if (!Array.isArray(request.panels) || request.panels.length === 0) {
    throw new Error('Open at least one CLI panel before asking the Secretary to plan work')
  }
  const text = await callSecretaryModel([
    { role: 'system', content: [{ type: 'input_text', text: PLAN_SYSTEM }] },
    { role: 'user', content: [{ type: 'input_text', text: JSON.stringify(request) }] }
  ])
  const parsed = readSecretaryReply(text)
  const plan = parsePlan(parsed.planRaw, request, true)
  if (!plan) throw new Error('The planning response was incomplete')
  return plan
}

function parseChatRequest(payload: unknown): SecretaryChatRequest {
  if (!payload || typeof payload !== 'object') throw new Error('Project and message are required')
  const request = payload as Partial<SecretaryChatRequest>
  if (!request.project?.id || !request.project.name || typeof request.message !== 'string' || !request.message.trim()) {
    throw new Error('Project and message are required')
  }
  const history = Array.isArray(request.history)
    ? request.history.flatMap((turn) => {
        if (!turn || (turn.role !== 'user' && turn.role !== 'assistant')) return []
        if (typeof turn.content !== 'string' || !turn.content.trim()) return []
        return [{ role: turn.role, content: turn.content.trim().slice(0, 8000) }]
      }).slice(-20)
    : []
  return {
    project: {
      id: request.project.id,
      name: request.project.name,
      folderPath: typeof request.project.folderPath === 'string' ? request.project.folderPath : null
    },
    message: request.message.trim().slice(0, 8000),
    history,
    panels: Array.isArray(request.panels) ? request.panels : [],
    usage: Array.isArray(request.usage) ? request.usage : []
  }
}

function parseOpenKinds(raw: unknown): CliUsageKind[] {
  if (!Array.isArray(raw)) return []
  const kinds: CliUsageKind[] = []
  for (const item of raw) {
    if (typeof item !== 'string') continue
    const kind = item.trim().toLowerCase() as CliUsageKind
    if (!AI_ACCOUNT_KINDS.includes(kind) || kinds.includes(kind)) continue
    kinds.push(kind)
  }
  return kinds
}

export async function chatWithSecretary(payload: unknown): Promise<SecretaryChatResponse> {
  const request = parseChatRequest(payload)
  const historyTurns = request.history.map((turn) => ({
    role: turn.role,
    content: [{ type: 'input_text' as const, text: turn.content }]
  }))
  const text = await callSecretaryModel([
    { role: 'system', content: [{ type: 'input_text', text: CHAT_SYSTEM }] },
    {
      role: 'user',
      content: [{
        type: 'input_text',
        text: JSON.stringify({
          project: request.project,
          panels: request.panels,
          usage: request.usage,
          canOpenPanels: true
        })
      }]
    },
    ...historyTurns,
    { role: 'user', content: [{ type: 'input_text', text: request.message }] }
  ])
  const parsed = readSecretaryReply(text)
  const plan = parsePlan(parsed.planRaw, request, false)
  const openKinds = parseOpenKinds(parsed.openKindsRaw)
  if (plan) {
    for (const assignment of plan.assignments) {
      if (!openKinds.includes(assignment.kind) && !assignment.panelId) openKinds.push(assignment.kind)
    }
  }
  return {
    reply: parsed.reply.slice(0, 8000) || 'I could not form a reply.',
    plan,
    openKinds
  }
}
