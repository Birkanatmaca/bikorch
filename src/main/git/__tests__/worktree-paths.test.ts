import { join, resolve } from 'path'
import { describe, expect, it } from 'vitest'
import {
  buildAgentWorktreePath,
  hashRepoRoot,
  isAgentWorktreeKind,
  isManagedWorktreePath,
  sanitizeWorktreeSlot
} from '../worktree-paths'

describe('agent worktree paths', () => {
  it('accepts agent kinds only', () => {
    expect(isAgentWorktreeKind('claude')).toBe(true)
    expect(isAgentWorktreeKind('terminal')).toBe(false)
  })

  it('builds a stable slot outside the repo', () => {
    const slot = sanitizeWorktreeSlot('claude', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890')
    expect(slot).toBe('claude-a1b2c3d4')
    const path = buildAgentWorktreePath('/data/bikorch', 'C:/src/app', 'claude', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890')
    expect(path).toBe(
      join(resolve('/data/bikorch'), 'agent-worktrees', hashRepoRoot('C:/src/app'), 'claude-a1b2c3d4')
    )
    expect(isManagedWorktreePath('/data/bikorch', path)).toBe(true)
    expect(isManagedWorktreePath('/data/bikorch', '/tmp/other')).toBe(false)
  })
})
