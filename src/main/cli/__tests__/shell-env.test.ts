import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('child_process', () => ({
  execFileSync: vi.fn()
}))

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs')
  return {
    ...actual,
    existsSync: vi.fn(() => true)
  }
})

describe('loadUserShellEnv', () => {
  afterEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('merges login-shell PATH into process.env', async () => {
    if (process.platform === 'win32') return

    const { execFileSync } = await import('child_process')
    vi.mocked(execFileSync).mockReturnValue(
      'noise from oh-my-zsh\n__BIKORCH_ENV_START__\nPATH=/opt/homebrew/bin:/usr/bin\nFOO=bar\nELECTRON_RUN_AS_NODE=1\n'
    )

    const beforePath = process.env.PATH
    const { loadUserShellEnv } = await import('../shell-env')
    loadUserShellEnv()

    expect(process.env.PATH).toBe('/opt/homebrew/bin:/usr/bin')
    expect(process.env.FOO).toBe('bar')
    expect(process.env.ELECTRON_RUN_AS_NODE).not.toBe('1')

    process.env.PATH = beforePath
    delete process.env.FOO
  })
})
