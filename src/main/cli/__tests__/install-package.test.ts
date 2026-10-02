import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const sandbox = vi.hoisted(() => ({ home: '', exec: vi.fn() }))
vi.mock('os', async () => ({ ...await vi.importActual<typeof import('os')>('os'), homedir: () => sandbox.home }))
vi.mock('util', () => ({ promisify: () => sandbox.exec }))
vi.mock('../adapters', () => ({ terminalUserEnv: () => ({}) }))
import { installManagedPackage } from '../install-package'
import { managedCliPaths } from '../managed-paths'

beforeEach(() => {
  sandbox.home = mkdtempSync(join(tmpdir(), 'bikorch-staged-package-'))
  sandbox.exec.mockReset().mockImplementation(async (_command, args) => {
    if (args.includes('install')) {
      const prefix = args[args.indexOf('--prefix') + 1]
      const root = join(prefix, ...(process.platform === 'win32' ? [] : ['lib']), 'node_modules', '@openai/codex')
      mkdirSync(root, { recursive: true })
      writeFileSync(join(root, 'package.json'), JSON.stringify({ bin: { codex: 'index.js' } }))
      writeFileSync(join(root, 'index.js'), 'downloaded')
      return { stdout: '', stderr: '' }
    }
    return { stdout: 'codex-cli 1.2.3', stderr: '' }
  })
})
afterEach(() => rmSync(sandbox.home, { recursive: true, force: true }))

describe('staged CLI packages', () => {
  it('leaves the previous package intact when downloaded code cannot run', async () => {
    const paths = managedCliPaths('codex')
    mkdirSync(paths.prefix, { recursive: true })
    writeFileSync(join(paths.prefix, 'previous-working-cli'), 'old')
    sandbox.exec.mockImplementationOnce(sandbox.exec.getMockImplementation()!)
      .mockRejectedValueOnce(new Error('Downloaded package cannot start'))
    await expect(installManagedPackage('codex', vi.fn())).rejects.toThrow('cannot start')
    expect(existsSync(join(paths.prefix, 'previous-working-cli'))).toBe(true)
    expect(readdirSync(paths.root).some((name) => name.startsWith('codex-install-'))).toBe(false)
  })
  it('verifies the package before replacing the previous installation', async () => {
    const paths = managedCliPaths('codex')
    mkdirSync(paths.prefix, { recursive: true })
    writeFileSync(join(paths.prefix, 'previous-working-cli'), 'old')
    const verifying = vi.fn(() => expect(existsSync(join(paths.prefix, 'previous-working-cli'))).toBe(true))
    await installManagedPackage('codex', verifying)
    expect(verifying).toHaveBeenCalledOnce()
    expect(existsSync(join(paths.prefix, 'previous-working-cli'))).toBe(false)
    expect(existsSync(join(paths.prefix, ...(process.platform === 'win32' ? [] : ['lib']), 'node_modules', '@openai/codex', 'index.js'))).toBe(true)
  })
})
