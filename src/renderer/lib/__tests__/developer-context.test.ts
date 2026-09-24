import { describe, expect, it } from 'vitest'
import { formatMemoryContextInline } from '../developer-context'

describe('inline CLI memory context', () => {
  it('never emits a newline or terminal control sequence before Enter', () => {
    const inline = formatMemoryContextInline({
      injectionEnabled: true,
      memories: [{ id: 'm1', scope: 'global', category: 'Workflow', content: 'Plan first\nthen test\u001b[31m', relevance: 1 }],
      characterCount: 26,
      tokenEstimate: 7,
      truncated: false
    })
    expect(inline).toContain('Plan first then test')
    expect(inline).not.toMatch(/[\r\n\u001b]/)
    expect(inline.startsWith(' ')).toBe(true)
  })

  it('does not inject when permission is off', () => {
    expect(formatMemoryContextInline({
      injectionEnabled: false, memories: [{ id: 'm1', scope: 'global', category: 'Workflow', content: 'Private', relevance: 1 }],
      characterCount: 7, tokenEstimate: 2, truncated: false
    })).toBe('')
  })
})
