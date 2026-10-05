import { mkdtemp, mkdir, rm, symlink, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { managerTerminalFailureExcerpt, readManagerSourceExcerpts } from '../inspection-evidence'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })

describe('Manager inspection evidence', () => {
  it('extracts runtime failures and redacts ANSI-hidden credentials and personal paths', () => {
    const excerpt = managerTerminalFailureExcerpt([
      'Starting server',
      '\u001b[31mTypeError: Cannot read properties of undefined\u001b[0m',
      ' at /Users/developer/project/src/app.ts:34:8',
      'OPENAI_API_KEY=sk-proj-\u001b[32msecret-value-1234567890\u001b[0m'
    ].join('\n'), '/Users/developer/project')
    expect(excerpt).toContain('TypeError')
    expect(excerpt).toContain('[project]/src/app.ts:34:8')
    expect(excerpt).toContain('[REDACTED]')
    expect(excerpt).not.toContain('secret-value')
    expect(excerpt).not.toContain('/Users/developer')
    expect(excerpt).not.toContain('\u001b')
  })

  it('does not treat passing test summaries as failures but keeps failed-session fallback bounded', () => {
    expect(managerTerminalFailureExcerpt('Tests: 14 passed, 0 failed\nNo errors found', '/workspace')).toBeNull()
    expect(managerTerminalFailureExcerpt('0 errors, 1 test failed', '/workspace')).toContain('1 test failed')
    expect(managerTerminalFailureExcerpt('npm ERR! missing package\nValueError: bad input', '/workspace')).toContain('ValueError')
    expect(managerTerminalFailureExcerpt('Quiet output without a stack', '/workspace', true)).toBe('Quiet output without a stack')
    expect(managerTerminalFailureExcerpt(`fatal: ${'x'.repeat(20_000)}`, '/workspace', true)?.length).toBeLessThanOrEqual(2_200)
  })

  it('prioritizes relevant source around a stack location while excluding secrets and symlinks', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bikorch-manager-evidence-'))
    roots.push(root)
    await mkdir(join(root, 'src', 'secretary'), { recursive: true })
    await mkdir(join(root, 'secrets'))
    await writeFile(join(root, 'src', 'secretary', 'service.ts'), Array.from({ length: 100 }, (_, index) => `export const line${index + 1} = ${index + 1}`).join('\n'))
    await writeFile(join(root, 'package.json'), '{"name":"fixture","token":"private-token-value"}')
    await writeFile(join(root, 'secrets', 'credentials.json'), '{"password":"do-not-read"}')
    await symlink(join(root, 'src', 'secretary', 'service.ts'), join(root, 'linked.ts'))
    const excerpts = await readManagerSourceExcerpts(root, [
      'package.json', 'secrets/credentials.json', 'linked.ts', 'src/secretary/service.ts'
    ], [], 'TypeError at src/secretary/service.ts:70')
    expect(excerpts[0]).toMatchObject({ path: 'src/secretary/service.ts', startLine: 62, reason: 'requested', truncated: true })
    expect(excerpts[0].content).toContain('line70')
    expect(excerpts.some((excerpt) => excerpt.path === 'linked.ts' || excerpt.path.includes('credentials'))).toBe(false)
    expect(JSON.stringify(excerpts)).not.toContain('private-token-value')
    expect(excerpts.every((excerpt) => excerpt.content.length <= 2_200)).toBe(true)
  })
})
