import { describe, expect, it } from 'vitest'
import { parseManagerAppActions } from '@shared/contracts/secretary'

describe('manager app actions', () => {
  it('keeps only known surfaces and drops duplicates', () => {
    expect(parseManagerAppActions(['show-memory', 'open-browser', 'show-memory', 'commit', 'layout-tiled'])).toEqual([
      'show-memory',
      'open-browser',
      'layout-tiled'
    ])
  })

  it('ignores anything that is not a list', () => {
    expect(parseManagerAppActions('show-files')).toEqual([])
  })
})
