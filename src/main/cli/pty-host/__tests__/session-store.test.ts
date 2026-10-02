import { describe, expect, it } from 'vitest'
import { appendOutputBuffer, hostHasRunningSessions, hostSessionMatchesRequest } from '../session-store'

describe('PTY host session store', () => {
  it('treats only running sessions as live work', () => {
    const sessions = new Map<string, { status: string }>([
      ['alive', { status: 'running' }],
      ['dead', { status: 'stopped' }]
    ])
    sessions.delete('dead')
    expect(hostHasRunningSessions(sessions)).toBe(true)
    sessions.delete('alive')
    expect(hostHasRunningSessions(sessions)).toBe(false)
  })

  it('trims replay output to the cap', () => {
    expect(appendOutputBuffer('abc', 'defghi', 6)).toBe('defghi')
    expect(appendOutputBuffer('aaaaaa', 'bbb', 6)).toBe('aaabbb')
    expect(appendOutputBuffer('', 'x'.repeat(10), 6)).toBe('xxxxxx')
  })

  it('preserves the owner, account and folder when reattaching after app restart', () => {
    const owner = { projectId: 'project', kind: 'codex', accountId: 'account', cwd: '/project/tree', worktreePath: '/project/tree' }
    expect(hostSessionMatchesRequest(owner, { ...owner })).toBe(true)
    expect(hostSessionMatchesRequest(owner, { ...owner, projectId: 'other' })).toBe(false)
    expect(hostSessionMatchesRequest(owner, { ...owner, accountId: 'other' })).toBe(false)
    expect(hostSessionMatchesRequest(owner, { ...owner, cwd: '/project' })).toBe(false)
    expect(hostSessionMatchesRequest(owner, { ...owner, cliModel: 'different-model' })).toBe(false)
  })
})
