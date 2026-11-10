import { describe, expect, it } from 'vitest'
import { inferCliAskingFromText } from '../cli-activity-detect'

describe('CLI asking detection', () => {
  it('sees Claude Code, Codex and y/n permission prompts', () => {
    expect(inferCliAskingFromText([
      '⏺ Bash(npm test)',
      'Do you want to proceed?',
      '❯ 1. Yes',
      "  2. Yes, and don't ask again for npm test commands",
      '  3. No, and tell Claude what to do differently (esc)'
    ].join('\n'))).toBe(true)
    expect(inferCliAskingFromText('Allow command?\n  git push\n› 1. Yes, allow once\n  2. No')).toBe(true)
    expect(inferCliAskingFromText('Overwrite package.json? (y/n)')).toBe(true)
  })

  it('stops asking once the CLI moves on', () => {
    expect(inferCliAskingFromText('Do you want to proceed?\n❯ 1. Yes\n  2. No\n✻ Running… (esc to interrupt)')).toBe(false)
    expect(inferCliAskingFromText('Do you want to proceed?\n❯ 1. Yes\n  2. No\n> \n  ? for shortcuts')).toBe(false)
  })

  it('ignores ordinary output and an idle prompt', () => {
    expect(inferCliAskingFromText('Here is the plan. Would you like more detail on step 2?\n> \n? for shortcuts')).toBe(false)
    expect(inferCliAskingFromText('Tests passed.\n❯ ')).toBe(false)
    expect(inferCliAskingFromText('')).toBe(false)
  })
})
