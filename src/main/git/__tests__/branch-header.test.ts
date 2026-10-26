import { describe, expect, it } from 'vitest'
import { parseBranchHeader } from '../index'

describe('parseBranchHeader', () => {
  it('reads branch, upstream and divergence', () => {
    expect(parseBranchHeader('## main...origin/main [ahead 2, behind 1]')).toEqual({
      branch: 'main',
      upstream: 'origin/main',
      ahead: 2,
      behind: 1
    })
  })

  it('handles a branch without upstream', () => {
    expect(parseBranchHeader('## feature/x')).toEqual({
      branch: 'feature/x',
      upstream: null,
      ahead: 0,
      behind: 0
    })
  })

  it('treats a gone upstream as no upstream', () => {
    expect(parseBranchHeader('## main...origin/main [gone]')).toMatchObject({
      branch: 'main',
      upstream: null
    })
  })

  it('handles unborn and detached heads', () => {
    expect(parseBranchHeader('## No commits yet on main').branch).toBe('main')
    expect(parseBranchHeader('## HEAD (no branch)').branch).toBeNull()
  })
})
