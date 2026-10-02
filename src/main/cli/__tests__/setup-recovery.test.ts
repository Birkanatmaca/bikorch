import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const sandbox = vi.hoisted(() => ({ root: '' }))
vi.mock('../managed-paths', () => ({ managedCliPaths: (kind?: string) => ({ root: sandbox.root, runtime: sandbox.root + '/node', prefix: sandbox.root + '/packages/' + kind }) }))
import { recoverDirectory, replaceDirectory } from '../atomic-directory'

beforeEach(() => { sandbox.root = mkdtempSync(join(tmpdir(), 'bikorch-setup-recovery-')) })
afterEach(() => { rmSync(sandbox.root, { recursive: true, force: true }) })

describe('interrupted setup recovery', () => {
  it('retains retry state across process restarts', async () => {
    writeFileSync(join(sandbox.root, 'setup-state.json'), JSON.stringify({ kind: 'codex', phase: 'installing', startedAt: 1, updatedAt: 2 }))
    vi.resetModules()
    const state = await import('../install-state')
    expect(state.getCliSetupSnapshot().installation).toMatchObject({ kind: 'codex', phase: 'interrupted', error: expect.stringContaining('continue') })
    vi.resetModules()
    expect((await import('../install-state')).getCliSetupSnapshot().installation?.phase).toBe('interrupted')
  })
  it('rolls back the old runtime if replacement fails', async () => {
    const target = join(sandbox.root, 'node')
    mkdirSync(target); writeFileSync(join(target, 'existing'), 'working')
    await expect(replaceDirectory(join(sandbox.root, 'missing-download'), target)).rejects.toThrow()
    expect(readFileSync(join(target, 'existing'), 'utf8')).toBe('working')
  })
  it('restores a backup left between directory renames', () => {
    const target = join(sandbox.root, 'node')
    mkdirSync(target); writeFileSync(join(target, 'existing'), 'working')
    renameSync(target, `${target}.previous`)
    recoverDirectory(target)
    expect(existsSync(join(target, 'existing'))).toBe(true)
    expect(existsSync(`${target}.previous`)).toBe(false)
  })
  it('rejects replacement paths outside its managed root', async () => {
    await expect(replaceDirectory(join(sandbox.root, 'staging'), join(sandbox.root, '..', 'outside'))).rejects.toThrow('Invalid managed tool path')
  })

  it('removes abandoned staging directories while keeping managed installations and other files', async () => {
    for (const name of ['node-install-Abc123', 'gemini-install-Def456', 'codex-install-Ghi789', 'packages', 'keep-me']) mkdirSync(join(sandbox.root, name))
    vi.resetModules()
    await (await import('../setup-recovery')).initializeManagedSetup()
    expect(existsSync(join(sandbox.root, 'node-install-Abc123'))).toBe(false)
    expect(existsSync(join(sandbox.root, 'gemini-install-Def456'))).toBe(false)
    expect(existsSync(join(sandbox.root, 'codex-install-Ghi789'))).toBe(false)
    expect(existsSync(join(sandbox.root, 'packages'))).toBe(true)
    expect(existsSync(join(sandbox.root, 'keep-me'))).toBe(true)
  })
})
