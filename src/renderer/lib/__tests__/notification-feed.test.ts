import { describe, expect, it } from 'vitest'
import { noticeFromSecretaryEvent } from '../notification-feed'

describe('noticeFromSecretaryEvent', () => {
  it('turns a Manager report into a completion notice with Git facts', () => {
    const notice = noticeFromSecretaryEvent({
      type: 'run-report',
      status: 'completed',
      notice: { headline: 'I added add() to calc.js.', highlights: ['test.js gained a test'] },
      projectId: 'project-1234',
      threadId: 'thread-1234',
      runId: 'run-12345678',
      reply: 'long',
      changedFiles: ['calc.js', 'test.js'],
      unverifiedReportedFiles: [],
      completionEvidence: { cliReported: 1, terminalIdleInferred: 0 },
      panelIds: ['panel-1'],
      evidence: {} as never
    }, 'demo')
    expect(notice).toMatchObject({
      kind: 'done',
      source: 'Manager',
      projectName: 'demo',
      headline: 'I added add() to calc.js.',
      changedFiles: 2,
      runId: 'run-12345678'
    })
  })

  it('marks a failed report and a question for the user', () => {
    expect(noticeFromSecretaryEvent({
      type: 'run-needs-user', projectId: 'p', threadId: 't', runId: 'r', assignmentId: 'a',
      assignmentTitle: 'Update API', message: 'Which endpoint should I change?'
    }, 'demo')).toMatchObject({ kind: 'needs-input', headline: 'Update API needs your answer.' })
  })
})
