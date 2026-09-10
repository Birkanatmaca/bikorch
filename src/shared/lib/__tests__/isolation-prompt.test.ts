import { describe, expect, it } from 'vitest'
import { buildConflictResolvePrompt } from '../isolation-prompt'

describe('buildConflictResolvePrompt', () => {
  it('packs both sides and absolute paths', () => {
    const prompt = buildConflictResolvePrompt({
      task: 'UI',
      resolverLabel: 'Cursor CLI',
      otherLabels: ['Auth'],
      files: [
        {
          path: 'shared.ts',
          absolutePath: '/tmp/integrate/shared.ts',
          base: 'export const n = 1\n',
          main: 'export const n = 2\n',
          agent: 'export const n = 3\n'
        }
      ]
    })
    expect(prompt).toContain('Task: UI')
    expect(prompt).toContain('Conflict between Cursor CLI and Auth')
    expect(prompt).toContain('/tmp/integrate/shared.ts')
    expect(prompt).toContain('MAIN\nexport const n = 2')
    expect(prompt).toContain('YOUR BRANCH\nexport const n = 3')
    expect(prompt).toContain('Do not modify unrelated files')
  })
})
