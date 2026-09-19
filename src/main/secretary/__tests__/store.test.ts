import initSqlJs, { type Database } from 'sql.js'
import { beforeEach, describe, expect, it } from 'vitest'
import type { SecretaryPlan } from '@shared/contracts/secretary'
import { SqlSecretaryStore, initSecretarySchema, isValidSecretaryRunTransition } from '../store'

const PLAN: SecretaryPlan = {
  overview: 'Review the authentication flow.',
  assumptions: ['The workspace is isolated.'],
  assignments: [{
    id: 'assignment-1',
    panelId: null,
    kind: 'codex',
    title: 'Review auth',
    instruction: 'Review auth and report the highest-risk issues.',
    rationale: 'The task needs a code review.',
    usageNote: 'Use the available account.',
    dependsOn: []
  }],
  approvalRequired: true
}

describe('Secretary SQL store', () => {
  let db: Database
  let store: SqlSecretaryStore

  beforeEach(async () => {
    const SQL = await initSqlJs()
    db = new SQL.Database()
    db.run('CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
    initSecretarySchema(db)
    store = new SqlSecretaryStore(db)
  })

  it('allows only explicit run lifecycle transitions', () => {
    expect(isValidSecretaryRunTransition('planning', 'awaiting-approval')).toBe(true)
    expect(isValidSecretaryRunTransition('awaiting-approval', 'approved')).toBe(true)
    expect(isValidSecretaryRunTransition('approved', 'running')).toBe(true)
    expect(isValidSecretaryRunTransition('running', 'needs-user')).toBe(true)
    expect(isValidSecretaryRunTransition('needs-user', 'running')).toBe(true)
    expect(isValidSecretaryRunTransition('completed', 'running')).toBe(false)
    expect(isValidSecretaryRunTransition('rejected', 'approved')).toBe(false)
  })

  it('persists a project-bound plan and its approval decision', () => {
    const thread = store.createThread({ projectId: 'project-1234', title: 'Auth review' })
    const run = store.createRun({
      threadId: thread.id,
      projectId: 'project-1234',
      requestText: 'Review auth with sk-proj-this-must-not-be-stored-1234567890'
    })

    const saved = store.updateRun(run.id, {
      status: 'awaiting-approval',
      reply: 'I prepared a plan.',
      plan: PLAN,
      openKinds: ['codex']
    })

    expect(saved).toMatchObject({
      id: run.id,
      projectId: 'project-1234',
      status: 'awaiting-approval',
      plan: PLAN,
      planRevision: 1,
      openKinds: ['codex']
    })
    expect(saved?.requestText).toContain('[REDACTED]')

    const approved = store.decidePlan(run.id, 'approved')
    expect(approved?.status).toBe('approved')
    expect(store.listThreads('project-1234')).toEqual([thread])
    expect(store.listRuns('project-1234')).toHaveLength(1)
    expect(db.exec('SELECT * FROM secretary_assignments')[0]?.values).toHaveLength(1)
    expect(db.exec('SELECT * FROM secretary_approvals')[0]?.values).toHaveLength(1)
  })

  it('increments the persisted revision whenever an awaiting plan is changed', () => {
    const thread = store.createThread({ projectId: 'project-1234', title: 'Revision' })
    const run = store.createRun({ threadId: thread.id, projectId: thread.projectId, requestText: 'Review auth' })
    const initial = store.updateRun(run.id, { status: 'awaiting-approval', plan: PLAN })
    const revised = store.updateRun(run.id, {
      plan: {
        ...PLAN,
        overview: 'Review the revised authentication flow.',
        assignments: [{ ...PLAN.assignments[0]!, instruction: 'Review the revised authentication flow and report risks.' }]
      }
    })

    expect(initial?.planRevision).toBe(1)
    expect(revised).toMatchObject({ planRevision: 2, status: 'awaiting-approval' })
    expect(store.getRun(run.id)?.plan?.overview).toContain('revised')
  })

  it('round-trips dependency edges in persisted plans', () => {
    const thread = store.createThread({ projectId: 'project-1234', title: 'Dependencies' })
    const run = store.createRun({ threadId: thread.id, projectId: thread.projectId, requestText: 'Review then implement' })
    const plan: SecretaryPlan = {
      ...PLAN,
      assignments: [
        { ...PLAN.assignments[0]!, id: 'assignment-1' },
        {
          ...PLAN.assignments[0]!,
          id: 'assignment-2',
          kind: 'cursor',
          title: 'Implement fixes',
          dependsOn: ['assignment-1']
        }
      ]
    }

    store.updateRun(run.id, { status: 'awaiting-approval', plan })

    expect(store.getRun(run.id)?.plan?.assignments[1]?.dependsOn).toEqual(['assignment-1'])
  })

  it('keeps an awaiting plan after restart recovery but interrupts active work', () => {
    const thread = store.createThread({ projectId: 'project-1234', title: 'Recovery' })
    const planning = store.createRun({ threadId: thread.id, projectId: thread.projectId, requestText: 'Plan work' })
    const awaiting = store.createRun({ threadId: thread.id, projectId: thread.projectId, requestText: 'Wait for approval' })
    store.updateRun(awaiting.id, { status: 'awaiting-approval', plan: PLAN })

    expect(store.markStaleRunsInterrupted()).toBe(1)
    expect(store.getRun(planning.id)?.status).toBe('interrupted')
    expect(store.getRun(awaiting.id)?.status).toBe('awaiting-approval')
  })

  it('retains pending work while removing expired terminal history', () => {
    const thread = store.createThread({ projectId: 'project-1234', title: 'Retention' })
    const completed = store.createRun({ threadId: thread.id, projectId: thread.projectId, requestText: 'Old completed work' })
    store.updateRun(completed.id, { status: 'awaiting-approval', plan: PLAN })
    store.decidePlan(completed.id, 'rejected')
    const pending = store.createRun({ threadId: thread.id, projectId: thread.projectId, requestText: 'Keep this approval' })
    store.updateRun(pending.id, { status: 'awaiting-approval', plan: PLAN })
    db.run('UPDATE secretary_runs SET updated_at = 1 WHERE id = ?', [completed.id])
    db.run('UPDATE secretary_messages SET created_at = 1 WHERE run_id = ?', [completed.id])

    const result = store.deleteExpired(Date.now() - 1_000)

    expect(result.runs).toBe(1)
    expect(store.getRun(completed.id)).toBeNull()
    expect(store.getRun(pending.id)?.status).toBe('awaiting-approval')
    expect(db.exec('SELECT * FROM secretary_assignments WHERE run_id = ?', [completed.id])[0]?.values ?? []).toHaveLength(0)
  })
})
