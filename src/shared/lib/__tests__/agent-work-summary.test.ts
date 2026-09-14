import { describe, expect, it } from 'vitest'
import { summarizeChangedWork } from '../agent-work-summary'

describe('agent work summary', () => {
  it('prefers cleaned commit subjects over file names', () => {
    expect(
      summarizeChangedWork(['src/auth.ts'], ['feat: Updated authentication flow', 'Added refresh token handling'])
    ).toEqual(['Updated authentication flow', 'Added refresh token handling'])
  })

  it('falls back to file names when there are no commits', () => {
    expect(summarizeChangedWork(['src/auth.ts', 'src/login.tsx', 'src/auth.test.ts'])).toEqual([
      'Updated auth',
      'Updated login',
      'Added auth tests'
    ])
  })
})
