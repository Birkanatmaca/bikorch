import { describe, expect, it } from 'vitest'
import { buildConflictResolvePrompt, extractConflictHunks } from '../isolation-prompt'

describe('extractConflictHunks', () => {
  it('keeps only marker blocks plus a little context', () => {
    const text = [
      'const keep = true',
      'const a = 1',
      'const b = 2',
      '<<<<<<< HEAD',
      'const n = 2',
      '=======',
      'const n = 3',
      '>>>>>>> agent',
      'const after = true',
      'const tail = true'
    ].join('\n')

    const hunks = extractConflictHunks(text, { context: 1 })
    expect(hunks).toContain('<<<<<<< HEAD')
    expect(hunks).toContain('const n = 2')
    expect(hunks).toContain('const n = 3')
    expect(hunks).toContain('const after = true')
    expect(hunks).not.toContain('const keep = true')
    expect(hunks).not.toContain('const tail = true')
  })

  it('returns empty when there are no markers', () => {
    expect(extractConflictHunks('export const n = 1\n')).toBe('')
  })
})

describe('buildConflictResolvePrompt', () => {
  it('prefers conflict hunks over full file sides', () => {
    const prompt = buildConflictResolvePrompt({
      task: 'UI',
      resolverLabel: 'Cursor CLI',
      otherLabels: ['Auth'],
      files: [
        {
          path: 'shared.ts',
          absolutePath: '/tmp/integrate/shared.ts',
          hunks: '<<<<<<< HEAD\nconst n = 2\n=======\nconst n = 3\n>>>>>>> agent',
          main: 'this should not appear because hunks exist',
          agent: 'this should not appear either'
        }
      ]
    })
    expect(prompt).toContain('Task: UI')
    expect(prompt).toContain('Conflict between Cursor CLI and Auth')
    expect(prompt).toContain('/tmp/integrate/shared.ts')
    expect(prompt).toContain('<<<<<<< HEAD')
    expect(prompt).not.toContain('this should not appear')
    expect(prompt).toContain('Do not modify unrelated files')
  })

  it('falls back to clipped sides when hunks are missing', () => {
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
    expect(prompt).toContain('MAIN\nexport const n = 2')
    expect(prompt).toContain('YOUR BRANCH\nexport const n = 3')
  })
})
