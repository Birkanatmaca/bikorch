import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  secretaryMemoryContext: vi.fn(),
  secretarySkillContext: vi.fn()
}))

vi.mock('../memory-context', () => ({ secretaryMemoryContext: mocks.secretaryMemoryContext }))
vi.mock('../skill-context', () => ({ secretarySkillContext: mocks.secretarySkillContext }))

import { secretaryCliDeveloperContext } from '../cli-developer-context'

const assignment = { title: 'Add endpoint', instruction: 'Add a health endpoint.' }

beforeEach(() => {
  vi.resetAllMocks()
  mocks.secretarySkillContext.mockReturnValue([])
})

describe('CLI developer context', () => {
  it('passes work preferences and enabled matching skills to the CLI', () => {
    mocks.secretaryMemoryContext.mockReturnValue([
      { category: 'Tooling', content: 'Uses pnpm', scope: 'global' },
      { category: 'Communication', content: 'Prefers Turkish replies', scope: 'global' },
      { category: 'About me', content: 'Lives in Istanbul', scope: 'global' }
    ])
    mocks.secretarySkillContext.mockReturnValue([
      { name: 'API style', description: 'REST endpoints', instructions: 'Return typed errors.', enabled: true },
      { name: 'Old', description: 'Unused', instructions: 'Ignore me.', enabled: false }
    ])
    const context = secretaryCliDeveloperContext('project-1', assignment)
    expect(context).toContain('[Tooling] Uses pnpm')
    expect(context).toContain('Skill "API style"')
    expect(context).not.toContain('Turkish')
    expect(context).not.toContain('Istanbul')
    expect(context).not.toContain('Ignore me')
    expect(mocks.secretaryMemoryContext).toHaveBeenCalledWith('project-1', expect.stringContaining('health endpoint'))
  })

  it('returns nothing when memory is off or unavailable', () => {
    mocks.secretaryMemoryContext.mockReturnValue([])
    expect(secretaryCliDeveloperContext('project-1', assignment)).toBe('')
    mocks.secretaryMemoryContext.mockImplementation(() => { throw new Error('store not ready') })
    expect(secretaryCliDeveloperContext('project-1', assignment)).toBe('')
  })
})
