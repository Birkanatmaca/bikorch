import { app, safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'fs'
import { join } from 'path'
import type {
  SecretaryAssignment,
  SecretaryPlan,
  SecretaryPlanRequest,
  SecretarySettings
} from '@shared/contracts/secretary'
import { AI_ACCOUNT_KINDS } from '@shared/contracts/accounts'
import type { CliUsageKind } from '@shared/contracts/usage'
import { readMetaValue, writeMetaValue } from '../persistence/database'

const DEFAULT_MODEL = 'gpt-5'
const KEY_FILE = 'developer-secretary-key.bin'
const MODEL_META_KEY = 'developer_secretary_model'

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
  return { configured: Boolean(readApiKey()), model: savedModel && savedModel.length <= 100 ? savedModel : DEFAULT_MODEL }
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

function parsePlan(text: string, request: SecretaryPlanRequest): SecretaryPlan {
  const parsed = JSON.parse(text) as Partial<SecretaryPlan>
  if (!parsed || typeof parsed.overview !== 'string' || !Array.isArray(parsed.assignments)) {
    throw new Error('The planning response was incomplete')
  }
  const panels = new Map(request.panels.map((panel) => [panel.id, panel]))
  const assignments: SecretaryAssignment[] = parsed.assignments.slice(0, 8).flatMap((raw, index) => {
    if (!raw || typeof raw !== 'object') return []
    const item = raw as Partial<SecretaryAssignment>
    const panel = typeof item.panelId === 'string' ? panels.get(item.panelId) : undefined
    const kind = panel?.kind ?? (AI_ACCOUNT_KINDS.includes(item.kind as CliUsageKind) ? item.kind as CliUsageKind : null)
    if (!kind || typeof item.instruction !== 'string' || !item.instruction.trim()) return []
    const providerUsage = panel?.accountId
      ? request.usage.find((provider) => provider.accountId === panel.accountId)
      : request.usage.find((provider) => provider.kind === kind && !provider.accountId)
    if ((providerUsage?.primary?.usedPercent ?? 0) >= 80) return []
    return [{
      id: `assignment-${index + 1}`,
      panelId: panel?.id ?? null,
      kind,
      title: typeof item.title === 'string' ? item.title.slice(0, 120) : `Task ${index + 1}`,
      instruction: item.instruction.trim().slice(0, 6000),
      rationale: typeof item.rationale === 'string' ? item.rationale.slice(0, 500) : 'Selected by the planner.',
      usageNote: typeof item.usageNote === 'string' ? item.usageNote.slice(0, 240) : 'Review account availability before dispatching.'
    }]
  })
  if (assignments.length === 0) throw new Error('The planner did not select an available CLI task')
  return {
    overview: parsed.overview.slice(0, 1000),
    assumptions: Array.isArray(parsed.assumptions) ? parsed.assumptions.filter((item): item is string => typeof item === 'string').slice(0, 6) : [],
    assignments,
    approvalRequired: true
  }
}

export async function createSecretaryPlan(payload: unknown): Promise<SecretaryPlan> {
  const request = payload as SecretaryPlanRequest
  if (!request?.project?.id || !request.project.name || typeof request.brief !== 'string' || !request.brief.trim()) {
    throw new Error('Project and task brief are required')
  }
  if (!Array.isArray(request.panels) || request.panels.length === 0) {
    throw new Error('Open at least one CLI panel before asking the Secretary to plan work')
  }
  const apiKey = readApiKey()
  if (!apiKey) throw new Error('Add an OpenAI API key in Developer Secretary settings first')
  const body = {
    model: getSecretarySettings().model,
    store: false,
    input: [
      {
        role: 'system',
        content: [{ type: 'input_text', text: 'You are Bikorch Developer Secretary. Plan work for existing CLI sessions. Return only JSON with overview, assumptions, assignments. Assign only listed panel IDs. Respect usage data: avoid providers with 80%+ used. Keep tasks independent, concrete, and do not ask a CLI to commit, push, delete files, or expose secrets. Every assignment needs panelId, kind, title, instruction, rationale, usageNote.' }]
      },
      {
        role: 'user',
        content: [{ type: 'input_text', text: JSON.stringify(request) }]
      }
    ],
    text: { format: { type: 'json_object' } }
  }
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  if (!response.ok) {
    const message = await response.text()
    throw new Error(`Planning request failed (${response.status}): ${message.slice(0, 240)}`)
  }
  const result = await response.json() as { output_text?: unknown }
  if (typeof result.output_text !== 'string') throw new Error('The planning service returned no text')
  return parsePlan(result.output_text, request)
}
