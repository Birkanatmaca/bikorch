import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const files = vi.hoisted(() => new Set<string>())
vi.mock('fs', () => ({ existsSync: (path: string) => files.has(path), readdirSync: () => [] }))
vi.mock('os', () => ({ homedir: () => '/bikorch-test-user' }))
import { detectCli, enrichedPath } from '../adapters'
import { managedCliPaths } from '../managed-paths'

beforeEach(() => { files.clear(); vi.stubEnv('PATH', '/bikorch-test-bin') })
afterEach(() => vi.unstubAllEnvs())

describe('CLI availability', () => {
  it('does not confuse Cursor desktop with the agent CLI', () => {
    for (const name of ['cursor', 'cursor.cmd', 'cursor.exe']) files.add(join('/bikorch-test-bin', name))
    expect(detectCli('cursor')).toEqual({ installed: false, command: null })
    files.add(join('/bikorch-test-bin', process.platform === 'win32' ? 'agent.cmd' : 'agent'))
    expect(detectCli('cursor').installed).toBe(true)
  })

  it('detects managed packages immediately without changing the system PATH', () => {
    const paths = managedCliPaths()
    files.add(paths.nodeBin)
    files.add(paths.packageBin)
    files.add(join(paths.packageBin, process.platform === 'win32' ? 'gemini.cmd' : 'gemini'))
    expect(enrichedPath()).toContain(paths.nodeBin)
    expect(detectCli('gemini').installed).toBe(true)
    expect(process.env.PATH).toBe('/bikorch-test-bin')
  })
})
