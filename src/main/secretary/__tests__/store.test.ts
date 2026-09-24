import initSqlJs, { type Database } from 'sql.js'
import { beforeEach, describe, expect, it } from 'vitest'
import type { SecretaryPlan } from '@shared/contracts/secretary'
import { SqlSecretaryStore, initSecretarySchema, isValidSecretaryRunTransition, messagesToChatTurns } from '../store'

const PLAN: SecretaryPlan = {
  overview: 'Review the authentication flow.',
  assumptions: ['The workspace is isolated.'],
  assignments: [{
    id: 'assignment-1',
    panelId: null,
    kind: 'codex',
    mode: 'review',
    title: 'Review auth',
    instruction: 'Review auth and report the highest-risk issues.',
    expectedResult: 'An evidence-based list of the highest-risk issues.',
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
    expect(store.listRunsByIds(thread.id, [run.id, run.id])).toHaveLength(1)
    expect(db.exec('SELECT * FROM secretary_assignments')[0]?.values).toHaveLength(1)
    expect(db.exec('SELECT * FROM secretary_approvals')[0]?.values).toHaveLength(1)
  })

  it('persists a redacted thread summary across store instances', () => {
    const thread = store.createThread({ projectId: 'project-1234', title: 'Continuity' })
    store.setThreadContextSummary(thread.id, 'Keep sessions. Key: sk-proj-this-must-not-be-stored-1234567890')
    const restored = new SqlSecretaryStore(db).getThreadContextSummary(thread.id)
    expect(restored).toContain('Keep sessions.')
    expect(restored).not.toContain('sk-proj-this-must-not-be-stored-1234567890')
  })

  it('adds continuity storage when opening an existing Secretary database', async () => {
    const SQL = await initSqlJs()
    const legacy = new SQL.Database()
    legacy.run('CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
    legacy.run('CREATE TABLE secretary_threads (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, title TEXT NOT NULL, status TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)')
    initSecretarySchema(legacy)
    const upgraded = new SqlSecretaryStore(legacy)
    const thread = upgraded.createThread({ projectId: 'project-1234', title: 'Older chat' })
    upgraded.setThreadContextSummary(thread.id, 'Keep the project history.')
    expect(upgraded.getThreadContextSummary(thread.id)).toBe('Keep the project history.')
    legacy.close()
  })

  it('upgrades existing run rows with evidence and recovery columns', async () => {
    const SQL = await initSqlJs()
    const legacy = new SQL.Database()
    legacy.run('CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
    legacy.run(`CREATE TABLE secretary_runs (
      id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, project_id TEXT NOT NULL,
      status TEXT NOT NULL, request_text TEXT NOT NULL, reply TEXT, plan_json TEXT,
      open_kinds_json TEXT NOT NULL DEFAULT '[]', error_code TEXT, error_message TEXT,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    )`)
    legacy.run("INSERT INTO secretary_runs (id, thread_id, project_id, status, request_text, created_at, updated_at) VALUES ('run-12345678', 'thread-12345678', 'project-1234', 'completed', 'Old result', 1, 1)")
    initSecretarySchema(legacy)
    const restored = new SqlSecretaryStore(legacy).getRun('run-12345678')
    expect(restored?.status).toBe('completed')
    expect(restored?.sessionBindings).toEqual([])
    expect(restored?.evidence).toBeNull()
    legacy.close()
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

  it('persists assignment routing metadata for CLI questions and answers', () => {
    const thread = store.createThread({ projectId: 'project-1234', title: 'CLI question' })
    const message = store.appendMessage({
      threadId: thread.id,
      runId: 'run-12345678',
      assignmentId: 'assignment-2',
      role: 'assistant',
      type: 'needs-user',
      content: 'Which implementation should I use?'
    })

    expect(message.assignmentId).toBe('assignment-2')
    expect(store.listMessages(thread.id)[0]?.assignmentId).toBe('assignment-2')
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

  it('persists recovery bindings and result evidence across store instances', () => {
    const thread = store.createThread({ projectId: 'project-1234', title: 'Durable outcome' })
    const run = store.createRun({ threadId: thread.id, projectId: thread.projectId, requestText: 'Implement change' })
    store.updateRun(run.id, { status: 'awaiting-approval', plan: PLAN })
    store.decidePlan(run.id, 'approved')
    store.updateRun(run.id, {
      status: 'running',
      sessionBindings: [{ assignmentId: 'assignment-1', sessionId: 'panel-1234', accountId: 'account-1234' }]
    })
    expect(new SqlSecretaryStore(db).markStaleRunsInterrupted()).toBe(1)
    const interrupted = new SqlSecretaryStore(db).getRun(run.id)
    expect(interrupted?.sessionBindings).toEqual([{ assignmentId: 'assignment-1', sessionId: 'panel-1234', accountId: 'account-1234' }])
    expect(interrupted?.status).toBe('interrupted')

    const second = store.createRun({ threadId: thread.id, projectId: thread.projectId, requestText: 'Review change' })
    const evidence = {
      capturedAt: 123,
      verificationLevel: 'cli-reported' as const,
      changedFiles: [],
      unverifiedReportedFiles: [],
      assignments: []
    }
    store.updateRun(second.id, { status: 'completed', evidence })
    expect(new SqlSecretaryStore(db).getRun(second.id)?.evidence).toEqual(evidence)
  })

  it('keeps old conversation and run history while pruning duplicate terminal metadata', () => {
    const thread = store.createThread({ projectId: 'project-1234', title: 'Retention' })
    const completed = store.createRun({ threadId: thread.id, projectId: thread.projectId, requestText: 'Old completed work' })
    store.updateRun(completed.id, { status: 'awaiting-approval', plan: PLAN })
    store.decidePlan(completed.id, 'rejected')
    const oldMessage = store.appendMessage({ threadId: thread.id, runId: completed.id, role: 'assistant', type: 'final-report', content: 'This work was rejected.' })
    const standalone = store.appendMessage({ threadId: thread.id, role: 'user', type: 'chat', content: 'Keep this older note.' })
    const pending = store.createRun({ threadId: thread.id, projectId: thread.projectId, requestText: 'Keep this approval' })
    store.updateRun(pending.id, { status: 'awaiting-approval', plan: PLAN })
    db.run('UPDATE secretary_runs SET updated_at = 1 WHERE id = ?', [completed.id])
    db.run('UPDATE secretary_messages SET created_at = 1 WHERE run_id = ?', [completed.id])
    db.run('UPDATE secretary_messages SET created_at = 1 WHERE id = ?', [standalone.id])

    const result = store.deleteExpired(Date.now() - 1_000)

    expect(result).toMatchObject({ runs: 0, messages: 0, assignments: 1, approvals: 1, threads: 0 })
    expect(store.getRun(completed.id)?.status).toBe('rejected')
    expect(store.listMessages(thread.id).some((message) => message.id === oldMessage.id)).toBe(true)
    expect(store.listMessages(thread.id).some((message) => message.id === standalone.id)).toBe(true)
    expect(store.getRun(pending.id)?.status).toBe('awaiting-approval')
    expect(db.exec('SELECT * FROM secretary_assignments WHERE run_id = ?', [completed.id])[0]?.values ?? []).toHaveLength(0)
  })

  it('pages messages with a stable cursor and includes final reports in chat context', () => {
    const thread = store.createThread({ projectId: 'project-1234', title: 'Long conversation' })
    const first = store.appendMessage({ threadId: thread.id, role: 'user', type: 'chat', content: 'Original goal' })
    const report = store.appendMessage({ threadId: thread.id, role: 'assistant', type: 'final-report', content: 'The CLI reported its result.' })
    const last = store.appendMessage({ threadId: thread.id, role: 'user', type: 'chat', content: 'Continue' })
    db.run('UPDATE secretary_messages SET created_at = 1 WHERE id = ?', [first.id])
    db.run('UPDATE secretary_messages SET created_at = 2 WHERE id = ?', [report.id])
    db.run('UPDATE secretary_messages SET created_at = 3 WHERE id = ?', [last.id])

    const latest = store.listMessages(thread.id, 2)
    expect(latest.map((message) => message.id)).toEqual([report.id, last.id])
    expect(store.listMessages(thread.id, 2, { createdAt: latest[0]!.createdAt, id: latest[0]!.id }).map((message) => message.id)).toEqual([first.id])
    expect(messagesToChatTurns(latest)).toEqual([
      { role: 'assistant', content: 'The CLI reported its result.' },
      { role: 'user', content: 'Continue' }
    ])
    expect(store.listContextMessages(thread.id, 2).map((message) => message.id)).toEqual([report.id, last.id])
  })

  it('counts follow-up runs without loading long run history', () => {
    const thread = store.createThread({ projectId: 'project-1234', title: 'Follow-ups' })
    store.createRun({ threadId: thread.id, projectId: thread.projectId, requestText: 'Original request' })
    store.createRun({ threadId: thread.id, projectId: thread.projectId, requestText: 'Follow-up requested after CLI result for: Original request' })
    expect(store.countFollowUpRuns(thread.id)).toBe(1)
  })
})
