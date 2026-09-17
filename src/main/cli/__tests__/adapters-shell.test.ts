import { afterEach, describe, expect, it } from 'vitest'
import { cliLaunchArgs, enrichedPath, getDefaultShell, resolveSpawnConfigCandidates } from '../adapters'
import { existsSync } from 'fs'

describe('getDefaultShell', () => {
  const originalPlatform = process.platform
  const originalShell = process.env.SHELL

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform })
    if (originalShell === undefined) delete process.env.SHELL
    else process.env.SHELL = originalShell
  })

  it('starts unix shells as login shells so PATH matches Terminal.app', () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' })
    process.env.SHELL = '/bin/zsh'

    const shell = getDefaultShell()
    expect(shell.command).toBe('/bin/zsh')
    expect(shell.args).toEqual(['-l'])
    expect(resolveSpawnConfigCandidates('terminal')[0]).toEqual(shell)
  })

  it('falls back to zsh on macOS when SHELL is unset', () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' })
    delete process.env.SHELL

    expect(getDefaultShell()).toEqual({ command: '/bin/zsh', args: ['-l'] })
  })
})

describe('cliLaunchArgs', () => {
  it('trusts Cursor workspaces in interactive agent sessions', () => {
    expect(cliLaunchArgs('cursor')).toEqual(['--trust'])
    expect(cliLaunchArgs('cursor', 'login')).toEqual(['login'])
    expect(cliLaunchArgs('gemini')).toEqual(['--skip-trust'])
    expect(cliLaunchArgs('claude')).toEqual([])
  })
})

describe('enrichedPath', () => {
  const originalPath = process.env.PATH

  afterEach(() => {
    process.env.PATH = originalPath
  })

  it('prepends common tool dirs missing from a GUI-style PATH', () => {
    if (process.platform === 'win32') return
    process.env.PATH = '/usr/bin:/bin:/usr/sbin:/sbin'

    const path = enrichedPath()
    const parts = path.split(':')

    if (existsSync('/opt/homebrew/bin')) {
      expect(parts[0]).toBe('/opt/homebrew/bin')
    } else if (existsSync('/usr/local/bin')) {
      expect(parts[0]).toBe('/usr/local/bin')
    }

    expect(path).toContain('/usr/bin')
    if (existsSync('/usr/local/bin')) {
      expect(path).toContain('/usr/local/bin')
      expect(parts.indexOf('/usr/local/bin')).toBeLessThan(parts.indexOf('/usr/bin'))
    }
  })
})
