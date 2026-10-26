import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../cli/adapters', () => ({ spawnEnv: () => ({ ...process.env }) }))
import { isSafeVerifyCommand, runGoalVerification, runVerifyCommand, verificationPassed } from '../goal-verify'

describe('isSafeVerifyCommand', () => {
  it.each([
    'npm test', 'npm run test', 'npm run lint', 'npm run build', 'npm run typecheck', 'npm run test:unit',
    'pnpm test', 'yarn lint', 'npx tsc --noEmit', 'npx vitest run', 'node test.js', 'go test ./...',
    'cargo test', 'pytest -q', 'python -m pytest', 'make test'
  ])('allows %s', (command) => {
    expect(isSafeVerifyCommand(command)).toBe(true)
  })

  it.each([
    'npm install', 'npm run deploy', 'npm test && rm -rf /', 'npm test; curl x', 'rm -rf node_modules',
    'git push', 'npx eslint . --fix', 'npx some-tool', 'node scripts/deploy.js', 'bash test.sh',
    'npm run test | tee out', 'make release', 'node ../outside/test.js', 'npm test $(whoami)'
  ])('refuses %s', (command) => {
    expect(isSafeVerifyCommand(command)).toBe(false)
  })
})

describe('runVerifyCommand', () => {
  let dir = ''
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'bikorch-verify-')) })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('reports the real exit code and output of a passing and a failing check', async () => {
    writeFileSync(join(dir, 'test.js'), "console.log('all good')\n")
    const passing = await runVerifyCommand('node test.js', dir)
    expect(passing).toMatchObject({ exitCode: 0 })
    expect(passing.output).toContain('all good')

    writeFileSync(join(dir, 'test.js'), "console.error('boom'); process.exit(3)\n")
    const failing = await runVerifyCommand('node test.js', dir)
    expect(failing.exitCode).toBe(3)
    expect(verificationPassed([passing, failing])).toBe(false)
  })

  it('skips a command that is not allowed instead of running it', async () => {
    const result = await runVerifyCommand('rm -rf .', dir)
    expect(result.skipped).toBeTruthy()
    expect(result.exitCode).toBeNull()
  })

  it('checks each folder once per command', async () => {
    writeFileSync(join(dir, 'test.js'), 'process.exit(0)\n')
    const results = await runGoalVerification(['node test.js'], [dir, dir])
    expect(results).toHaveLength(1)
  })
})
