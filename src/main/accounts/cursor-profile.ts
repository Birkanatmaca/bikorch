import { app, safeStorage } from 'electron'
import { createHash } from 'crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { dirname, join } from 'path'
import type { AuthProfileIdentity, AuthProfileRequest } from '@shared/contracts/auth-profiles'
import { identityFromCursorJwt, type CursorTokenIdentity } from './cursor-identity'
import { readCursorKeychainTokens } from './cursor-credential'

type JsonRecord = Record<string, unknown>
interface CursorTokens { accessToken: string; refreshToken: string }
export interface CursorIdentity extends AuthProfileIdentity { subject: string }

// The CLI's file store is selected explicitly. On Windows it lives under APPDATA,
// independently of CURSOR_CONFIG_DIR; changing only that directory does not isolate login.
export function cursorProfilePaths(accountId: string) {
  const key = createHash('sha256').update(accountId).digest('hex').slice(0, 32)
  const root = join(app.getPath('userData'), 'cli-profiles', 'cursor', key)
  const home = join(root, 'home')
  const roaming = join(root, 'roaming')
  const xdg = join(root, 'xdg')
  return {
    root, home, roaming, xdg,
    config: join(root, '.cursor', 'cli-config.json'),
    metadata: join(root, 'profile.json'),
    backup: join(root, 'cursor-credentials.bin'),
    auth: process.platform === 'win32' ? join(roaming, 'Cursor', 'auth.json')
      : process.platform === 'darwin' ? join(home, '.cursor', 'auth.json')
        : join(xdg, 'cursor', 'auth.json')
  }
}

function readJson(path: string): JsonRecord | null {
  try {
    const value: unknown = JSON.parse(readFileSync(path, 'utf8'))
    return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : null
  } catch { return null }
}

function saveJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  writeFileSync(path, JSON.stringify(value, null, 2), { mode: 0o600 })
}

function tokensFrom(value: JsonRecord | null): CursorTokens | null {
  if (typeof value?.accessToken !== 'string' || typeof value.refreshToken !== 'string') return null
  if (!value.accessToken || !value.refreshToken) return null
  return { accessToken: value.accessToken, refreshToken: value.refreshToken }
}

function readBackup(accountId: string): CursorTokens | null {
  try {
    if (!safeStorage.isEncryptionAvailable()) return null
    const value = JSON.parse(safeStorage.decryptString(readFileSync(cursorProfilePaths(accountId).backup)))
    const tokens = tokensFrom(value)
    if (!tokens) return null
    // Earlier Windows snapshots stored the raw Credential Manager bytes as base64.
    if (!identityFromCursorJwt(tokens.accessToken)) {
      for (const encoding of ['utf8', 'utf16le'] as const) {
        const accessToken = Buffer.from(tokens.accessToken, 'base64').toString(encoding).replace(/\0+$/, '')
        if (identityFromCursorJwt(accessToken)) {
          return { accessToken, refreshToken: Buffer.from(tokens.refreshToken, 'base64').toString(encoding).replace(/\0+$/, '') }
        }
      }
      return null
    }
    return tokens
  } catch { return null }
}

function configForAccount(accountId: string): JsonRecord | null {
  const paths = cursorProfilePaths(accountId)
  return readJson(paths.config) ?? readJson(join(paths.root, 'cli-config.json')) ??
    readJson(join(paths.root, 'config', 'cli-config.json'))
}

export function cursorExpectedIdentity(accountId: string): CursorTokenIdentity {
  const metadata = readJson(cursorProfilePaths(accountId).metadata)
  const auth = configForAccount(accountId)?.authInfo as JsonRecord | undefined
  return {
    subject: typeof metadata?.authSubject === 'string' ? metadata.authSubject
      : typeof auth?.authId === 'string' ? auth.authId : undefined,
    email: typeof metadata?.email === 'string' && metadata.email ? metadata.email
      : typeof auth?.email === 'string' ? auth.email : undefined,
    name: typeof auth?.displayName === 'string' ? auth.displayName : undefined
  }
}

export function cursorProfileEnv(accountId: string): Record<string, string> {
  const paths = cursorProfilePaths(accountId)
  return {
    CURSOR_CONFIG_DIR: dirname(paths.config),
    CURSOR_DATA_DIR: join(paths.root, 'data'),
    AGENT_CLI_CREDENTIAL_STORE: 'file',
    CURSOR_API_KEY: '',
    ...(process.platform === 'win32' ? { APPDATA: paths.roaming }
      : process.platform === 'darwin' ? { HOME: paths.home } : { XDG_CONFIG_HOME: paths.xdg })
  }
}

function systemAuthPath(): string {
  if (process.platform === 'win32') return join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'Cursor', 'auth.json')
  if (process.platform === 'darwin') return join(homedir(), '.cursor', 'auth.json')
  return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'cursor', 'auth.json')
}

async function systemTokens(): Promise<CursorTokens | null> {
  const file = tokensFrom(readJson(systemAuthPath()))
  if (file) return file
  // Read-only legacy import. No account operation writes to the shared keychain.
  return process.platform === 'darwin' ? readCursorKeychainTokens() : null
}

export function readCursorProfileTokens(accountId: string): CursorTokens | null {
  return tokensFrom(readJson(cursorProfilePaths(accountId).auth))
}

export function hasCursorProfileCredentials(accountId: string): boolean {
  const tokens = readCursorProfileTokens(accountId)
  if (!tokens) return false
  const metadata = readJson(cursorProfilePaths(accountId).metadata)
  if (metadata?.cursorIsolationVersion !== 1 || typeof metadata.authSubject !== 'string') return false
  const expected = cursorExpectedIdentity(accountId)
  const actual = identityFromCursorJwt(tokens.accessToken)
  return Boolean(actual?.subject && (!expected.subject || actual.subject === expected.subject))
}

export async function prepareCursorProfile(accountId: string): Promise<boolean> {
  const paths = cursorProfilePaths(accountId)
  const metadata = readJson(paths.metadata) ?? { kind: 'cursor', accountId }
  const existing = readCursorProfileTokens(accountId)
  if (existing) return hasCursorProfileCredentials(accountId)
  // A logged-out or already-migrated account must never inherit the system login.
  if (metadata.cursorIsolationVersion === 1) return false
  const expected = cursorExpectedIdentity(accountId)
  if (!expected.subject) return false
  let tokens = readBackup(accountId)
  if (!tokens || !expected.subject || identityFromCursorJwt(tokens.accessToken)?.subject !== expected.subject) {
    const current = await systemTokens()
    tokens = expected.subject && current && identityFromCursorJwt(current.accessToken)?.subject === expected.subject
      ? current : null
  }
  if (!tokens) return false
  const identity = await verifyCursorIdentity(tokens.accessToken, expected).catch(() => null)
  if (!identity) return false
  saveJson(paths.config, configForAccount(accountId) ?? {})
  saveJson(paths.auth, tokens)
  saveJson(paths.metadata, { ...metadata, cursorIsolationVersion: 1, authSubject: identity.subject, email: identity.email })
  return true
}

export class CursorAccountError extends Error {
  constructor(message: string, readonly needsLogin = false) { super(message) }
}

export async function cursorDashboardRequest(token: string, method: string): Promise<JsonRecord> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(`https://api2.cursor.sh/aiserver.v1.DashboardService/${method}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Connect-Protocol-Version': '1' },
        body: '{}',
        signal: AbortSignal.timeout(5000)
      })
      if (response.status === 401) throw new CursorAccountError('Bu Cursor oturumunun süresi dolmuş. Bu hesaba yeniden giriş yapın.', true)
      if (response.status >= 500 && attempt === 0) continue
      if (!response.ok) throw new CursorAccountError(`Cursor limit servisi yanıt vermedi (HTTP ${response.status}). Tekrar kontrol edin.`)
      return await response.json() as JsonRecord
    } catch (error) {
      if (error instanceof CursorAccountError) throw error
      if (attempt === 1) throw new CursorAccountError('Cursor servisine ulaşılamadı. Bağlantınızı kontrol edip tekrar deneyin.')
    }
  }
  throw new CursorAccountError('Cursor servisine ulaşılamadı.')
}

export async function verifyCursorIdentity(token: string, expected: CursorTokenIdentity): Promise<CursorIdentity> {
  const me = await cursorDashboardRequest(token, 'GetMe')
  const subject = typeof me.authId === 'string' ? me.authId : ''
  const email = typeof me.email === 'string' ? me.email : ''
  const tokenSubject = identityFromCursorJwt(token)?.subject
  if (!subject || !email || (tokenSubject && subject !== tokenSubject) ||
    (expected.subject && subject !== expected.subject) ||
    (expected.email && expected.email.toLowerCase() !== email.toLowerCase())) {
    throw new CursorAccountError('Cursor oturumu bu hesaba ait değil. Doğru hesapla yeniden giriş yapın.', true)
  }
  return { subject, email, name: [me.firstName, me.lastName].filter((v) => typeof v === 'string' && v).join(' ') || email }
}

function assertNotDuplicate(accountId: string, identity: CursorIdentity): void {
  const root = join(app.getPath('userData'), 'cli-profiles', 'cursor')
  if (!existsSync(root)) return
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const meta = readJson(join(root, entry.name, 'profile.json'))
    if (typeof meta?.accountId !== 'string' || meta.accountId === accountId) continue
    const other = cursorExpectedIdentity(meta.accountId)
    if (hasCursorProfileCredentials(meta.accountId) &&
      (other.subject === identity.subject || other.email?.toLowerCase() === identity.email.toLowerCase())) {
      throw new CursorAccountError('Bu Cursor hesabı zaten kayıtlı. Mevcut hesap kartını kullanın.')
    }
  }
}

export async function captureCursorProfile(request: AuthProfileRequest): Promise<CursorIdentity | null> {
  const paths = cursorProfilePaths(request.accountId)
  const metadata = readJson(paths.metadata)
  // Only an explicit system import may read global credentials. Login capture is profile-only.
  const importing = request.source === 'system'
  const tokens = importing ? await systemTokens() : readCursorProfileTokens(request.accountId)
  if (!tokens) return null
  const expected = cursorExpectedIdentity(request.accountId)
  let identity: CursorIdentity
  try {
    identity = await verifyCursorIdentity(tokens.accessToken, {
      ...expected, email: expected.email || request.email
    })
    assertNotDuplicate(request.accountId, identity)
  } catch (error) {
    if (!importing && error instanceof CursorAccountError &&
      (error.needsLogin || error.message.includes('zaten kayıtlı'))) logoutCursorProfile(request.accountId)
    throw error
  }
  if (importing) {
    const config = readJson(join(homedir(), '.cursor', 'cli-config.json')) ?? {}
    saveJson(paths.config, { ...config, authInfo: { authId: identity.subject, email: identity.email, displayName: identity.name } })
    saveJson(paths.auth, tokens)
  }
  if (safeStorage.isEncryptionAvailable()) {
    mkdirSync(paths.root, { recursive: true, mode: 0o700 })
    writeFileSync(paths.backup, safeStorage.encryptString(JSON.stringify(tokens)), { mode: 0o600 })
  }
  saveJson(paths.metadata, { ...metadata, kind: 'cursor', accountId: request.accountId,
    email: identity.email, name: identity.name, authSubject: identity.subject,
    cursorIsolationVersion: 1, updatedAt: Date.now() })
  return identity
}

export function logoutCursorProfile(accountId: string): void {
  const paths = cursorProfilePaths(accountId)
  const metadata = readJson(paths.metadata) ?? { kind: 'cursor', accountId }
  const config = configForAccount(accountId) ?? {}
  const expected = cursorExpectedIdentity(accountId)
  delete config.authInfo
  saveJson(paths.config, config)
  // Exact account-owned credential files only; settings and conversation data are preserved.
  for (const path of [paths.auth, paths.backup]) if (existsSync(path)) rmSync(path)
  saveJson(paths.metadata, { ...metadata, ...(expected.subject ? { authSubject: expected.subject } : {}),
    cursorIsolationVersion: 1, updatedAt: Date.now() })
}

export async function inspectSystemCursor(): Promise<AuthProfileIdentity | null> {
  const tokens = await systemTokens()
  if (!tokens) return null
  return verifyCursorIdentity(tokens.accessToken, {})
}

const accountQueues = new Map<string, Promise<unknown>>()
export function withCursorAccountLock<T>(accountId: string, task: () => Promise<T>): Promise<T> {
  const previous = accountQueues.get(accountId) ?? Promise.resolve()
  const result = previous.catch(() => undefined).then(task)
  accountQueues.set(accountId, result)
  void result.finally(() => { if (accountQueues.get(accountId) === result) accountQueues.delete(accountId) }).catch(() => undefined)
  return result
}
