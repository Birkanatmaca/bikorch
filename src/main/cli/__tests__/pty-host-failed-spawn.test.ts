import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WebContents } from 'electron'

const mocks = vi.hoisted(() => ({
  disconnect: vi.fn(),
  prepare: vi.fn(async () => ({ ok: true, ready: true })),
  snapshot: vi.fn(async () => null as import('@shared/contracts/pty').PtySessionSnapshot | null),
  replay: vi.fn(async () => ({ status: 'running', outputBuffer: '' })),
  hostListener: null as ((message: { type: string; payload: { type: string; sessionId: string; exitCode?: number } }) => void) | null,
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
  windowsPtySpawnOptions: () => [{}],
  cliLaunchArgs: () => []
}))
vi.mock('../path-validator', () => ({
  isValidSessionId: () => true,
  resolveSafeCwd: () => '.',
  resolveWindowsSpawnPath: (value: string) => value
}))
vi.mock('../../accounts/profile-manager', () => ({
  prepareAuthProfileLaunch: mocks.prepare,
  getAuthProfileEnv: () => ({})
}))
vi.mock('../../accounts/antigravity-logout', () => ({ logoutAntigravityCli: vi.fn() }))
vi.mock('../../accounts/antigravity-credential', () => ({
  markAntigravitySessionAccount: vi.fn(),
  finishAntigravityFreshLogin: vi.fn()
}))
vi.mock('../../accounts/cursor-profile', () => ({
  withCursorAccountLock: (_id: string, task: () => Promise<unknown>) => task()
}))
vi.mock('../pty-host/client', () => ({
  ptyHostClient: {
    ensureConnected: async () => true,
    onMessage: (listener: typeof mocks.hostListener) => { mocks.hostListener = listener; return () => {} },
    spawn: mocks.spawnHost,
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    replay: mocks.replay,
    snapshot: mocks.snapshot,
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
    mocks.snapshot.mockReset().mockResolvedValue(null)
    vi.useRealTimers()
  })

  it('releases the host when every spawn candidate fails', async () => {
    vi.useFakeTimers()
    const result = await ptyManager.create(
      { sessionId: 'failed-host', projectId: 'project-1234', kind: 'claude', cwd: '.' },
      contents
    )
    expect(result.status).toBe('error')
    expect(mocks.spawnHost).toHaveBeenCalled()
    expect(mocks.disconnect).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(8_000)
    expect(mocks.disconnect).toHaveBeenCalledTimes(1)
  })

  it('starts a new process after the previous retained session exits', async () => {
    vi.useFakeTimers()
    mocks.spawnHost.mockResolvedValueOnce({ status: 'running', error: '' } as never)
    const request = { sessionId: 'retry-host', projectId: 'project-1234', kind: 'claude' as const, cwd: '.' }
    expect((await ptyManager.create(request, contents)).status).toBe('running')
    mocks.hostListener?.({ type: 'event', payload: { type: 'exit', sessionId: request.sessionId, exitCode: 1 } })
    mocks.spawnHost.mockResolvedValueOnce({ status: 'running', error: '' } as never)
    const restarted = await ptyManager.create(request, contents)
    expect(restarted.status).toBe('running')
    expect(restarted.reattached).not.toBe(true)
    expect(mocks.spawnHost).toHaveBeenCalledTimes(2)
  })

  it('passes the pending login resume marker to profile preparation', async () => {
    vi.useFakeTimers()
    await ptyManager.create({ sessionId: 'resume-host', projectId: 'project-1234', kind: 'claude', cwd: '.', accountId: 'pending', launchMode: 'login', resumeLogin: true }, contents)
    expect(mocks.prepare).toHaveBeenCalledWith({ kind: 'claude', accountId: 'pending' }, 'login', true)
  })

  it('reattaches a login retained across app restart before preparing its profile again', async () => {
    vi.useFakeTimers()
    mocks.snapshot.mockResolvedValue({ sessionId: 'restored-host', projectId: 'project-1234', kind: 'claude', accountId: 'pending', cwd: '.', status: 'running' })
    const result = await ptyManager.create({ sessionId: 'restored-host', projectId: 'project-1234', kind: 'claude', accountId: 'pending', cwd: '.', launchMode: 'login', resumeLogin: true }, contents)
    expect(result.reattached).toBe(true)
    expect(mocks.prepare).not.toHaveBeenCalled()
    expect(mocks.spawnHost).not.toHaveBeenCalled()
  })

  it('rejects a retained host session with a different workspace owner', async () => {
    vi.useFakeTimers()
    mocks.snapshot.mockResolvedValue({ sessionId: 'wrong-owner', projectId: 'original-project', kind: 'claude', cwd: '.', status: 'running' })
    expect((await ptyManager.create({ sessionId: 'wrong-owner', projectId: 'project-1234', kind: 'claude', cwd: '.' }, contents)).status).toBe('error')
    expect(mocks.spawnHost).not.toHaveBeenCalled()
  })
})
