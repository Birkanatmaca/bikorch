import { execFileSync } from 'child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ shell: { openExternal: vi.fn() } }))
import { initializeGitRepo, inspectGitSetup } from '../setup'

let root = ''
let globalConfig = ''
const saved = { global: process.env.GIT_CONFIG_GLOBAL, nosystem: process.env.GIT_CONFIG_NOSYSTEM }

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'bikorch-git-setup-'))
  globalConfig = join(mkdtempSync(join(tmpdir(), 'bikorch-gitconfig-')), 'config')
  writeFileSync(globalConfig, '')
  // A fresh machine: no global name/email.
  process.env.GIT_CONFIG_GLOBAL = globalConfig
  process.env.GIT_CONFIG_NOSYSTEM = '1'
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
  rmSync(dirname(globalConfig), { recursive: true, force: true })
  if (saved.global === undefined) delete process.env.GIT_CONFIG_GLOBAL
  else process.env.GIT_CONFIG_GLOBAL = saved.global
  if (saved.nosystem === undefined) delete process.env.GIT_CONFIG_NOSYSTEM
  else process.env.GIT_CONFIG_NOSYSTEM = saved.nosystem
})

describe('Git setup for Manager work', () => {
  it('reports a plain folder as not ready', async () => {
    expect(await inspectGitSetup(root)).toMatchObject({ gitInstalled: true, isRepo: false, hasCommits: false })
  })

  it('asks for a name and email when Git has none', async () => {
    const result = await initializeGitRepo(root)
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/name and email/)
  })

  it('initializes, ignores dependencies and makes the first commit', async () => {
    writeFileSync(join(root, 'index.js'), 'console.log(1)\n')
    const result = await initializeGitRepo(root, { name: 'Dev', email: 'dev@example.com' })
    expect(result).toMatchObject({ ok: true, status: { isRepo: true, hasCommits: true, identityConfigured: true } })
    expect(readFileSync(join(root, '.gitignore'), 'utf8')).toContain('node_modules/')
    const files = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' })
    expect(files).toContain('index.js')
    expect(execFileSync('git', ['log', '--format=%an'], { cwd: root, encoding: 'utf8' }).trim()).toBe('Dev')
  })

  it('keeps an existing .gitignore', async () => {
    writeFileSync(join(root, '.gitignore'), 'custom\n')
    await initializeGitRepo(root, { name: 'Dev', email: 'dev@example.com' })
    expect(readFileSync(join(root, '.gitignore'), 'utf8')).toBe('custom\n')
    expect(existsSync(join(root, '.git'))).toBe(true)
  })
})
