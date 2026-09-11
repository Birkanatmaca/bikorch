import type { AutomationDefinition } from '@shared/contracts/automation'
import type { ScheduleCalculator } from './schedule-calculator'

/**
 * Minimal view of automation storage the scheduler needs. Kept narrow and
 * synchronous so the reconciliation algorithm is easy to unit test with an
 * in-memory double; the real SQL-backed repository implements the same shape.
 */
export interface AutomationSchedulerRepository {
  listEnabled(): AutomationDefinition[]
  setNextRunAt(automationId: string, nextRunAt: number | null): void
  markCatchUpPending(automationId: string, scheduledFor: number): void
  clearCatchUp(automationId: string): void
  hasActiveRun(automationId: string): boolean
  /** Returns false if a run for this exact slot already exists (idempotent claim). */
  claimRun(automationId: string, scheduledFor: number, trigger: 'catch-up' | 'scheduled'): boolean
}

export interface ConnectivityGate {
  canRun(automation: AutomationDefinition): boolean
}

const ALWAYS_ONLINE: ConnectivityGate = { canRun: () => true }

export interface ReconcileResult {
  claimedRunAutomationIds: string[]
}

/**
 * Runs one coalesce-one reconciliation pass over all enabled automations.
 *
 * For each automation:
 * 1. If the latest due slot is newer than or equal to the tracked `nextRunAt`,
 *    replace any older pending catch-up marker with that single slot and
 *    advance `nextRunAt` to the next future occurrence. This step never
 *    enumerates missed occurrences — only the most recent one is kept.
 * 2. If a pending catch-up marker exists and the automation is not already
 *    running and connectivity allows it, atomically claim one run for it.
 *
 * Calling this repeatedly with the same `now` (or slightly later) must be
 * idempotent: once a slot has been claimed, `claimRun` for that same slot
 * returns false and no duplicate run is created.
 */
export function reconcileOnce(
  repository: AutomationSchedulerRepository,
  calculator: ScheduleCalculator,
  now: number,
  connectivity: ConnectivityGate = ALWAYS_ONLINE
): ReconcileResult {
  const claimedRunAutomationIds: string[] = []

  for (const automation of repository.listEnabled()) {
    const latestDueSlot = calculator.latestOccurrenceAtOrBefore(automation.schedule, now)
    let pendingSlot = automation.pendingCatchUp ? automation.pendingScheduledFor ?? null : null

    if (latestDueSlot !== null && (automation.nextRunAt === null || latestDueSlot >= automation.nextRunAt)) {
      repository.markCatchUpPending(automation.id, latestDueSlot)
      pendingSlot = latestDueSlot
      const next = calculator.nextOccurrenceAfter(automation.schedule, now)
      repository.setNextRunAt(automation.id, next)
    }

    if (pendingSlot === null) continue
    if (repository.hasActiveRun(automation.id)) continue
    if (!connectivity.canRun(automation)) continue

    const claimed = repository.claimRun(automation.id, pendingSlot, 'catch-up')
    if (claimed) {
      repository.clearCatchUp(automation.id)
      claimedRunAutomationIds.push(automation.id)
    }
  }

  return { claimedRunAutomationIds }
}

/** Capped wake interval for the background scheduler timer (never sleep for days at once). */
export const SCHEDULER_MAX_WAKE_MS = 60_000

export class AutomationScheduler {
  private timer: ReturnType<typeof setTimeout> | null = null
  private reconciling = false

  constructor(
    private readonly repository: AutomationSchedulerRepository,
    private readonly calculator: ScheduleCalculator,
    private readonly connectivity: ConnectivityGate = ALWAYS_ONLINE,
    private readonly now: () => number = () => Date.now(),
    private readonly onReconciled?: (result: ReconcileResult) => void
  ) {}

  /** Serialized: overlapping calls collapse into a single pass. */
  reconcile(): ReconcileResult {
    if (this.reconciling) return { claimedRunAutomationIds: [] }
    this.reconciling = true
    try {
      const result = reconcileOnce(this.repository, this.calculator, this.now(), this.connectivity)
      this.onReconciled?.(result)
      return result
    } finally {
      this.reconciling = false
    }
  }

  start(): void {
    this.stop()
    this.reconcile()
    this.timer = setInterval(() => this.reconcile(), SCHEDULER_MAX_WAKE_MS)
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  /** Call on system resume/unlock, connectivity recovery, and clock/tz changes. */
  reconcileNow(): ReconcileResult {
    return this.reconcile()
  }
}
