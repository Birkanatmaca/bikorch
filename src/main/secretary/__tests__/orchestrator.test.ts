import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getSecretaryStore: vi.fn(),
  getSessionSnapshot: vi.fn(),
  writeForSecretary: vi.fn(),
  trackSecretaryRun: vi.fn(),
  cancelTrackedSecretaryRun: vi.fn(),
  loadSnapshot: vi.fn(),
  flushPersistenceToDisk: vi.fn(),
  isRegisteredAgentWorktree: vi.fn()
}))

vi.mock('../store', () => ({ getSecretaryStore: mocks.getSecretaryStore }))
vi.mock('../../cli/pty-manager', () => ({
  ptyManager: {
    getSessionSnapshot: mocks.getSessionSnapshot,
    writeForSecretary: mocks.writeForSecretary
  }
}))
vi.mock('../result-collector', () => ({
  trackSecretaryRun: mocks.trackSecretaryRun,
  cancelTrackedSecretaryRun: mocks.cancelTrackedSecretaryRun
}))
vi.mock('../../persistence/database', () => ({ loadSnapshot: mocks.loadSnapshot, flushPersistenceToDisk: mocks.flushPersistenceToDisk }))
vi.mock('../../git/worktrees', () => ({ isRegisteredAgentWorktree: mocks.isRegisteredAgentWorktree }))

import { dispatchSecretaryRun, prepareSecretaryRun } from '../orchestrator'

const runId = '11111111-1111-4111-8111-111111111111'
const threadId = '22222222-2222-4222-8222-222222222222'
const assignmentId = 'assignment-1'
const sessionId = '33333333-3333-4333-8333-333333333333'
const projectPath = 'C:\\secretary-project'
const worktreePath = 'C:\\bikorch-worktrees\\cursor-33333333'

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
        mode: 'review' as const,
        title: 'Review',
        instruction: 'Review the current implementation.',
        expectedResult: 'A concise review with evidence.',
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
    mocks.isRegisteredAgentWorktree.mockResolvedValue(true)
    mocks.loadSnapshot.mockReturnValue({
      projects: [{ id: '44444444-4444-4444-8444-444444444444', name: 'Secretary project', folderPath: projectPath }],
      workspaces: {
        '44444444-4444-4444-8444-444444444444': {
          panels: [{ id: sessionId, type: 'cursor', title: 'Cursor', zone: 'center', panelRole: 'secretary', workspaceIsolation: 'isolated', worktreePath }]
        }
      }
    })
  })

  it('writes only the persisted approved instruction to the compatible CLI session', async () => {
    const run = approvedRun()
    const store = {
      getRun: vi.fn()
        .mockReturnValueOnce(run)
        .mockReturnValueOnce({ ...run, status: 'running' })
        .mockReturnValue({ ...run, status: 'running' }),
      updateRun: vi.fn().mockReturnValue({ ...run, status: 'running' }),
      appendMessage: vi.fn()
    }
    mocks.getSecretaryStore.mockReturnValue(store)
    mocks.getSessionSnapshot.mockReturnValue({
      sessionId,
      projectId: run.projectId,
      kind: 'cursor',
      cwd: worktreePath,
      worktreePath,
      status: 'waiting'
    })
    mocks.writeForSecretary.mockResolvedValue(undefined)

    const result = await dispatchSecretaryRun({
      runId,
      projectId: run.projectId,
      assignments: [{ assignmentId, sessionId }]
    })

    expect(result.dispatchedAssignmentIds).toEqual([assignmentId])
    expect(mocks.writeForSecretary).toHaveBeenNthCalledWith(1, sessionId, expect.stringContaining('Task mode: review'))
    expect(mocks.writeForSecretary).toHaveBeenNthCalledWith(1, sessionId, expect.stringContaining('Expected result: A concise review with evidence.'))
    expect(mocks.writeForSecretary).toHaveBeenNthCalledWith(1, sessionId, expect.stringContaining('Review the current implementation.'))
    expect(mocks.writeForSecretary).toHaveBeenNthCalledWith(2, sessionId, '\r')
    expect(store.updateRun).toHaveBeenCalledWith(runId, expect.objectContaining({
      status: 'running',
      sessionBindings: [expect.objectContaining({ assignmentId: 'assignment-1', sessionId })]
    }))
    expect(mocks.flushPersistenceToDisk.mock.invocationCallOrder[0]).toBeLessThan(mocks.writeForSecretary.mock.invocationCallOrder[0]!)
  })

  it('requires a valid project/session handshake before approval', async () => {
    const run = { ...approvedRun(), status: 'awaiting-approval' as const }
    mocks.getSecretaryStore.mockReturnValue({ getRun: vi.fn().mockReturnValue(run) })
    mocks.getSessionSnapshot.mockReturnValue({
      sessionId,
      projectId: run.projectId,
      kind: 'cursor',
      cwd: worktreePath,
      worktreePath,
      status: 'waiting'
    })

    await expect(prepareSecretaryRun({
      runId,
      projectId: run.projectId,
      assignments: [{ assignmentId, sessionId }]
    })).resolves.toEqual({
      runId,
      projectId: run.projectId,
      preparedAssignmentIds: [assignmentId]
    })
    expect(mocks.isRegisteredAgentWorktree).toHaveBeenCalledWith({
      projectRoot: projectPath,
      kind: 'cursor',
      panelId: sessionId,
      worktreePath
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

  it('rejects a session in the project folder even if the panel claims to have a worktree', async () => {
    const run = { ...approvedRun(), status: 'awaiting-approval' as const }
    mocks.getSecretaryStore.mockReturnValue({ getRun: vi.fn().mockReturnValue(run) })
    mocks.loadSnapshot.mockReturnValue({
      projects: [{ id: run.projectId, name: 'Secretary project', folderPath: projectPath }],
      workspaces: {
        [run.projectId]: {
          panels: [{
            id: sessionId,
            type: 'cursor',
            title: 'Cursor',
            zone: 'center',
            panelRole: 'secretary',
            workspaceIsolation: 'isolated',
            worktreePath
          }]
        }
      }
    })
    mocks.getSessionSnapshot.mockReturnValue({
      sessionId,
      projectId: run.projectId,
      kind: 'cursor',
      cwd: projectPath,
      status: 'waiting'
    })

    await expect(prepareSecretaryRun({
      runId,
      projectId: run.projectId,
      assignments: [{ assignmentId, sessionId }]
    })).rejects.toThrow(/isolated worktree/i)
    expect(mocks.isRegisteredAgentWorktree).not.toHaveBeenCalled()
  })

  it('does not approve a shared Secretary panel', async () => {
    const run = { ...approvedRun(), status: 'awaiting-approval' as const }
    mocks.getSecretaryStore.mockReturnValue({ getRun: vi.fn().mockReturnValue(run) })
    mocks.loadSnapshot().workspaces[run.projectId].panels[0].workspaceIsolation = 'shared'
    mocks.getSessionSnapshot.mockReturnValue({
      sessionId,
      projectId: run.projectId,
      kind: 'cursor',
      cwd: worktreePath,
      worktreePath,
      status: 'waiting'
    })

    await expect(prepareSecretaryRun({
      runId,
      projectId: run.projectId,
      assignments: [{ assignmentId, sessionId }]
    })).rejects.toThrow(/isolated worktree/i)
  })

  it('does not dispatch when the claimed worktree is not registered with Git', async () => {
    const run = approvedRun()
    mocks.getSecretaryStore.mockReturnValue({ getRun: vi.fn().mockReturnValue(run) })
    mocks.getSessionSnapshot.mockReturnValue({
      sessionId,
      projectId: run.projectId,
      kind: 'cursor',
      cwd: worktreePath,
      worktreePath,
      status: 'waiting'
    })
    mocks.isRegisteredAgentWorktree.mockResolvedValue(false)

    await expect(dispatchSecretaryRun({
      runId,
      projectId: run.projectId,
      assignments: [{ assignmentId, sessionId }]
    })).rejects.toThrow(/registered Git worktree/i)
    expect(mocks.writeForSecretary).not.toHaveBeenCalled()
  })

  it('requires separate worktrees for parallel assignments', async () => {
    const run = { ...approvedRun(), status: 'awaiting-approval' as const }
    const secondSessionId = '66666666-6666-4666-8666-666666666666'
    const secondAssignmentId = 'assignment-2'
    run.plan.assignments.push({
      ...run.plan.assignments[0],
      id: secondAssignmentId,
      panelId: null
    })
    mocks.getSecretaryStore.mockReturnValue({ getRun: vi.fn().mockReturnValue(run) })
    mocks.loadSnapshot().workspaces[run.projectId].panels.push({
      id: secondSessionId,
      type: 'cursor',
      title: 'Second Cursor',
      zone: 'center',
      panelRole: 'secretary',
      workspaceIsolation: 'isolated',
      worktreePath
    })
    mocks.getSessionSnapshot.mockImplementation((id: string) => ({
      sessionId: id,
      projectId: run.projectId,
      kind: 'cursor',
      cwd: worktreePath,
      worktreePath,
      status: 'waiting'
    }))

    await expect(prepareSecretaryRun({
      runId,
      projectId: run.projectId,
      assignments: [
        { assignmentId, sessionId },
        { assignmentId: secondAssignmentId, sessionId: secondSessionId }
      ]
    })).rejects.toThrow(/different isolated worktree/i)
  })

  it('starts independent assignments in different registered worktrees', async () => {
    const run = approvedRun()
    const secondSessionId = '66666666-6666-4666-8666-666666666666'
    const secondAssignmentId = 'assignment-2'
    const secondWorktreePath = 'C:\\bikorch-worktrees\\cursor-66666666'
    run.plan.assignments.push({
      ...run.plan.assignments[0],
      id: secondAssignmentId,
      title: 'Second independent task'
    })
    mocks.loadSnapshot().workspaces[run.projectId].panels.push({
      id: secondSessionId,
      type: 'cursor',
      title: 'Second Cursor',
      zone: 'center',
      panelRole: 'secretary',
      workspaceIsolation: 'isolated',
      worktreePath: secondWorktreePath
    })
    mocks.getSecretaryStore.mockReturnValue({
      getRun: vi.fn()
        .mockReturnValueOnce(run)
        .mockReturnValueOnce({ ...run, status: 'running' })
        .mockReturnValue({ ...run, status: 'running' }),
      updateRun: vi.fn().mockReturnValue({ ...run, status: 'running' }),
      appendMessage: vi.fn()
    })
    mocks.getSessionSnapshot.mockImplementation((id: string) => {
      const cwd = id === sessionId ? worktreePath : secondWorktreePath
      return {
        sessionId: id,
        projectId: run.projectId,
        kind: 'cursor',
        cwd,
        worktreePath: cwd,
        status: 'waiting'
      }
    })
    mocks.writeForSecretary.mockResolvedValue(undefined)

    const result = await dispatchSecretaryRun({
      runId,
      projectId: run.projectId,
      assignments: [
        { assignmentId, sessionId },
        { assignmentId: secondAssignmentId, sessionId: secondSessionId }
      ]
    })

    expect(result.dispatchedAssignmentIds).toEqual([assignmentId, secondAssignmentId])
    expect(mocks.isRegisteredAgentWorktree).toHaveBeenCalledWith(expect.objectContaining({
      panelId: sessionId,
      worktreePath
    }))
    expect(mocks.isRegisteredAgentWorktree).toHaveBeenCalledWith(expect.objectContaining({
      panelId: secondSessionId,
      worktreePath: secondWorktreePath
    }))
    expect(mocks.writeForSecretary).toHaveBeenCalledWith(sessionId, '\r')
    expect(mocks.writeForSecretary).toHaveBeenCalledWith(secondSessionId, '\r')
  })

  it('does not dispatch a CLI session owned by another project', async () => {
    const run = approvedRun()
    mocks.getSecretaryStore.mockReturnValue({ getRun: vi.fn().mockReturnValue(run) })
    mocks.getSessionSnapshot.mockReturnValue({
      sessionId,
      projectId: '55555555-5555-4555-8555-555555555555',
      kind: 'cursor',
      cwd: worktreePath,
      worktreePath,
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
