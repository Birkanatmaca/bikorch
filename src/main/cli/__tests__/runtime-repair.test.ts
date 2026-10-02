import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'

const mocks = vi.hoisted(() => ({ root: '', exec: vi.fn(), fetch: vi.fn() }))
vi.mock('os', async () => ({ ...await vi.importActual<typeof import('os')>('os'), homedir: () => mocks.root }))
vi.mock('util', () => ({ promisify: () => mocks.exec }))
vi.mock('../adapters', () => ({ terminalUserEnv: () => ({}) }))
import { ensureManagedNode } from '../install-runtime'
import { managedCliPaths } from '../managed-paths'

beforeEach(() => {
  mocks.root = mkdtempSync(join(tmpdir(), 'bikorch-runtime-repair-'))
  mocks.exec.mockReset()
  mocks.fetch.mockReset()
  vi.stubGlobal('fetch', mocks.fetch)
})
afterEach(() => { vi.unstubAllGlobals(); rmSync(mocks.root, { recursive: true, force: true }) })

function seedPartialRuntime(): void {
  const paths = managedCliPaths()
  for (const entry of [paths.node, paths.npm]) { mkdirSync(dirname(entry), { recursive: true }); writeFileSync(entry, 'partial') }
}

describe('runtime repair', () => {
  it('reuses Node only when both Node and npm start successfully', async () => {
    seedPartialRuntime()
    mocks.exec.mockResolvedValueOnce({ stdout: 'v22.23.3' }).mockResolvedValueOnce({ stdout: '10.9.6' })
    await ensureManagedNode()
    expect(mocks.exec).toHaveBeenCalledTimes(2)
    expect(mocks.fetch).not.toHaveBeenCalled()
  })
  it('attempts repair when npm is broken and retains the old runtime on network failure', async () => {
    seedPartialRuntime()
    mocks.exec.mockResolvedValueOnce({ stdout: 'v22.23.3' }).mockRejectedValueOnce(new Error('Broken npm'))
    mocks.fetch.mockRejectedValue(new Error('Network unavailable'))
    await expect(ensureManagedNode()).rejects.toThrow('Network unavailable')
    expect(mocks.fetch).toHaveBeenCalledOnce()
    expect(existsSync(managedCliPaths().node)).toBe(true)
  })
  it('rejects corrupted archives and removes staging data without replacing the runtime', async () => {
    seedPartialRuntime()
    mocks.exec.mockRejectedValueOnce(new Error('Broken Node'))
    const name = `node-v22.23.3-${process.platform === 'win32' ? 'win' : process.platform}-${process.arch}.${process.platform === 'win32' ? 'zip' : 'tar.gz'}`
    mocks.fetch.mockResolvedValueOnce(new Response(`${'a'.repeat(64)}  ${name}`))
      .mockResolvedValueOnce(new Response('corrupted archive'))
    await expect(ensureManagedNode()).rejects.toThrow('checksum')
    expect(existsSync(managedCliPaths().node)).toBe(true)
    expect(readdirSync(managedCliPaths().root).some((entry) => entry.startsWith('node-install-'))).toBe(false)
  })
})
