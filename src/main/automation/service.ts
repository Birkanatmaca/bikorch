import { randomUUID } from 'crypto'
import { app, BrowserWindow } from 'electron'
import {
  AUTOMATION_IPC,
  AUTOMATION_LIMITS,
  createDefaultAutomationSettings,
  validateAutomationSchedule,
  type AutomationDefinition,
  type AutomationDraft,
  type AutomationEvent,
  type AutomationRun,
  type AutomationSettings,
  type AutomationStatusSummary
} from '@shared/contracts/automation'
import { loadSnapshot } from '../persistence/database'
import {
  getAutomationDefinitionRepository,
  getAutomationRunRepository,
  getAutomationSettingsRepository,
  type AutomationDefinitionRepository,
  type AutomationRunRepository,
  type AutomationSettingsRepository
} from './store'
import { createScheduleCalculator, type ScheduleCalculator } from './schedule-calculator'
import {
  AutomationScheduler,
  type AutomationSchedulerRepository,
  type ConnectivityGate,
  type ReconcileResult
} from './scheduler'

/** Real CLI execution stays unavailable until its executor and security gate land. */
const REAL_EXECUTION_ENABLED = false

let scheduler: AutomationScheduler | null = null
let calculator: ScheduleCalculator | null = null

function broadcast(event: AutomationEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue
    try {
      win.webContents.send(AUTOMATION_IPC.EVENT, event)
    } catch {
      // window disappeared mid-broadcast
    }
  }
}

function requireDefinitions(): AutomationDefinitionRepository {
  const repo = getAutomationDefinitionRepository()
  if (!repo) throw new Error('Automation storage is not ready yet')
  return repo
}

function requireRuns(): AutomationRunRepository {
  const repo = getAutomationRunRepository()
  if (!repo) throw new Error('Automation storage is not ready yet')
  return repo
}

function requireSettings(): AutomationSettingsRepository {
  const repo = getAutomationSettingsRepository()
  if (!repo) throw new Error('Automation storage is not ready yet')
  return repo
}

function emitStatus(): void {
  try {
    broadcast({ type: 'status-changed', status: computeStatus() })
  } catch (error) {
    console.error('[automation] failed to emit status:', error)
  }
}

function enableBackgroundDefaults(): void {
  try {
    const settings = requireSettings().get()
    if (settings.tabEducationShown) return
    requireSettings().update({
      backgroundMode: true,
      startAtLogin: true,
      tabEducationShown: true
    })
    if (process.platform !== 'linux') {
      app.setLoginItemSettings({
        openAtLogin: true,
        args: ['--background']
      })
    }
  } catch (error) {
    console.error('[automation] could not enable background defaults:', error)
  }
}

function computeStatus(): AutomationStatusSummary {
  const definitions = requireDefinitions().list()
  const runs = requireRuns().list()
  const enabled = definitions.filter((d) => d.enabled).length
  const running = runs.filter((r) => r.status === 'preparing' || r.status === 'running').length
  const waitingNetwork = runs.filter((r) => r.status === 'waiting-network').length
  const needsAttention = runs.filter((r) => r.status === 'needs-attention').length
  const nextRunAt = definitions
    .filter((d) => d.enabled && d.nextRunAt !== null)
    .map((d) => d.nextRunAt as number)
    .sort((a, b) => a - b)[0] ?? null

  return { executionAvailable: REAL_EXECUTION_ENABLED, running, enabled, waitingNetwork, needsAttention, nextRunAt }
}

/** Bridges the narrow scheduler contract onto the two SQL repositories. */
function createSchedulerRepositoryAdapter(): AutomationSchedulerRepository {
  return {
    listEnabled(): AutomationDefinition[] {
      return requireDefinitions().listEnabled()
    },
    setNextRunAt(automationId, nextRunAt) {
      requireDefinitions().setNextRunAt(automationId, nextRunAt)
    },
    markCatchUpPending(automationId, scheduledFor) {
      requireDefinitions().markCatchUpPending(automationId, scheduledFor)
      const definition = requireDefinitions().get(automationId)
      if (definition) broadcast({ type: 'definition-changed', definition })
    },
    clearCatchUp(automationId) {
      requireDefinitions().clearCatchUp(automationId)
    },
    hasActiveRun(automationId) {
      return requireRuns().hasActiveRun(automationId)
    },
    claimRun(automationId, scheduledFor, trigger) {
      if (!REAL_EXECUTION_ENABLED) return false
      const definition = requireDefinitions().get(automationId)
      if (!definition) return false
      const slotKey = `${trigger}:${scheduledFor}`
      const runId = randomUUID()
      const claimed = requireRuns().claim({
        id: runId,
        automationId,
        projectId: definition.projectId,
        trigger,
        scheduledFor,
        slotKey
      })
      if (claimed) {
        const run = requireRuns().get(runId)
        if (run) broadcast({ type: 'run-changed', run })
      }
      return claimed
    }
  }
}

const connectivity: ConnectivityGate = {
  canRun: () => REAL_EXECUTION_ENABLED
}

export function initAutomationService(): void {
  const runs = getAutomationRunRepository()
  const reclassified = runs?.markSimulatedRunsNeedsAttention() ?? 0
  if (reclassified > 0) {
    console.warn(`[automation] reclassified ${reclassified} simulated success record(s)`)
  }
  const interrupted = runs?.markStaleActiveRunsInterrupted() ?? 0
  if (interrupted > 0) {
    console.info(`[automation] marked ${interrupted} stale run(s) as interrupted after restart`)
  }

  calculator = createScheduleCalculator()
  scheduler = new AutomationScheduler(
    createSchedulerRepositoryAdapter(),
    calculator,
    connectivity,
    () => Date.now(),
    () => emitStatus()
  )
  scheduler.start()
}

export function reconcileAutomationsNow(): ReconcileResult | null {
  return scheduler?.reconcileNow() ?? null
}

export function disposeAutomationService(): void {
  scheduler?.stop()
  scheduler = null
}

function assertKnownProject(projectId: string): void {
  const snapshot = loadSnapshot()
  if (!snapshot.projects.some((project) => project.id === projectId)) {
    throw new Error('Unknown project')
  }
}

function validateDraft(draft: unknown): AutomationDraft {
  if (!draft || typeof draft !== 'object') throw new Error('Invalid automation payload')
  const candidate = draft as Partial<AutomationDraft>

  if (
    typeof candidate.name !== 'string' ||
    candidate.name.trim().length === 0 ||
    candidate.name.length > AUTOMATION_LIMITS.nameMaxLength
  ) {
    throw new Error('Invalid automation name')
  }
  if (typeof candidate.projectId !== 'string' || candidate.projectId.length === 0) {
    throw new Error('Invalid project')
  }
  assertKnownProject(candidate.projectId)

  if (
    typeof candidate.prompt !== 'string' ||
    candidate.prompt.trim().length === 0 ||
    candidate.prompt.length > AUTOMATION_LIMITS.promptMaxLength
  ) {
    throw new Error('Invalid automation prompt')
  }
  if (candidate.executorKind !== 'codex') {
    throw new Error('Unsupported executor')
  }
  if (!validateAutomationSchedule(candidate.schedule)) {
    throw new Error('Invalid schedule')
  }

  const timeoutMs = candidate.timeoutMs ?? 5 * 60_000
  if (
    typeof timeoutMs !== 'number' ||
    timeoutMs < AUTOMATION_LIMITS.minTimeoutMs ||
    timeoutMs > AUTOMATION_LIMITS.maxTimeoutMs
  ) {
    throw new Error('Invalid timeout')
  }

  const maxRetries = candidate.maxRetries ?? 1
  if (typeof maxRetries !== 'number' || maxRetries < 0 || maxRetries > AUTOMATION_LIMITS.maxRetries) {
    throw new Error('Invalid retry count')
  }

  return {
    name: candidate.name.trim(),
    projectId: candidate.projectId,
    prompt: candidate.prompt,
    executorKind: candidate.executorKind,
    accountId: typeof candidate.accountId === 'string' ? candidate.accountId : null,
    schedule: candidate.schedule,
    worktreeMode: candidate.worktreeMode === 'shared' ? 'shared' : 'isolated',
    permissionProfile:
      candidate.permissionProfile && candidate.permissionProfile !== 'full-access'
        ? candidate.permissionProfile
        : 'observe',
    networkPolicy: candidate.networkPolicy ?? 'optional',
    timeoutMs,
    maxRetries
  }
}

export function listAutomations(): AutomationDefinition[] {
  return requireDefinitions().list()
}

export function getAutomation(id: string): AutomationDefinition | null {
  if (typeof id !== 'string' || id.length === 0) return null
  return requireDefinitions().get(id)
}

export function createAutomation(payload: unknown): AutomationDefinition {
  const draft = validateDraft(payload)
  const now = Date.now()
  const definitions = requireDefinitions()
  const nextRunAt = calculator?.nextOccurrenceAfter(draft.schedule, now) ?? null

  const definition: AutomationDefinition = {
    id: randomUUID(),
    name: draft.name,
    projectId: draft.projectId,
    prompt: draft.prompt,
    executorKind: draft.executorKind,
    accountId: draft.accountId ?? null,
    schedule: draft.schedule,
    timeZone: 'timeZone' in draft.schedule ? draft.schedule.timeZone : 'UTC',
    enabled: true,
    worktreeMode: draft.worktreeMode ?? 'isolated',
    permissionProfile: draft.permissionProfile ?? 'observe',
    networkPolicy: draft.networkPolicy ?? 'optional',
    timeoutMs: draft.timeoutMs ?? 5 * 60_000,
    maxRetries: draft.maxRetries ?? 1,
    nextRunAt,
    pendingCatchUp: false,
    pendingScheduledFor: null,
    createdAt: now,
    updatedAt: now
  }

  definitions.upsert(definition)
  try {
    enableBackgroundDefaults()
  } catch {
    // Background defaults are optional; the automation itself must still persist.
  }
  broadcast({ type: 'definition-changed', definition })
  emitStatus()
  return definition
}

export function updateAutomation(id: string, payload: unknown): AutomationDefinition {
  const existing = requireDefinitions().get(id)
  if (!existing) throw new Error('Automation not found')
  const draft = validateDraft({ ...existing, ...(payload as object) })
  const nextRunAt = calculator?.nextOccurrenceAfter(draft.schedule, Date.now()) ?? existing.nextRunAt

  const updated: AutomationDefinition = {
    ...existing,
    name: draft.name,
    projectId: draft.projectId,
    prompt: draft.prompt,
    accountId: draft.accountId ?? null,
    schedule: draft.schedule,
    timeZone: 'timeZone' in draft.schedule ? draft.schedule.timeZone : existing.timeZone,
    worktreeMode: draft.worktreeMode ?? existing.worktreeMode,
    permissionProfile: draft.permissionProfile ?? existing.permissionProfile,
    networkPolicy: draft.networkPolicy ?? existing.networkPolicy,
    timeoutMs: draft.timeoutMs ?? existing.timeoutMs,
    maxRetries: draft.maxRetries ?? existing.maxRetries,
    nextRunAt,
    pendingCatchUp: false,
    pendingScheduledFor: null,
    updatedAt: Date.now()
  }

  requireDefinitions().upsert(updated)
  broadcast({ type: 'definition-changed', definition: updated })
  emitStatus()
  return updated
}

export function removeAutomation(id: string): void {
  if (typeof id !== 'string' || id.length === 0) throw new Error('Invalid automation id')
  requireDefinitions().remove(id)
  broadcast({ type: 'definition-removed', automationId: id })
  emitStatus()
}

export function setAutomationEnabled(id: string, enabled: boolean): AutomationDefinition {
  const definitions = requireDefinitions()
  const existing = definitions.get(id)
  if (!existing) throw new Error('Automation not found')
  definitions.setEnabled(id, enabled)
  if (enabled) {
    const nextRunAt = calculator?.nextOccurrenceAfter(existing.schedule, Date.now()) ?? null
    definitions.setNextRunAt(id, nextRunAt)
  }
  const updated = definitions.get(id) as AutomationDefinition
  broadcast({ type: 'definition-changed', definition: updated })
  emitStatus()
  return updated
}

export function runAutomationNow(id: string): AutomationRun {
  if (!REAL_EXECUTION_ENABLED) {
    throw new Error('Automation execution is not available yet. No CLI task was started.')
  }
  const definition = requireDefinitions().get(id)
  if (!definition) throw new Error('Automation not found')
  const runs = requireRuns()
  const runId = randomUUID()
  const claimed = runs.claim({
    id: runId,
    automationId: id,
    projectId: definition.projectId,
    trigger: 'manual',
    scheduledFor: null,
    slotKey: null
  })
  if (!claimed) throw new Error('Failed to start run')
  const run = runs.get(runId) as AutomationRun
  broadcast({ type: 'run-changed', run })
  return run
}

export function cancelAutomationRun(runId: string): void {
  const runs = requireRuns()
  const run = runs.get(runId)
  if (!run) throw new Error('Run not found')
  runs.update(runId, { status: 'cancelled', finishedAt: Date.now() })
  const updated = runs.get(runId)
  if (updated) broadcast({ type: 'run-changed', run: updated })
  emitStatus()
}

export function listAutomationRuns(automationId?: string): AutomationRun[] {
  return requireRuns().list(automationId)
}

export function getAutomationSettings(): AutomationSettings {
  try {
    return requireSettings().get()
  } catch {
    return createDefaultAutomationSettings()
  }
}

export function updateAutomationSettings(patch: unknown): AutomationSettings {
  if (!patch || typeof patch !== 'object') throw new Error('Invalid settings payload')
  const candidate = patch as Partial<AutomationSettings>
  const safePatch: Partial<AutomationSettings> = {}

  if (typeof candidate.backgroundMode === 'boolean') safePatch.backgroundMode = candidate.backgroundMode
  if (typeof candidate.startAtLogin === 'boolean') safePatch.startAtLogin = candidate.startAtLogin
  if (typeof candidate.notifyOnSuccess === 'boolean') safePatch.notifyOnSuccess = candidate.notifyOnSuccess
  if (typeof candidate.notifyOnFailure === 'boolean') safePatch.notifyOnFailure = candidate.notifyOnFailure
  if (typeof candidate.globalPause === 'boolean') safePatch.globalPause = candidate.globalPause
  if (
    typeof candidate.concurrency === 'number' &&
    candidate.concurrency >= AUTOMATION_LIMITS.minConcurrency &&
    candidate.concurrency <= AUTOMATION_LIMITS.maxConcurrency
  ) {
    safePatch.concurrency = candidate.concurrency
  }
  if (typeof candidate.tabEducationShown === 'boolean') safePatch.tabEducationShown = candidate.tabEducationShown

  return requireSettings().update(safePatch)
}

export function getAutomationStatus(): AutomationStatusSummary {
  return computeStatus()
}
