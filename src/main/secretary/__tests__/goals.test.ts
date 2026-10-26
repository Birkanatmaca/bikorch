import initSqlJs, { type Database } from 'sql.js'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const holder = vi.hoisted(() => ({ db: null as Database | null }))
vi.mock('../../persistence/database', () => ({
  getPersistenceDatabase: () => holder.db,
  schedulePersistToDisk: () => undefined
}))
import { activateGoalForRun, createGoalDraft, goalForRun, linkRunToGoal, resetGoalSchemaForTests, updateGoal } from '../goals'
import { decideGoalRound, goalNotice, readCriteria } from '../goal-round'

beforeEach(async () => {
  const SQL = await initSqlJs()
  holder.db = new SQL.Database()
  resetGoalSchemaForTests()
})

describe('goal storage', () => {
  it('drafts a goal for the first run and starts it on approval', () => {
    const draft = createGoalDraft({
      threadId: 'thread-1', projectId: 'project-1', runId: 'run-1',
      objective: 'Calculator supports division', criteria: ['divide exists', 'tests pass'], verifyCommands: ['npm test']
    })
    expect(draft).toMatchObject({ status: 'draft', round: 1, maxRounds: 4 })
    expect(goalForRun('run-1')?.id).toBe(draft.id)
    expect(activateGoalForRun('run-1')?.status).toBe('active')

    linkRunToGoal('run-2', draft.id, 2)
    updateGoal(draft.id, { round: 2, summary: 'round two' })
    expect(goalForRun('run-2')).toMatchObject({ round: 2, summary: 'round two', status: 'active' })
  })
})

describe('decideGoalRound', () => {
  const goal = { round: 1, maxRounds: 3 }
  const pass = [{ command: 'npm test', cwd: '/w', exitCode: 0, output: 'ok', durationMs: 5 }]
  const fail = [{ command: 'npm test', cwd: '/w', exitCode: 1, output: 'AssertionError', durationMs: 5 }]

  it('accepts "met" only when every check passed', () => {
    expect(decideGoalRound({ goal, modelStatus: 'met', verification: pass, hasNextPlan: false }).status).toBe('met')
    expect(decideGoalRound({ goal, modelStatus: 'met', verification: fail, hasNextPlan: true }).status).toBe('active')
  })

  it('continues while rounds remain and stops at the limit', () => {
    expect(decideGoalRound({ goal, modelStatus: 'continue', verification: fail, hasNextPlan: true }).status).toBe('active')
    expect(decideGoalRound({ goal: { round: 3, maxRounds: 3 }, modelStatus: 'continue', verification: fail, hasNextPlan: true }).status).toBe('exhausted')
  })

  it('pauses when blocked or when there is no next step', () => {
    expect(decideGoalRound({ goal, modelStatus: 'blocked', verification: pass, hasNextPlan: true }).status).toBe('blocked')
    expect(decideGoalRound({ goal, modelStatus: 'continue', verification: fail, hasNextPlan: false }).status).toBe('blocked')
  })
})

describe('goal notices', () => {
  it('shows a checklist with the checks Bikorch ran', () => {
    const criteria = readCriteria([{ criterion: 'divide exists', met: true, evidence: 'calc.js:14' }, { criterion: 'tests pass', met: true, evidence: 'exit 0' }], ['divide exists', 'tests pass'])
    const notice = goalNotice({
      goal: { objective: 'Calculator supports division', round: 2, maxRounds: 4 },
      decision: { status: 'met', reason: '' },
      criteria,
      verification: [{ command: 'npm test', cwd: '/w', exitCode: 0, output: 'ok', durationMs: 5 }],
      summary: '',
      modelNotice: { headline: '', highlights: [] }
    })
    expect(notice.headline).toBe('Goal done: Calculator supports division')
    expect(notice.highlights).toEqual(['✓ divide exists', '✓ tests pass', '✓ npm test → exit 0'])
  })
})
