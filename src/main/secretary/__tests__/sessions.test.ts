import { describe, expect, it } from 'vitest'
import type { SecretaryRun, SecretaryThread } from '@shared/contracts/secretary'
import { buildSessionSummaries } from '../sessions'

function thread(id: string): SecretaryThread {
  return {
    id,
    projectId: 'project-1234',
    title: 'Yesterday',
    status: 'active',
    createdAt: 1,
    updatedAt: 2
  }
}

function run(overrides: Partial<SecretaryRun>): SecretaryRun {
  return {
    id: 'run-1',
    threadId: 'thread-1',
    projectId: 'project-1234',
    status: 'completed',
    requestText: 'Review auth',
    reply: null,
    plan: {
      overview: 'Review the authentication flow.',
      assumptions: [],
      assignments: [{
        id: 'assignment-1',
        panelId: null,
        kind: 'cursor',
        mode: 'review',
        title: 'Review auth',
        instruction: 'Review it.',
        expectedResult: 'A list of issues.',
        rationale: 'Needed.',
        usageNote: 'Cursor',
        dependsOn: []
      }],
      approvalRequired: true
    },
    planRevision: 1,
    openKinds: [],
    errorCode: null,
    errorMessage: null,
    sessionBindings: [],
    evidence: null,
    createdAt: 3,
    updatedAt: 4,
    ...overrides
  }
}

describe('session summaries', () => {
  it('shows the finished work for each conversation', () => {
    const summaries = buildSessionSummaries(
      [thread('thread-1')],
      [run({}), run({ id: 'run-2', status: 'planning', plan: null, requestText: 'Add a loading state' })],
      { 'thread-1': 4 }
    )
    expect(summaries).toEqual([
      expect.objectContaining({
        id: 'thread-1',
        messageCount: 4,
        work: [
          { label: 'Review auth', status: 'completed' },
          { label: 'Add a loading state', status: 'active' }
        ]
      })
    ])
  })
})