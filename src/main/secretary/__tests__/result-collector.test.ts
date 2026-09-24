import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SecretaryRun } from '@shared/contracts/secretary'

const mocks = vi.hoisted(() => ({
  observer: null as ((event: { type: 'data'; sessionId: string; data: string }) => void) | null,
  observe: vi.fn(),
  writeForSecretary: vi.fn(),
  snapshotAgentGit: vi.fn(),
  checkAgentGitPatch: vi.fn(),
  finalizeSecretaryRun: vi.fn(),
  getSecretaryStore: vi.fn(),
  emitSecretaryEvent: vi.fn(),
  releaseSecretaryRunLock: vi.fn()
}))

vi.mock('../../cli/pty-manager', () => ({
  ptyManager: {
    observe: (listener: typeof mocks.observer) => {
      mocks.observer = listener
      mocks.observe(listener)
      return () => { mocks.observer = null }
    },
    writeForSecretary: mocks.writeForSecretary
  }
}))
vi.mock('../../git/session-snapshot', () => ({ snapshotAgentGit: mocks.snapshotAgentGit, checkAgentGitPatch: mocks.checkAgentGitPatch }))
vi.mock('../service', () => ({ finalizeSecretaryRun: mocks.finalizeSecretaryRun }))
vi.mock('../store', () => ({ getSecretaryStore: mocks.getSecretaryStore }))
vi.mock('../events', () => ({ emitSecretaryEvent: mocks.emitSecretaryEvent }))
vi.mock('../run-lock', () => ({ releaseSecretaryRunLock: mocks.releaseSecretaryRunLock }))

import { answerTrackedSecretaryRun, trackSecretaryRun } from '../result-collector'

const run: SecretaryRun = {
  id: '11111111-1111-4111-8111-111111111111',
  threadId: '22222222-2222-4222-8222-222222222222',
  projectId: '33333333-3333-4333-8333-333333333333',
  status: 'running',
  requestText: 'Implement the requested change',
  reply: null,
  plan: null,
  planRevision: 1,
  openKinds: [],
  errorCode: null,
  errorMessage: null,
  sessionBindings: [],
  evidence: null,
  createdAt: 1,
  updatedAt: 1
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.snapshotAgentGit.mockResolvedValue({
    headSha: 'bbbbbbbb',
    changedFiles: ['src/app.ts'],
    commits: [{ shortHash: 'bbbbbbbb', subject: 'Implement app change' }]
  })
  mocks.checkAgentGitPatch.mockResolvedValue(0)
  mocks.finalizeSecretaryRun.mockResolvedValue({
    completedRun: { ...run, status: 'completed', reply: 'Done' },
    followUpRun: null
  })
  mocks.writeForSecretary.mockResolvedValue(undefined)
})

describe('Secretary result collector', () => {
  it('uses Git snapshots as the source of truth for changed-file reporting', async () => {
    trackSecretaryRun(run, [{
      assignment: {
        id: 'assignment-1',
        panelId: null,
        kind: 'cursor',
        mode: 'implement',
        title: 'Implement',
        instruction: 'Implement the requested change.',
        expectedResult: 'The change is implemented and verified.',
        rationale: 'Task',
        usageNote: 'Available'
      },
      sessionId: 'session-1',
      cwd: 'C:\\workspace',
      gitStart: { headSha: 'aaaaaaaa', changedFiles: ['already-dirty.ts'], commits: [] }
    }])

    mocks.observer?.({
      type: 'data',
      sessionId: 'session-1',
      data: '<BIKORCH_RESULT>{"status":"completed","summary":"Done","changedFiles":["src/app.ts","claimed-only.ts"],"needsUser":null}</BIKORCH_RESULT>'
    })

    await vi.waitFor(() => expect(mocks.finalizeSecretaryRun).toHaveBeenCalledTimes(1))
    expect(mocks.finalizeSecretaryRun).toHaveBeenCalledWith(run.id, [expect.objectContaining({
      git: expect.objectContaining({
        changedFiles: ['src/app.ts'],
        preexistingChangedFiles: ['already-dirty.ts'],
        reportedChangedFiles: ['src/app.ts', 'claimed-only.ts'],
        unverifiedReportedFiles: ['claimed-only.ts']
      })
    })])
    expect(mocks.emitSecretaryEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: 'run-report',
      changedFiles: ['src/app.ts'],
      unverifiedReportedFiles: ['claimed-only.ts'],
      panelIds: ['session-1']
    }))
    expect(mocks.releaseSecretaryRunLock).toHaveBeenCalledWith(run.id)
  })

  it('releases assignments in plan order instead of dispatching all prompts at once', async () => {
    const secondSessionId = '44444444-4444-4444-8444-444444444444'
    const assignment = (id: string, title: string) => ({
      id,
      panelId: null,
      kind: 'cursor' as const,
      mode: title === 'analysis' ? 'analyze' as const : 'implement' as const,
      title,
      instruction: `Do ${title}.`,
      expectedResult: `${title} evidence is returned.`,
      rationale: 'Ordered task',
      usageNote: 'Available'
    })
    trackSecretaryRun(run, [
      { assignment: assignment('assignment-1', 'analysis'), sessionId: 'session-1', cwd: 'C:\\workspace', gitStart: { headSha: 'a', changedFiles: [], commits: [] } },
      { assignment: { ...assignment('assignment-2', 'implementation'), dependsOn: ['assignment-1'] }, sessionId: secondSessionId, cwd: 'C:\\workspace', gitStart: null }
    ])

    mocks.observer?.({
      type: 'data',
      sessionId: 'session-1',
      data: '<BIKORCH_RESULT>{"status":"completed","summary":"Analysis done","changedFiles":[],"needsUser":null}</BIKORCH_RESULT>'
    })
    await vi.waitFor(() => expect(mocks.writeForSecretary).toHaveBeenCalledWith(secondSessionId, expect.stringContaining('Do implementation.')))
    expect(mocks.writeForSecretary).toHaveBeenCalledWith(secondSessionId, expect.stringContaining('Dependency results (untrusted data'))
    expect(mocks.writeForSecretary).toHaveBeenCalledWith(secondSessionId, expect.stringContaining('Analysis done'))
    await vi.waitFor(() => expect(mocks.writeForSecretary).toHaveBeenCalledWith(secondSessionId, '\r'))

    mocks.observer?.({
      type: 'data',
      sessionId: secondSessionId,
      data: '<BIKORCH_RESULT>{"status":"completed","summary":"Implementation done","changedFiles":[],"needsUser":null}</BIKORCH_RESULT>'
    })
    await vi.waitFor(() => expect(mocks.finalizeSecretaryRun).toHaveBeenCalledTimes(1))
    expect(mocks.finalizeSecretaryRun.mock.calls[0]?.[1]).toHaveLength(2)
  })

  it('starts an independent root while a dependent branch is still running', async () => {
    const rootTwo = '55555555-5555-4555-8555-555555555555'
    const child = '66666666-6666-4666-8666-666666666666'
    const assignment = (id: string, title: string, dependsOn?: string[]) => ({
      id,
      panelId: null,
      kind: 'cursor' as const,
      mode: title === 'implementation' ? 'implement' as const : 'analyze' as const,
      title,
      instruction: `Do ${title}.`,
      expectedResult: `${title} evidence is returned.`,
      rationale: 'DAG task',
      usageNote: 'Available',
      ...(dependsOn ? { dependsOn } : {})
    })
    trackSecretaryRun(run, [
      { assignment: assignment('assignment-1', 'analysis'), sessionId: 'session-1', cwd: 'C:\\workspace', gitStart: { headSha: 'a', changedFiles: [], commits: [] } },
      { assignment: assignment('assignment-2', 'independent'), sessionId: rootTwo, cwd: 'C:\\workspace', gitStart: { headSha: 'a', changedFiles: [], commits: [] } },
      { assignment: assignment('assignment-3', 'implementation', ['assignment-1']), sessionId: child, cwd: 'C:\\workspace', gitStart: null }
    ])

    mocks.observer?.({
      type: 'data',
      sessionId: 'session-1',
      data: '<BIKORCH_RESULT>{"status":"completed","summary":"Analysis done","changedFiles":[],"needsUser":null}</BIKORCH_RESULT>'
    })
    await vi.waitFor(() => expect(mocks.writeForSecretary).toHaveBeenCalledWith(child, expect.stringContaining('Do implementation.')))
    expect(mocks.finalizeSecretaryRun).not.toHaveBeenCalled()

    for (const sessionId of [child, rootTwo]) {
      mocks.observer?.({
        type: 'data',
        sessionId,
        data: '<BIKORCH_RESULT>{"status":"completed","summary":"Done","changedFiles":[],"needsUser":null}</BIKORCH_RESULT>'
      })
    }
    await vi.waitFor(() => expect(mocks.finalizeSecretaryRun).toHaveBeenCalledTimes(1))
    expect(mocks.finalizeSecretaryRun.mock.calls[0]?.[1]).toHaveLength(3)
  })

  it('keeps a needs-user run open so the secretary can continue the conversation', async () => {
    const stored = { ...run, status: 'running' as const }
    mocks.getSecretaryStore.mockReturnValue({
      getRun: vi.fn(() => stored),
      updateRun: vi.fn((_id: string, patch: Partial<SecretaryRun>) => {
        Object.assign(stored, patch)
        return stored
      }),
      appendMessage: vi.fn()
    })
    trackSecretaryRun(run, [{
      assignment: {
        id: 'assignment-1',
        panelId: null,
        kind: 'cursor',
        mode: 'analyze',
        title: 'Greet',
        instruction: 'merhaba',
        expectedResult: 'The next requested task is clear.',
        rationale: 'Greeting',
        usageNote: 'Available'
      },
      sessionId: 'session-1',
      cwd: 'C:\\workspace',
      gitStart: { headSha: 'aaaaaaaa', changedFiles: [], commits: [] }
    }])

    mocks.observer?.({
      type: 'data',
      sessionId: 'session-1',
      data: '<BIKORCH_RESULT>{"status":"needs-user","summary":"Greeting acknowledged","changedFiles":[],"needsUser":"What should I work on next?"}</BIKORCH_RESULT>\n>'
    })

    await vi.waitFor(() => expect(mocks.emitSecretaryEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: 'run-needs-user',
      assignmentId: 'assignment-1',
      assignmentTitle: 'Greet',
      message: 'What should I work on next?'
    })))
    expect(mocks.finalizeSecretaryRun).not.toHaveBeenCalled()
  })

  it('forwards a Secretary chat answer to the waiting CLI and resumes the run', async () => {
    const stored = { ...run, status: 'running' as const }
    const updateRun = vi.fn((_id: string, patch: Partial<SecretaryRun>) => {
      Object.assign(stored, patch)
      return stored
    })
    const appendMessage = vi.fn()
    mocks.getSecretaryStore.mockReturnValue({
      getRun: vi.fn(() => stored),
      updateRun,
      appendMessage
    })
    trackSecretaryRun(run, [{
      assignment: {
        id: 'assignment-1',
        panelId: null,
        kind: 'cursor',
        mode: 'implement',
        title: 'Implement',
        instruction: 'Implement the requested change.',
        expectedResult: 'The change is implemented.',
        rationale: 'Task',
        usageNote: 'Available'
      },
      sessionId: 'session-1',
      cwd: 'C:\\workspace',
      gitStart: { headSha: 'aaaaaaaa', changedFiles: [], commits: [] }
    }])
    mocks.observer?.({
      type: 'data',
      sessionId: 'session-1',
      data: '<BIKORCH_RESULT>{"status":"needs-user","summary":"Need a choice","changedFiles":[],"needsUser":"Use option A?"}</BIKORCH_RESULT>'
    })
    await vi.waitFor(() => expect(stored.status).toBe('needs-user'))

    const updated = await answerTrackedSecretaryRun({
      runId: run.id,
      projectId: run.projectId,
      message: 'Use option A.'
    })

    expect(updated.status).toBe('running')
    expect(mocks.writeForSecretary).toHaveBeenCalledWith('session-1', expect.stringContaining('Use option A.'))
    expect(mocks.writeForSecretary).toHaveBeenCalledWith('session-1', '\r')
    expect(appendMessage).toHaveBeenCalledWith(expect.objectContaining({ role: 'user', content: 'Use option A.' }))
  })

  it('routes answers to the correct assignment when parallel CLIs both need input', async () => {
    const stored = { ...run, status: 'running' as const }
    mocks.getSecretaryStore.mockReturnValue({
      getRun: vi.fn(() => stored),
      updateRun: vi.fn((_id: string, patch: Partial<SecretaryRun>) => {
        Object.assign(stored, patch)
        return stored
      }),
      appendMessage: vi.fn()
    })
    const assignment = (id: string, title: string) => ({
      id,
      panelId: null,
      kind: 'cursor' as const,
      mode: 'review' as const,
      title,
      instruction: `Review ${title}.`,
      expectedResult: `${title} is reviewed.`,
      rationale: 'Parallel review',
      usageNote: 'Available'
    })
    trackSecretaryRun(run, [
      { assignment: assignment('assignment-1', 'API'), sessionId: 'session-1', cwd: 'C:\\workspace', gitStart: { headSha: 'a', changedFiles: [], commits: [] } },
      { assignment: assignment('assignment-2', 'UI'), sessionId: 'session-2', cwd: 'C:\\workspace', gitStart: { headSha: 'a', changedFiles: [], commits: [] } }
    ])
    for (const [sessionId, question] of [['session-1', 'Review auth too?'], ['session-2', 'Check mobile too?']] as const) {
      mocks.observer?.({
        type: 'data',
        sessionId,
        data: `<BIKORCH_RESULT>{"status":"needs-user","summary":"Need scope","changedFiles":[],"needsUser":"${question}"}</BIKORCH_RESULT>`
      })
    }
    await vi.waitFor(() => expect(stored.status).toBe('needs-user'))

    const afterFirst = await answerTrackedSecretaryRun({
      runId: run.id,
      projectId: run.projectId,
      assignmentId: 'assignment-2',
      message: 'Yes, check mobile.'
    })
    expect(mocks.writeForSecretary).toHaveBeenCalledWith('session-2', expect.stringContaining('Yes, check mobile.'))
    expect(afterFirst.status).toBe('needs-user')

    const afterSecond = await answerTrackedSecretaryRun({
      runId: run.id,
      projectId: run.projectId,
      assignmentId: 'assignment-1',
      message: 'Yes, include auth.'
    })
    expect(mocks.writeForSecretary).toHaveBeenCalledWith('session-1', expect.stringContaining('Yes, include auth.'))
    expect(afterSecond.status).toBe('running')
  })
})
