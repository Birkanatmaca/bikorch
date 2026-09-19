import { afterEach, describe, expect, it } from 'vitest'
import type { SecretaryRun } from '@shared/contracts/secretary'
import { clearSecretaryRunLocks, releaseSecretaryRunLock, reserveSecretaryRunLock } from '../run-lock'

function run(id: string, projectId: string): SecretaryRun {
  return {
    id,
    threadId: '22222222-2222-4222-8222-222222222222',
    projectId,
    status: 'approved',
    requestText: 'Review the project',
    reply: null,
    plan: null,
    planRevision: 0,
    openKinds: [],
    errorCode: null,
    errorMessage: null,
    createdAt: 1,
    updatedAt: 1
  }
}

afterEach(() => clearSecretaryRunLocks())

describe('Secretary run locks', () => {
  it('allows only one active Secretary run in a project', () => {
    const first = run('11111111-1111-4111-8111-111111111111', 'project-1234')
    const second = run('33333333-3333-4333-8333-333333333333', 'project-1234')
    reserveSecretaryRunLock(first, ['session-1'])

    expect(() => reserveSecretaryRunLock(second, ['session-2'])).toThrow(/already active/i)

    releaseSecretaryRunLock(first.id)
    expect(() => reserveSecretaryRunLock(second, ['session-2'])).not.toThrow()
  })

  it('does not allow a CLI session to be shared across active runs', () => {
    reserveSecretaryRunLock(run('11111111-1111-4111-8111-111111111111', 'project-1234'), ['session-1'])

    expect(() => reserveSecretaryRunLock(
      run('33333333-3333-4333-8333-333333333333', 'project-5678'),
      ['session-1']
    )).toThrow(/CLI session/i)
  })
})
