import { describe, expect, it } from 'vitest'
import {
  DEFAULT_WORKTREE_PROVISION,
  parseWorktreeProvision,
  parseWorktreeSetupFailure
} from '../git'

describe('worktree provision settings', () => {
  it('defaults to no secret copy and isolated dependencies', () => {
    expect(parseWorktreeProvision(undefined)).toEqual(DEFAULT_WORKTREE_PROVISION)
    expect(DEFAULT_WORKTREE_PROVISION).toEqual({
      copyLocalFiles: [],
      dependencyMode: 'isolated'
    })
  })

  it('keeps only catalog file names', () => {
    expect(
      parseWorktreeProvision({
        copyLocalFiles: ['.env', '../.ssh/id_rsa', '.npmrc'],
        dependencyMode: 'share'
      })
    ).toEqual({
      copyLocalFiles: ['.env', '.npmrc'],
      dependencyMode: 'share'
    })
  })

  it('parses a workspace setup failure', () => {
    expect(
      parseWorktreeSetupFailure({
        command: 'pnpm',
        args: ['install'],
        output: 'boom',
        exitCode: 1
      })
    ).toEqual({
      command: 'pnpm',
      args: ['install'],
      output: 'boom',
      exitCode: 1
    })
    expect(parseWorktreeSetupFailure({ command: '' })).toBeNull()
  })
})
