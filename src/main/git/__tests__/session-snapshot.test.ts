import { execFileSync } from 'child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { checkAgentGitPatch } from '../session-snapshot'

describe('agent patch check', () => {
  it('reports the real Git exit code for a tracked whitespace error', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'bikorch-patch-check-'))
    try {
      const git = (...args: string[]): void => {
        execFileSync('git', args, { cwd, stdio: 'ignore', windowsHide: true })
      }
      git('init', '-q')
      git('config', 'user.email', 'test@example.invalid')
      git('config', 'user.name', 'Bikorch test')
      writeFileSync(join(cwd, 'app.txt'), 'clean\n')
      git('add', 'app.txt')
      git('commit', '-qm', 'baseline')

      expect(await checkAgentGitPatch(cwd)).toBe(0)
      writeFileSync(join(cwd, 'app.txt'), 'trailing spaces  \n')
      expect(await checkAgentGitPatch(cwd)).not.toBe(0)
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })
})
