import { describe, expect, it } from 'vitest'
import type { AutomationDefinition, AutomationSchedule } from '@shared/contracts/automation'
import { createScheduleCalculator } from '../schedule-calculator'
import { reconcileOnce, type AutomationSchedulerRepository } from '../scheduler'

const calculator = createScheduleCalculator()

function makeAutomation(overrides: Partial<AutomationDefinition> = {}): AutomationDefinition {
  const now = Date.now()
  return {
    id: 'a1',
    name: 'Nightly report',
    projectId: 'p1',
    prompt: 'Summarize today',
    executorKind: 'codex',
    accountId: null,
    schedule: { kind: 'daily', localTime: '09:00', timeZone: 'UTC' },
    timeZone: 'UTC',
    enabled: true,
    worktreeMode: 'isolated',
    permissionProfile: 'observe',
    networkPolicy: 'optional',
    timeoutMs: 60_000,
    maxRetries: 1,
    nextRunAt: null,
    pendingCatchUp: false,
    pendingScheduledFor: null,
    createdAt: now,
    updatedAt: now,
    ...overrides
  }
}

class InMemoryRepository implements AutomationSchedulerRepository {
  private readonly automations = new Map<string, AutomationDefinition>()
  private readonly activeRuns = new Set<string>()
  private readonly claimedSlots = new Set<string>()
  readonly claimedRuns: Array<{ automationId: string; scheduledFor: number; trigger: string }> = []

  add(automation: AutomationDefinition): void {
    this.automations.set(automation.id, automation)
  }

  get(id: string): AutomationDefinition | undefined {
    return this.automations.get(id)
  }

  setActive(id: string, active: boolean): void {
    if (active) this.activeRuns.add(id)
    else this.activeRuns.delete(id)
  }

  listEnabled(): AutomationDefinition[] {
    return [...this.automations.values()].filter((a) => a.enabled)
  }

  setNextRunAt(automationId: string, nextRunAt: number | null): void {
    const automation = this.automations.get(automationId)
    if (!automation) return
    this.automations.set(automationId, { ...automation, nextRunAt })
  }

  markCatchUpPending(automationId: string, scheduledFor: number): void {
    const automation = this.automations.get(automationId)
    if (!automation) return
    this.automations.set(automationId, {
      ...automation,
      pendingCatchUp: true,
      pendingScheduledFor: scheduledFor
    })
  }

  clearCatchUp(automationId: string): void {
    const automation = this.automations.get(automationId)
    if (!automation) return
    this.automations.set(automationId, {
      ...automation,
      pendingCatchUp: false,
      pendingScheduledFor: null
    })
  }

  hasActiveRun(automationId: string): boolean {
    return this.activeRuns.has(automationId)
  }

  claimRun(automationId: string, scheduledFor: number, trigger: 'catch-up' | 'scheduled'): boolean {
    const slotKey = `${automationId}:${scheduledFor}`
    if (this.claimedSlots.has(slotKey)) return false
    this.claimedSlots.add(slotKey)
    this.claimedRuns.push({ automationId, scheduledFor, trigger })
    return true
  }
}

describe('reconcileOnce — coalesce-one', () => {
  it('collapses five missed daily occurrences into exactly one catch-up run', () => {
    const repo = new InMemoryRepository()
    const dailyNineAm: AutomationSchedule = { kind: 'daily', localTime: '09:00', timeZone: 'UTC' }
    // Last successful reconcile was Monday 08:00 (before that day's 09:00 run).
    const lastRan = Date.parse('2026-09-07T08:00:00Z') // Monday
    repo.add(
      makeAutomation({
        schedule: dailyNineAm,
        nextRunAt: Date.parse('2026-09-07T09:00:00Z')
      })
    )

    // App comes back Thursday 14:00 — Mon/Tue/Wed/Thu occurrences were all missed.
    const restart = Date.parse('2026-09-10T14:00:00Z')
    const result = reconcileOnce(repo, calculator, restart)

    expect(result.claimedRunAutomationIds).toEqual(['a1'])
    expect(repo.claimedRuns).toHaveLength(1)
    expect(repo.claimedRuns[0].scheduledFor).toBe(Date.parse('2026-09-10T09:00:00Z'))

    const automation = repo.get('a1')
    expect(automation?.pendingCatchUp).toBe(false)
    expect(automation?.nextRunAt).toBe(Date.parse('2026-09-11T09:00:00Z'))
    void lastRan
  })

  it('is idempotent when reconciled repeatedly for the same instant', () => {
    const repo = new InMemoryRepository()
    repo.add(
      makeAutomation({
        nextRunAt: Date.parse('2026-09-07T09:00:00Z')
      })
    )

    const now = Date.parse('2026-09-10T14:00:00Z')
    const first = reconcileOnce(repo, calculator, now)
    const second = reconcileOnce(repo, calculator, now)
    const third = reconcileOnce(repo, calculator, now + 5_000)

    expect(first.claimedRunAutomationIds).toEqual(['a1'])
    expect(second.claimedRunAutomationIds).toEqual([])
    expect(third.claimedRunAutomationIds).toEqual([])
    expect(repo.claimedRuns).toHaveLength(1)
  })

  it('replaces the pending marker with the latest slot while the automation is active, then runs once after it finishes', () => {
    const repo = new InMemoryRepository()
    repo.add(makeAutomation({ nextRunAt: Date.parse('2026-09-07T09:00:00Z') }))
    repo.setActive('a1', true)

    const day1 = Date.parse('2026-09-08T10:00:00Z')
    reconcileOnce(repo, calculator, day1)
    expect(repo.get('a1')?.pendingScheduledFor).toBe(Date.parse('2026-09-08T09:00:00Z'))
    expect(repo.claimedRuns).toHaveLength(0) // active run blocks the claim

    const day2 = Date.parse('2026-09-09T10:00:00Z')
    reconcileOnce(repo, calculator, day2)
    expect(repo.get('a1')?.pendingScheduledFor).toBe(Date.parse('2026-09-09T09:00:00Z'))
    expect(repo.claimedRuns).toHaveLength(0)

    repo.setActive('a1', false)
    const day3 = Date.parse('2026-09-09T10:00:01Z')
    const result = reconcileOnce(repo, calculator, day3)
    expect(result.claimedRunAutomationIds).toEqual(['a1'])
    expect(repo.claimedRuns).toHaveLength(1)
    expect(repo.claimedRuns[0].scheduledFor).toBe(Date.parse('2026-09-09T09:00:00Z'))
  })

  it('does not accumulate catch-up while disabled, and does not backfill once re-enabled', () => {
    const repo = new InMemoryRepository()
    repo.add(
      makeAutomation({
        enabled: false,
        nextRunAt: Date.parse('2026-09-07T09:00:00Z')
      })
    )

    const now = Date.parse('2026-09-10T14:00:00Z')
    reconcileOnce(repo, calculator, now)
    expect(repo.claimedRuns).toHaveLength(0)

    const automation = repo.get('a1')
    if (!automation) throw new Error('missing automation')
    repo.add({ ...automation, enabled: true, nextRunAt: calculator.nextOccurrenceAfter(automation.schedule, now) })

    const result = reconcileOnce(repo, calculator, now + 1_000)
    expect(result.claimedRunAutomationIds).toEqual([])
    expect(repo.claimedRuns).toHaveLength(0)
  })

  it('defers connectivity-gated automations without creating a new marker each tick', () => {
    const repo = new InMemoryRepository()
    repo.add(makeAutomation({ nextRunAt: Date.parse('2026-09-07T09:00:00Z') }))
    const offline = { canRun: () => false }

    const now = Date.parse('2026-09-08T10:00:00Z')
    reconcileOnce(repo, calculator, now, offline)
    reconcileOnce(repo, calculator, now + 60_000, offline)
    reconcileOnce(repo, calculator, now + 120_000, offline)

    expect(repo.claimedRuns).toHaveLength(0)
    expect(repo.get('a1')?.pendingCatchUp).toBe(true)
    expect(repo.get('a1')?.pendingScheduledFor).toBe(Date.parse('2026-09-08T09:00:00Z'))

    const online = { canRun: () => true }
    const result = reconcileOnce(repo, calculator, now + 180_000, online)
    expect(result.claimedRunAutomationIds).toEqual(['a1'])
    expect(repo.claimedRuns).toHaveLength(1)
  })

  it('does not duplicate a slot across a backward clock jump', () => {
    const repo = new InMemoryRepository()
    repo.add(makeAutomation({ nextRunAt: Date.parse('2026-09-07T09:00:00Z') }))

    const afterClockMovedForward = Date.parse('2026-09-08T10:00:00Z')
    reconcileOnce(repo, calculator, afterClockMovedForward)
    expect(repo.claimedRuns).toHaveLength(1)

    // Clock rolls back a few minutes (e.g. NTP correction) but stays within the same slot window.
    const rolledBack = afterClockMovedForward - 5 * 60_000
    const result = reconcileOnce(repo, calculator, rolledBack)
    expect(result.claimedRunAutomationIds).toEqual([])
    expect(repo.claimedRuns).toHaveLength(1)
  })
})
