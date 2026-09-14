import { describe, expect, it } from 'vitest'
import { buildResumeContext, normalizeAgentRunStatus } from '../agent-lifecycle'

describe('agent lifecycle', () => {
  it('maps legacy statuses without treating process exit as merged', () => {
    expect(normalizeAgentRunStatus('active')).toBe('running')
    expect(normalizeAgentRunStatus('accepted')).toBe('merged')
    expect(normalizeAgentRunStatus('queued')).toBe('awaiting-review')
    expect(normalizeAgentRunStatus('exited')).toBe('interrupted')
  })

  it('builds resume context from Git state instead of chat history', () => {
    const text = buildResumeContext({
      run: {
        title: 'Auth',
        kind: 'cursor',
        branch: 'bikorch/cursor-aaaaaaaa',
        targetBranch: 'release',
        baseSha: 'abcdef1234567890',
        status: 'interrupted'
      },
      files: ['src/auth.ts', 'src/session.ts'],
      headSha: 'fff111222333',
      lastCheckpointSha: 'abc111'
    })
    expect(text).toContain('previous chat is gone')
    expect(text).toContain('Target: release')
    expect(text).not.toContain('main')
    expect(text).toContain('src/auth.ts')
    expect(text).toContain('Status: interrupted')
  })
})
