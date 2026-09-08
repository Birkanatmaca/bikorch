import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WebContents } from 'electron'

const mocks = vi.hoisted(() => ({ spawn: vi.fn(() => ({ kill: vi.fn(), onData: vi.fn(), onExit: vi.fn(), resize: vi.fn() })) }))
vi.mock('@homebridge/node-pty-prebuilt-multiarch', () => ({ spawn: mocks.spawn }))
vi.mock('../adapters', () => ({ resolveSpawnConfigCandidates: () => [{ command: 'agent', args: [] }],
  getKindLabel: () => 'Cursor', spawnEnv: () => ({ CURSOR_API_KEY: 'inherited-key' }) }))
vi.mock('../path-validator', () => ({ isValidSessionId: () => true, resolveSafeCwd: () => '.' }))
vi.mock('../../accounts/profile-manager', () => ({ prepareAuthProfileLaunch: async () => ({ ok: true, ready: true }),
  getAuthProfileEnv: (_kind: string, id: string) => ({ APPDATA: `profile-${id}`, CURSOR_API_KEY: '' }) }))
vi.mock('../../accounts/antigravity-logout', () => ({ logoutAntigravityCli: vi.fn() }))
vi.mock('../../accounts/antigravity-credential', () => ({ markAntigravitySessionAccount: vi.fn() }))
vi.mock('../../accounts/cursor-profile', () => ({ withCursorAccountLock: (_id: string, task: () => Promise<unknown>) => task() }))
vi.mock('../../logs', () => ({ recordLog: vi.fn() }))
import { ptyManager } from '../pty-manager'

const contents = { isDestroyed: () => false, send: vi.fn() } as unknown as WebContents
afterEach(() => { ptyManager.killAll(); vi.clearAllMocks() })

describe('Cursor terminal isolation', () => {
  it('opens both accounts and logs out only the selected account', async () => {
    await ptyManager.create({ sessionId: 'session-a', kind: 'cursor', accountId: 'a', cwd: '.' }, contents)
    await ptyManager.create({ sessionId: 'session-b', kind: 'cursor', accountId: 'b', cwd: '.' }, contents)
    const [a, b] = mocks.spawn.mock.results.map((result) => result.value)
    expect(a.kill).not.toHaveBeenCalled()
    expect(b.kill).not.toHaveBeenCalled()
    expect(mocks.spawn).toHaveBeenNthCalledWith(1, 'agent', [], expect.objectContaining({ env: { APPDATA: 'profile-a', CURSOR_API_KEY: '' } }))
    expect(mocks.spawn).toHaveBeenNthCalledWith(2, 'agent', [], expect.objectContaining({ env: { APPDATA: 'profile-b', CURSOR_API_KEY: '' } }))
    ptyManager.killForAccount('cursor', 'a')
    expect(a.kill).toHaveBeenCalledTimes(1)
    expect(b.kill).not.toHaveBeenCalled()
  })

  it('relogin closes only the same account terminal and leaves the other account running', async () => {
    await ptyManager.create({ sessionId: 'a', kind: 'cursor', accountId: 'a', cwd: '.' }, contents)
    await ptyManager.create({ sessionId: 'b', kind: 'cursor', accountId: 'b', cwd: '.' }, contents)
    const [a, b] = mocks.spawn.mock.results.map((result) => result.value)
    await ptyManager.create({ sessionId: 'a-login', kind: 'cursor', accountId: 'a', launchMode: 'login', cwd: '.' }, contents)
    expect(a.kill).toHaveBeenCalledTimes(1)
    expect(b.kill).not.toHaveBeenCalled()
    expect(mocks.spawn).toHaveBeenLastCalledWith('agent', ['login'], expect.objectContaining({ env: { APPDATA: 'profile-a', CURSOR_API_KEY: '' } }))
  })

  it('rejects an unscoped Cursor launch instead of falling back to a shared login', async () => {
    const result = await ptyManager.create({ sessionId: 'global', kind: 'cursor', cwd: '.' }, contents)
    expect(result.status).toBe('error')
    expect(mocks.spawn).not.toHaveBeenCalled()
  })
})
