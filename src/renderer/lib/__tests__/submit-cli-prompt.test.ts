import { describe, expect, it } from 'vitest'
import { formatCliPaste } from '../submit-cli-prompt'

describe('formatCliPaste', () => {
  it('wraps the prompt in bracketed paste markers', () => {
    expect(formatCliPaste('fix the conflict')).toBe('\u001b[200~fix the conflict\u001b[201~')
  })
})
