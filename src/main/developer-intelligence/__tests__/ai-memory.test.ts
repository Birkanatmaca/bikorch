import { describe, expect, it } from 'vitest'
import { parseAiMemorySuggestions } from '../ai-memory'

describe('AI memory suggestion validation', () => {
  it('accepts only concise developer facts backed by two distinct saved prompts', () => {
    const suggestions = parseAiMemorySuggestions({ memories: [
      { category: 'Workflow', content: 'Prefers tests alongside implementation.', supportingPromptIndexes: [0, 1] },
      { category: 'Workflow', content: 'Prefers tests alongside implementation.', supportingPromptIndexes: [0, 1] },
      { category: 'Workflow', content: 'One observation only.', supportingPromptIndexes: [0, 0] },
      { category: 'Identity', content: 'Lives in Istanbul.', supportingPromptIndexes: [0, 1] },
      { category: 'About me', content: 'Is a designer from Istanbul.', supportingPromptIndexes: [0, 1] },
      { category: 'Tooling', content: 'Uses sk-proj-123456789012345678901234567890.', supportingPromptIndexes: [0, 1] },
      { category: 'Coding style', content: 'Avoids large components.', supportingPromptIndexes: [0, 99] }
    ] }, 2)

    expect(suggestions).toHaveLength(1)
    expect(suggestions[0]).toMatchObject({
      scope: 'global',
      category: 'Workflow',
      evidenceCount: 2,
      content: 'Prefers tests alongside implementation.'
    })
    expect(suggestions[0]?.key).toMatch(/^model:[a-f0-9]{32}$/)
  })

  it('rejects malformed model output', () => {
    expect(parseAiMemorySuggestions(null, 4)).toEqual([])
    expect(parseAiMemorySuggestions({ memories: 'no' }, 4)).toEqual([])
  })
})
