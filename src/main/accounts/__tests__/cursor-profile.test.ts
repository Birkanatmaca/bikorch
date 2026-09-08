import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { tmpdir } from 'os'

const sandbox = vi.hoisted(() => ({ root: '' }))
vi.mock('electron', () => ({
  app: { getPath: () => sandbox.root },
  safeStorage: { isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from(s), decryptString: (s: Buffer) => s.toString() }
}))
vi.mock('../cursor-credential', () => ({ readCursorKeychainTokens: vi.fn(async () => null) }))

import {
  captureCursorProfile, cursorProfileEnv, cursorProfilePaths, hasCursorProfileCredentials,
  logoutCursorProfile, prepareCursorProfile, readCursorProfileTokens, withCursorAccountLock,
  cursorDashboardRequest
} from '../cursor-profile'
import { readCursorAccountUsage, parseCursorDashboardUsage } from '../../usage/cursor'

function jwt(subject: string): string {
  return `header.${Buffer.from(JSON.stringify({ sub: subject })).toString('base64url')}.signature`
}
function save(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(data))
}
function tokens(subject: string) { return { accessToken: jwt(subject), refreshToken: `refresh-${subject}` } }
function seed(accountId: string, subject = accountId): void {
  const paths = cursorProfilePaths(accountId)
  save(paths.metadata, { accountId, kind: 'cursor', email: `${subject}@example.com`, authSubject: subject, cursorIsolationVersion: 1 })
  save(paths.config, { authInfo: { authId: subject, email: `${subject}@example.com` }, model: subject })
  save(paths.auth, tokens(subject))
}

beforeEach(() => {
  sandbox.root = mkdtempSync(join(tmpdir(), 'bikorch-cursor-test-'))
  vi.stubEnv('APPDATA', join(sandbox.root, 'system'))
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    const token = (init.headers as Record<string, string>).Authorization.slice(7)
    const subject = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).sub
    const method = url.split('/').at(-1)
    const body = method === 'GetMe' ? { authId: subject, email: `${subject}@example.com`, firstName: subject }
      : method === 'GetCurrentPeriodUsage' ? { billingCycleStart: '1788157706000', billingCycleEnd: '1790749706000', planUsage: { totalPercentUsed: Number(subject.replace(/\D/g, '')) || 7 } }
        : method === 'GetPlanInfo' ? { planInfo: { planName: `Plan ${subject}` } } : { noUsageBasedAllowed: true }
    return new Response(JSON.stringify(body), { status: 200 })
  }))
})
afterEach(() => {
  vi.unstubAllGlobals(); vi.unstubAllEnvs()
  rmSync(sandbox.root, { recursive: true, force: true })
})

describe('isolated Cursor accounts', () => {
  it('gives every account its own auth, config and conversation directories', () => {
    const a = cursorProfileEnv('a'), b = cursorProfileEnv('b')
    expect(a.CURSOR_CONFIG_DIR).not.toBe(b.CURSOR_CONFIG_DIR)
    expect(a.CURSOR_DATA_DIR).not.toBe(b.CURSOR_DATA_DIR)
    expect(cursorProfilePaths('a').auth).not.toBe(cursorProfilePaths('b').auth)
    expect(a.AGENT_CLI_CREDENTIAL_STORE).toBe('file')
    expect(a.CURSOR_API_KEY).toBe('')
    if (process.platform === 'win32') expect(a.APPDATA).not.toBe(b.APPDATA)
  })

  it('captures the profile login even when the system is signed into another account', async () => {
    seed('a'); seed('b')
    save(join(process.env.APPDATA!, 'Cursor', 'auth.json'), tokens('b'))
    const systemBefore = readFileSync(join(process.env.APPDATA!, 'Cursor', 'auth.json'))
    expect((await captureCursorProfile({ kind: 'cursor', accountId: 'a', signedIn: true }))?.email).toBe('a@example.com')
    expect(readCursorProfileTokens('a')).toEqual(tokens('a'))
    expect(readFileSync(join(process.env.APPDATA!, 'Cursor', 'auth.json'))).toEqual(systemBefore)
  })

  it('never fills a new login with system credentials', async () => {
    save(join(process.env.APPDATA!, 'Cursor', 'auth.json'), tokens('b'))
    expect(await captureCursorProfile({ kind: 'cursor', accountId: 'new', signedIn: true })).toBeNull()
    expect(await prepareCursorProfile('new')).toBe(false)
  })

  it('binds a fresh login only after server verification and supports logout followed by login', async () => {
    logoutCursorProfile('new')
    save(cursorProfilePaths('new').auth, tokens('a'))
    expect(hasCursorProfileCredentials('new')).toBe(false)
    const request = { kind: 'cursor' as const, accountId: 'new' }
    expect((await captureCursorProfile(request))?.email).toBe('a@example.com')
    expect(hasCursorProfileCredentials('new')).toBe(true)
    logoutCursorProfile('new')
    save(cursorProfilePaths('new').auth, tokens('b'))
    await expect(captureCursorProfile(request)).rejects.toThrow('bu hesaba ait değil')
    expect(readCursorProfileTokens('new')).toBeNull()
    save(cursorProfilePaths('new').auth, tokens('a'))
    expect((await captureCursorProfile(request))?.email).toBe('a@example.com')
  })

  it('migrates a legacy credential only when its subject matches the saved account', async () => {
    const paths = cursorProfilePaths('legacy')
    save(paths.metadata, { accountId: 'legacy', email: 'a@example.com' })
    save(join(paths.root, 'config', 'cli-config.json'), { authInfo: { authId: 'a', email: 'a@example.com' } })
    save(paths.backup, tokens('b'))
    expect(await prepareCursorProfile('legacy')).toBe(false)
    save(paths.backup, tokens('a'))
    expect(await prepareCursorProfile('legacy')).toBe(true)
    expect(readCursorProfileTokens('legacy')).toEqual(tokens('a'))
  })

  it('logout affects only the selected account and cannot resurrect saved tokens', async () => {
    seed('a'); seed('b')
    await captureCursorProfile({ kind: 'cursor', accountId: 'a' })
    const bBefore = readFileSync(cursorProfilePaths('b').auth)
    const conversation = join(cursorProfilePaths('a').root, 'data', 'conversation.json')
    save(conversation, { text: 'keep my work' })
    logoutCursorProfile('a')
    expect(hasCursorProfileCredentials('a')).toBe(false)
    expect(existsSync(cursorProfilePaths('a').backup)).toBe(false)
    expect(await prepareCursorProfile('a')).toBe(false)
    expect(readFileSync(cursorProfilePaths('b').auth)).toEqual(bBefore)
    expect(existsSync(conversation)).toBe(true)
  })

  it('rejects a duplicate login without altering the original account', async () => {
    seed('original', 'a')
    save(cursorProfilePaths('new').auth, tokens('a'))
    await expect(captureCursorProfile({ kind: 'cursor', accountId: 'new' })).rejects.toThrow('zaten kayıtlı')
    expect(hasCursorProfileCredentials('new')).toBe(false)
    expect(readCursorProfileTokens('original')).toEqual(tokens('a'))
  })

  it('does not attach metrics from a mismatched server identity', async () => {
    seed('a')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ authId: 'b', email: 'b@example.com', planUsage: { totalPercentUsed: 89 } }))))
    const result = await readCursorAccountUsage('a')
    expect(result.status).toBe('unavailable')
    expect(result.identityVerified).toBe(false)
    expect(result.primary).toBeUndefined()
  })

  it('keeps 20 concurrent accounts and their metrics separate without changing auth files', async () => {
    const ids = Array.from({ length: 20 }, (_, i) => `user${i + 1}`)
    ids.forEach((id) => seed(id))
    const before = ids.map((id) => readFileSync(cursorProfilePaths(id).auth))
    const results = await Promise.all(ids.map(readCursorAccountUsage))
    results.forEach((result, i) => {
      expect(result.accountId).toBe(ids[i])
      expect(result.accountEmail).toBe(`${ids[i]}@example.com`)
      expect(result.primary?.usedPercent).toBe(i + 1)
      expect(result.identityVerified).toBe(true)
      expect(readFileSync(cursorProfilePaths(ids[i]).auth)).toEqual(before[i])
    })
  })

  it('coalesces duplicate usage checks for the same account', async () => {
    seed('a')
    const first = readCursorAccountUsage('a'), second = readCursorAccountUsage('a')
    expect(first).toBe(second)
    await first
    expect(fetch).toHaveBeenCalledTimes(4)
  })

  it('retries a transient service error once without changing the request account', async () => {
    const request = vi.fn().mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ planUsage: { totalPercentUsed: 20 } })))
    vi.stubGlobal('fetch', request)
    await expect(cursorDashboardRequest(jwt('a'), 'GetCurrentPeriodUsage')).resolves.toHaveProperty('planUsage')
    expect(request).toHaveBeenCalledTimes(2)
    for (const [, init] of request.mock.calls) expect(init.headers.Authorization).toBe(`Bearer ${jwt('a')}`)
  })

  it('bounds stalled network retries and never substitutes another account token', async () => {
    const request = vi.fn().mockRejectedValue(new DOMException('Timed out', 'TimeoutError'))
    vi.stubGlobal('fetch', request)
    await expect(cursorDashboardRequest(jwt('a'), 'GetMe')).rejects.toThrow('servisine ulaşılamadı')
    expect(request).toHaveBeenCalledTimes(2)
    for (const [, init] of request.mock.calls) expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it('reports expired sessions immediately without retrying or using system credentials', async () => {
    const request = vi.fn().mockResolvedValue(new Response('', { status: 401 }))
    vi.stubGlobal('fetch', request)
    await expect(cursorDashboardRequest(jwt('a'), 'GetMe')).rejects.toMatchObject({ needsLogin: true })
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('serializes account changes while allowing another account to proceed', async () => {
    const events: string[] = []
    let release!: () => void
    const waiting = new Promise<void>((resolve) => { release = resolve })
    const a = withCursorAccountLock('a', async () => { events.push('a-start'); await waiting; events.push('a-end') })
    const logout = withCursorAccountLock('a', async () => { events.push('a-logout') })
    await withCursorAccountLock('b', async () => { events.push('b-done') })
    expect(events).toContain('b-done')
    expect(events).not.toContain('a-logout')
    release(); await Promise.all([a, logout])
    expect(events.indexOf('a-logout')).toBeGreaterThan(events.indexOf('a-end'))
  })

  it('uses explicit quota percentages rather than incorrectly counting bonus spend', () => {
    const result = parseCursorDashboardUsage({ planUsage: { totalSpend: 48404, limit: 2000, includedSpend: 2000, totalPercentUsed: 97.78 } }, {}, {})
    expect(result.primary?.usedPercent).toBe(97.78)
  })
})
