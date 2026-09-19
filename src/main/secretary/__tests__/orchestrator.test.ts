import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getSecretaryStore: vi.fn(),
  getSessionSnapshot: vi.fn(),
  writeForSecretary: vi.fn(),
  trackSecretaryRun: vi.fn(),
  loadSnapshot: vi.fn()
}))

vi.mock('../store', () => ({ getSecretaryStore: mocks.getSecretaryStore }))
vi.mock('../../cli/pty-manager', () => ({
  ptyManager: {
    getSessionSnapshot: mocks.getSessionSnapshot,
    writeForSecretary: mocks.writeForSecretary
  }
}))
vi.mock('../result-collector', () => ({ trackSecretaryRun: mocks.trackSecretaryRun }))
vi.mock('../../persistence/database', () => ({ loadSnapshot: mocks.loadSnapshot }))

import { dispatchSecretaryRun, prepareSecretaryRun } from '../orchestrator'

const runId = '11111111-1111-4111-8111-111111111111'
const threadId = '22222222-2222-4222-8222-222222222222'
const assignmentId = 'assignment-1'
const sessionId = '33333333-3333-4333-8333-333333333333'

function approvedRun() {
  return {
    id: runId,
    threadId,
    projectId: '44444444-4444-4444-8444-444444444444',
    status: 'approved' as const,
    requestText: 'Review the work',
    reply: 'Plan ready',
    plan: {
      overview: 'Review',
      assumptions: [],
      assignments: [{
        id: assignmentId,
        panelId: null,
        kind: 'cursor' as const,
        title: 'Review',
        instruction: 'Review the current implementation.',
        rationale: 'Independent review',
        usageNote: 'Available'
      }],
      approvalRequired: true as const
    },
    openKinds: [],
    errorCode: null,
    errorMessage: null,
    planRevision: 1,
    createdAt: 1,
    updatedAt: 1
  }
}

describe('Secretary orchestrator', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.loadSnapshot.mockReturnValue({
      projects: [{ id: '44444444-4444-4444-8444-444444444444', name: 'Secretary project', folderPath: 'C:\\secretary-project' }],
      workspaces: {
        '44444444-4444-4444-8444-444444444444': {
          panels: [{ id: sessionId, type: 'cursor', title: 'Cursor', zone: 'center' }]
        }
      }
    })
  })

  it('writes only the persisted approved instruction to the compatible CLI session', async () => {
    const run = approvedRun()
    const store = {
      getRun: vi.fn()
        .mockReturnValueOnce(run)
        .mockReturnValueOnce({ ...run, status: 'running' }),
      updateRun: vi.fn().mockReturnValue({ ...run, status: 'running' }),
      appendMessage: vi.fn()
    }
    mocks.getSecretaryStore.mockReturnValue(store)
    mocks.getSessionSnapshot.mockReturnValue({
      sessionId,
      projectId: run.projectId,
      kind: 'cursor',
      cwd: 'C:\\secretary-project',
      status: 'waiting'
    })
    mocks.writeForSecretary.mockResolvedValue(undefined)

    const result = await dispatchSecretaryRun({
      runId,
      projectId: run.projectId,
      assignments: [{ assignmentId, sessionId }]
    })

    expect(result.dispatchedAssignmentIds).toEqual([assignmentId])
    expect(mocks.writeForSecretary).toHaveBeenNthCalledWith(1, sessionId, expect.stringContaining(
      '\u001b[200~Review the current implementation.\n\nWhen the task is finished, print one final <BIKORCH_RESULT>'
    ))
    expect(mocks.writeForSecretary).toHaveBeenNthCalledWith(2, sessionId, '\r')
    expect(store.updateRun).toHaveBeenCalledWith(runId, { status: 'running' })
  })

  it('requires a valid project/session handshake before approval', () => {
    const run = { ...approvedRun(), status: 'awaiting-approval' as const }
    mocks.getSecretaryStore.mockReturnValue({ getRun: vi.fn().mockReturnValue(run) })
    mocks.getSessionSnapshot.mockReturnValue({
      sessionId,
      projectId: run.projectId,
      kind: 'cursor',
      cwd: 'C:\\secretary-project',
      status: 'waiting'
    })

    expect(prepareSecretaryRun({
      runId,
      projectId: run.projectId,
      assignments: [{ assignmentId, sessionId }]
    })).toEqual({
      runId,
      projectId: run.projectId,
      preparedAssignmentIds: [assignmentId]
    })
  })

  it('refuses any run that was not explicitly approved', async () => {
    const run = { ...approvedRun(), status: 'awaiting-approval' as const }
    mocks.getSecretaryStore.mockReturnValue({ getRun: vi.fn().mockReturnValue(run) })

    await expect(dispatchSecretaryRun({
      runId,
      projectId: run.projectId,
      assignments: [{ assignmentId, sessionId }]
    })).rejects.toThrow(/no longer approved/i)
    expect(mocks.writeForSecretary).not.toHaveBeenCalled()
  })

  it('does not dispatch an approved plan into a different project', async () => {
    const run = approvedRun()
    mocks.getSecretaryStore.mockReturnValue({ getRun: vi.fn().mockReturnValue(run) })

    await expect(dispatchSecretaryRun({
      runId,
      projectId: '55555555-5555-4555-8555-555555555555',
      assignments: [{ assignmentId, sessionId }]
    })).rejects.toThrow(/different project/i)
    expect(mocks.writeForSecretary).not.toHaveBeenCalled()
  })

  it('does not dispatch a CLI session owned by another project', async () => {
    const run = approvedRun()
    mocks.getSecretaryStore.mockReturnValue({ getRun: vi.fn().mockReturnValue(run) })
    mocks.getSessionSnapshot.mockReturnValue({
      sessionId,
      projectId: '55555555-5555-4555-8555-555555555555',
      kind: 'cursor',
      cwd: 'C:\\secretary-project',
      status: 'waiting'
    })

    await expect(dispatchSecretaryRun({
      runId,
      projectId: run.projectId,
      assignments: [{ assignmentId, sessionId }]
    })).rejects.toThrow(/different project/i)
    expect(mocks.writeForSecretary).not.toHaveBeenCalled()
  })
})
