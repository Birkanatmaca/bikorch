import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WebContents } from 'electron'

const mocks = vi.hoisted(() => ({
  disconnect: vi.fn(),
  spawnHost: vi.fn(async () => ({ status: 'error' as const, error: 'spawn failed' }))
}))

vi.mock('@homebridge/node-pty-prebuilt-multiarch', () => ({
  spawn: vi.fn(() => {
    throw new Error('in-process spawn should not run while host is connected')
  })
}))
vi.mock('../adapters', () => ({
  resolveSpawnConfigCandidates: () => [{ command: 'agent', args: [] }],
  getKindLabel: () => 'Claude',
  spawnEnv: () => ({}),
  cliLaunchArgs: () => []
}))
vi.mock('../path-validator', () => ({ isValidSessionId: () => true, resolveSafeCwd: () => '.' }))
vi.mock('../../accounts/profile-manager', () => ({
  prepareAuthProfileLaunch: async () => ({ ok: true, ready: true }),
  getAuthProfileEnv: () => ({})
}))
vi.mock('../../accounts/antigravity-logout', () => ({ logoutAntigravityCli: vi.fn() }))
vi.mock('../../accounts/antigravity-credential', () => ({ markAntigravitySessionAccount: vi.fn() }))
vi.mock('../../accounts/cursor-profile', () => ({
  withCursorAccountLock: (_id: string, task: () => Promise<unknown>) => task()
}))
vi.mock('../pty-host/client', () => ({
  ptyHostClient: {
    ensureConnected: async () => true,
    onMessage: () => () => {},
    spawn: mocks.spawnHost,
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    replay: vi.fn(),
    disconnect: mocks.disconnect,
    isConnected: () => true,
    isHostAlive: () => true,
    hostPid: () => 1,
    runningSessionCount: () => 0
  }
}))
vi.mock('../../logs', () => ({ recordLog: vi.fn() }))

import { ptyManager } from '../pty-manager'

const contents = { isDestroyed: () => false, send: vi.fn() } as unknown as WebContents

describe('PTY host failed spawn', () => {
  afterEach(() => {
    ptyManager.killAll()
    vi.clearAllMocks()
    vi.useRealTimers()
  })

  it('releases the host when every spawn candidate fails', async () => {
    vi.useFakeTimers()
    const result = await ptyManager.create(
      { sessionId: 'failed-host', kind: 'claude', cwd: '.' },
      contents
    )
    expect(result.status).toBe('error')
    expect(mocks.spawnHost).toHaveBeenCalled()
    expect(mocks.disconnect).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(8_000)
    expect(mocks.disconnect).toHaveBeenCalledTimes(1)
  })
})
