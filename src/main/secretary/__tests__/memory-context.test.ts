import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getMemoryContext } = vi.hoisted(() => ({ getMemoryContext: vi.fn() }))
vi.mock('../../developer-intelligence/service', () => ({ getMemoryContext }))

import { secretaryMemoryContext } from '../memory-context'

describe('Secretary developer memory context', () => {
  beforeEach(() => getMemoryContext.mockReset())

  it('does not expose memory when prompt injection is disabled', () => {
    getMemoryContext.mockReturnValue({ injectionEnabled: false, memories: [
      { scope: 'global', category: 'Workflow', content: 'Private preference' }
    ] })
    expect(secretaryMemoryContext('project-1', 'review')).toEqual([])
    expect(getMemoryContext).toHaveBeenCalledWith({ projectId: 'project-1', query: 'review', limit: 8 })
  })

  it('redacts and bounds enabled facts before adding them to the model request', () => {
    getMemoryContext.mockReturnValue({ injectionEnabled: true, memories: [
      { scope: 'global', category: 'Tooling', content: 'Uses sk-proj-123456789012345678901234567890 for work.' }
    ] })
    const facts = secretaryMemoryContext('project-1', 'tools')
    expect(facts).toHaveLength(1)
    expect(facts[0]?.content).not.toContain('sk-proj-')
    expect(facts[0]?.content).toContain('[REDACTED]')
  })
})
