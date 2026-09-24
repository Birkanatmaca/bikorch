/**
 * Domain types for the background automation system.
 * See docs/product/2026-09-11_AUTOMATION_SYSTEM.md for the full product spec.
 */

export const AUTOMATION_SCHEMA_VERSION = 1

export const AUTOMATION_LIMITS = {
  nameMaxLength: 120,
  promptMaxLength: 8_000,
  minTimeoutMs: 10_000,
  maxTimeoutMs: 30 * 60_000,
  minIntervalMinutes: 5,
  maxRetries: 5,
  minConcurrency: 1,
  maxConcurrency: 4
} as const

export type AutomationExecutorKind = 'codex'

export const AUTOMATION_EXECUTOR_KINDS: AutomationExecutorKind[] = ['codex']

export type AutomationSchedule =
  | { kind: 'once'; runAt: number; timeZone: string }
  | { kind: 'daily'; localTime: string; timeZone: string }
  | { kind: 'weekdays'; localTime: string; timeZone: string }
  | { kind: 'weekly'; days: number[]; localTime: string; timeZone: string }
  | { kind: 'interval'; everyMinutes: number; anchorAt: number }
  | { kind: 'cron'; expression: string; timeZone: string }

export type AutomationScheduleKind = AutomationSchedule['kind']

export const AUTOMATION_SCHEDULE_KINDS: AutomationScheduleKind[] = [
  'once',
  'daily',
  'weekdays',
  'weekly',
  'interval',
  'cron'
]

export type AutomationPermissionProfile =
  | 'observe'
  | 'edit-workspace'
  | 'review-automatically'
  | 'ask-me'
  | 'full-access'

export const AUTOMATION_PERMISSION_PROFILES: AutomationPermissionProfile[] = [
  'observe',
  'edit-workspace',
  'review-automatically',
  'ask-me',
  'full-access'
]

export const AUTOMATION_PERMISSION_PROFILE_LABELS: Record<AutomationPermissionProfile, string> = {
  observe: 'Observe (read-only)',
  'edit-workspace': 'Edit workspace',
  'review-automatically': 'Review automatically',
  'ask-me': 'Ask me',
  'full-access': 'Full access'
}

export type AutomationWorktreeMode = 'isolated' | 'shared'
export type AutomationNetworkPolicy = 'required' | 'optional' | 'none'
export type AutomationRunTrigger = 'scheduled' | 'catch-up' | 'manual'

export type AutomationRunStatus =
  | 'queued'
  | 'waiting-network'
  | 'preparing'
  | 'running'
  | 'needs-attention'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'interrupted'

export const AUTOMATION_ACTIVE_RUN_STATUSES: AutomationRunStatus[] = [
  'queued',
  'waiting-network',
  'preparing',
  'running'
]

export interface AutomationDefinition {
  id: string
  name: string
  projectId: string
  prompt: string
  executorKind: AutomationExecutorKind
  accountId: string | null
  schedule: AutomationSchedule
  timeZone: string
  enabled: boolean
  worktreeMode: AutomationWorktreeMode
  permissionProfile: AutomationPermissionProfile
  networkPolicy: AutomationNetworkPolicy
  timeoutMs: number
  maxRetries: number
  nextRunAt: number | null
  pendingCatchUp: boolean
  pendingScheduledFor: number | null
  createdAt: number
  updatedAt: number
}

export interface AutomationRun {
  id: string
  automationId: string
  projectId: string
  trigger: AutomationRunTrigger
  scheduledFor: number | null
  slotKey: string | null
  status: AutomationRunStatus
  attempt: number
  startedAt: number | null
  finishedAt: number | null
  exitCode: number | null
  providerSessionId: string | null
  worktreePath: string | null
  summary: string | null
  errorCode: string | null
  errorMessage: string | null
  createdAt: number
  updatedAt: number
}

export interface AutomationSettings {
  backgroundMode: boolean
  startAtLogin: boolean
  notifyOnSuccess: boolean
  notifyOnFailure: boolean
  globalPause: boolean
  concurrency: number
  runRetentionDays: number
  eventRetentionDays: number
  tabEducationShown: boolean
}

export function createDefaultAutomationSettings(): AutomationSettings {
  return {
    backgroundMode: false,
    startAtLogin: false,
    notifyOnSuccess: false,
    notifyOnFailure: true,
    globalPause: false,
    concurrency: 2,
    runRetentionDays: 90,
    eventRetentionDays: 30,
    tabEducationShown: false
  }
}

export interface AutomationDraft {
  name: string
  projectId: string
  prompt: string
  executorKind: AutomationExecutorKind
  accountId?: string | null
  schedule: AutomationSchedule
  worktreeMode?: AutomationWorktreeMode
  permissionProfile?: AutomationPermissionProfile
  networkPolicy?: AutomationNetworkPolicy
  timeoutMs?: number
  maxRetries?: number
}

export interface AutomationStatusSummary {
  /** False until a real, secured CLI executor is wired into the scheduler. */
  executionAvailable: boolean
  running: number
  enabled: number
  waitingNetwork: number
  needsAttention: number
  nextRunAt: number | null
}

export type AutomationEvent =
  | { type: 'definition-changed'; definition: AutomationDefinition }
  | { type: 'definition-removed'; automationId: string }
  | { type: 'run-changed'; run: AutomationRun }
  | { type: 'status-changed'; status: AutomationStatusSummary }

export const AUTOMATION_IPC = {
  LIST: 'automation:list',
  GET: 'automation:get',
  CREATE: 'automation:create',
  UPDATE: 'automation:update',
  REMOVE: 'automation:remove',
  SET_ENABLED: 'automation:setEnabled',
  RUN_NOW: 'automation:runNow',
  CANCEL_RUN: 'automation:cancelRun',
  LIST_RUNS: 'automation:listRuns',
  GET_SETTINGS: 'automation:getSettings',
  UPDATE_SETTINGS: 'automation:updateSettings',
  GET_STATUS: 'automation:getStatus',
  EVENT: 'automation:event'
} as const

export function isValidTimeZone(timeZone: string): boolean {
  if (!timeZone || timeZone.length > 100) return false
  try {
    Intl.DateTimeFormat(undefined, { timeZone })
    return true
  } catch {
    return false
  }
}

function isLocalTimeString(value: unknown): value is string {
  return typeof value === 'string' && /^([01]\d|2[0-3]):([0-5]\d)$/.test(value)
}

export function validateAutomationSchedule(schedule: unknown): schedule is AutomationSchedule {
  if (!schedule || typeof schedule !== 'object') return false
  const candidate = schedule as Partial<AutomationSchedule>

  switch (candidate.kind) {
    case 'once':
      return (
        typeof candidate.runAt === 'number' &&
        Number.isFinite(candidate.runAt) &&
        isValidTimeZone((candidate as { timeZone?: string }).timeZone ?? '')
      )
    case 'daily':
    case 'weekdays':
      return (
        isLocalTimeString((candidate as { localTime?: string }).localTime) &&
        isValidTimeZone((candidate as { timeZone?: string }).timeZone ?? '')
      )
    case 'weekly': {
      const weekly = candidate as { days?: unknown; localTime?: unknown; timeZone?: string }
      return (
        Array.isArray(weekly.days) &&
        weekly.days.length > 0 &&
        weekly.days.every((day) => typeof day === 'number' && day >= 0 && day <= 6) &&
        isLocalTimeString(weekly.localTime) &&
        isValidTimeZone(weekly.timeZone ?? '')
      )
    }
    case 'interval': {
      const interval = candidate as { everyMinutes?: unknown; anchorAt?: unknown }
      return (
        typeof interval.everyMinutes === 'number' &&
        interval.everyMinutes >= AUTOMATION_LIMITS.minIntervalMinutes &&
        Number.isFinite(interval.everyMinutes) &&
        typeof interval.anchorAt === 'number' &&
        Number.isFinite(interval.anchorAt)
      )
    }
    case 'cron': {
      const cron = candidate as { expression?: unknown; timeZone?: string }
      return (
        typeof cron.expression === 'string' &&
        cron.expression.trim().length > 0 &&
        cron.expression.length <= 200 &&
        isValidTimeZone(cron.timeZone ?? '')
      )
    }
    default:
      return false
  }
}

export function describeAutomationSchedule(schedule: AutomationSchedule | null | undefined): string {
  if (!schedule || typeof schedule !== 'object') return 'Unscheduled'
  switch (schedule.kind) {
    case 'once':
      return Number.isFinite(schedule.runAt)
        ? `Once at ${new Date(schedule.runAt).toLocaleString()}`
        : 'Once'
    case 'daily':
      return schedule.localTime ? `Daily at ${schedule.localTime}` : 'Daily'
    case 'weekdays':
      return schedule.localTime ? `Weekdays at ${schedule.localTime}` : 'Weekdays'
    case 'weekly': {
      const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
      const days = Array.isArray(schedule.days)
        ? [...schedule.days].sort().map((day) => names[day] ?? '?').join(', ')
        : ''
      return days && schedule.localTime ? `${days} at ${schedule.localTime}` : 'Weekly'
    }
    case 'interval':
      return Number.isFinite(schedule.everyMinutes)
        ? `Every ${schedule.everyMinutes} min`
        : 'Interval'
    case 'cron':
      return schedule.expression?.trim() || 'Cron'
    default:
      return 'Custom schedule'
  }
}
