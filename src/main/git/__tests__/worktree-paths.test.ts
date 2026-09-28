import { join, resolve } from 'path'
import { mkdtempSync, realpathSync, rmdirSync } from 'fs'
import { tmpdir } from 'os'
import { describe, expect, it } from 'vitest'
import {
  buildAgentWorktreePath,
  buildIntegrationWorktreePath,
  canonicalRepoRoot,
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

  it('keeps repository identity and managed slots stable across native path aliases', () => {
    const root = mkdtempSync(join(tmpdir(), 'bikorch-path-'))
    try {
      const nativeRoot = realpathSync.native(root)
      const panelId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
      const agentPath = buildAgentWorktreePath(root, root, 'claude', panelId)
      expect(canonicalRepoRoot(root)).toBe(nativeRoot)
      expect(hashRepoRoot(root)).toBe(hashRepoRoot(nativeRoot))
      expect(agentPath).toBe(buildAgentWorktreePath(nativeRoot, nativeRoot, 'claude', panelId))
      expect(buildIntegrationWorktreePath(root, root, panelId)).toBe(
        buildIntegrationWorktreePath(nativeRoot, nativeRoot, panelId)
      )
      expect(isManagedWorktreePath(root, agentPath)).toBe(true)
    } finally {
      rmdirSync(root)
    }
  })
})
