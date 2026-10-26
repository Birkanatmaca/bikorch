import { app, safeStorage } from 'electron'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'fs'
import { createHash } from 'crypto'
import { homedir } from 'os'
import { dirname, join, resolve, sep } from 'path'
import type {
  AuthProfileIdentity,
  AuthProfileRequest,
  AuthProfileResult,
  AuthProfileSummary,
  SystemAuthDiscovery
} from '@shared/contracts/auth-profiles'
import { AI_ACCOUNT_KINDS, AI_ACCOUNT_LABELS } from '@shared/contracts/accounts'
import { cleanCliLabel } from '@shared/terminal-text'
import type { CliUsageKind } from '@shared/contracts/usage'
import {
  readAntigravityCredential
} from './windows-credential'
import {
  captureCursorProfile, cursorExpectedIdentity, cursorProfileEnv,
  hasCursorProfileCredentials, inspectSystemCursor, logoutCursorProfile, prepareCursorProfile,
  withCursorAccountLock
} from './cursor-profile'
import { logoutAntigravityCli } from './antigravity-logout'
import {
  importSystemClaudeLogin,
  inspectClaudeLogin,
  inspectClaudeLoginFiles,
  logoutClaudeProfile
} from './claude-credential'
import { findApiKey, readApiKeySecret } from '../api-keys/vault'
import { API_KEY_PROVIDER_CLI, type ApiKeyProvider } from '@shared/contracts/api-keys'
import {
  applyAntigravityCredentialsForAccount,
  captureAntigravityLogin,
  hasStoredAntigravityCredentials,
  markAntigravitySessionAccount,
  prepareAntigravityFreshLogin,
  readStoredAntigravitySecret
} from './antigravity-credential'

type JsonRecord = Record<string, unknown>

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : null
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function readJson(path: string): JsonRecord | null {
  try {
    return asRecord(JSON.parse(readFileSync(path, 'utf8')))
  } catch {
    return null
  }
}

function decodeJwtPayload(token: string): JsonRecord | null {
  const encoded = token.split('.')[1]
  if (!encoded) return null
  try {
    const normalized = encoded.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
    return asRecord(JSON.parse(Buffer.from(padded, 'base64').toString('utf8')))
  } catch {
    return null
  }
}

function getNestedString(value: unknown, keys: string[]): string | undefined {
  let current = value
  for (const key of keys) {
    const record = asRecord(current)
    if (!record) return undefined
    current = record[key]
  }
  return asString(current)
}

function profileKey(accountId: string): string {
  return createHash('sha256').update(accountId).digest('hex').slice(0, 32)
}

function profilesRoot(): string {
  return join(app.getPath('userData'), 'cli-profiles')
}

export function getAuthProfileRoot(kind: CliUsageKind, accountId: string): string {
  return join(profilesRoot(), kind, profileKey(accountId))
}

function ensureProfileRoot(kind: CliUsageKind, accountId: string): string {
  const root = getAuthProfileRoot(kind, accountId)
  mkdirSync(root, { recursive: true })
  return root
}

function removeProfileDirectory(kind: CliUsageKind, accountId: string): void {
  const root = resolve(getAuthProfileRoot(kind, accountId))
  const expectedRoot = `${resolve(profilesRoot())}${sep}`
  if (!root.startsWith(expectedRoot)) throw new Error('Invalid account profile path')
  if (existsSync(root)) rmSync(root, { recursive: true, force: true })
}

function copyIfPresent(source: string, target: string): boolean {
  if (!existsSync(source)) return false
  mkdirSync(dirname(target), { recursive: true })
  copyFileSync(source, target)
  return true
}

function metadataPath(kind: CliUsageKind, accountId: string): string {
  return join(getAuthProfileRoot(kind, accountId), 'profile.json')
}

function writeMetadata(request: AuthProfileRequest): void {
  const root = ensureProfileRoot(request.kind, request.accountId)
  const current = readJson(join(root, 'profile.json')) ?? {}
  writeFileSync(
    join(root, 'profile.json'),
    JSON.stringify(
      {
        ...current,
        kind: request.kind,
        accountId: request.accountId,
        ...(request.email ? { email: cleanCliLabel(request.email) } : {}),
        updatedAt: Date.now()
      },
      null,
      2
    ),
    'utf8'
  )
}

function readMetadataIdentity(kind: CliUsageKind, accountId: string): AuthProfileIdentity | undefined {
  const metadata = readJson(metadataPath(kind, accountId))
  const email = asString(metadata?.email)
  const name = asString(metadata?.name)
  if (!email && !name) return undefined
  const cleanEmail = email ? cleanCliLabel(email) : ''
  const cleanName = name ? cleanCliLabel(name) : cleanEmail
  return { email: cleanEmail, name: cleanName }
}

/** API key bound to this account, when the account signs in with a key instead of OAuth. */
function boundApiKeyId(kind: CliUsageKind, accountId: string): string | null {
  const metadata = readJson(metadataPath(kind, accountId))
  const id = asString(metadata?.apiKeyId)
  return id && findApiKey(id) ? id : null
}

const API_KEY_ENV: Partial<Record<CliUsageKind, string>> = {
  claude: 'ANTHROPIC_API_KEY',
  gemini: 'GEMINI_API_KEY'
}

function mergeJsonFile(path: string, patch: (current: JsonRecord) => JsonRecord): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(patch(readJson(path) ?? {}), null, 2), { encoding: 'utf8', mode: 0o600 })
}

/**
 * Turns an account into an API-key account: the key is handed to that
 * account's CLI only, and each CLI is told to use it without asking.
 */
export function connectApiKeyProfile(kind: CliUsageKind, accountId: string, keyId: string): AuthProfileResult {
  const record = findApiKey(keyId)
  const secret = record ? readApiKeySecret(keyId) : null
  if (!record || !secret) return { ok: false, ready: false, error: 'This API key could not be read. Add it again.' }
  if (API_KEY_PROVIDER_CLI[record.provider as ApiKeyProvider] !== kind) {
    return { ok: false, ready: false, error: 'This key belongs to a different provider.' }
  }
  try {
    removeProfileDirectory(kind, accountId)
    const root = ensureProfileRoot(kind, accountId)
    if (kind === 'claude') {
      // Claude Code asks once before using a key from the environment and
      // remembers the answer by the key's last 20 characters. Pre-approve it and
      // skip the first-run screens that only matter for browser sign-in.
      mergeJsonFile(join(root, '.claude.json'), (current) => {
        const responses = asRecord(current.customApiKeyResponses) ?? {}
        const approved = Array.isArray(responses.approved) ? responses.approved.filter((item) => typeof item === 'string') : []
        const tail = secret.slice(-20)
        return {
          ...current,
          hasCompletedOnboarding: true,
          customApiKeyResponses: {
            ...responses,
            approved: approved.includes(tail) ? approved : [...approved, tail],
            rejected: Array.isArray(responses.rejected) ? responses.rejected : []
          }
        }
      })
    } else if (kind === 'codex') {
      // Same file `codex login --with-api-key` writes.
      ensureCodexConfig(root)
      writeFileSync(join(root, 'auth.json'), JSON.stringify({ OPENAI_API_KEY: secret }, null, 2), { encoding: 'utf8', mode: 0o600 })
    } else if (kind === 'gemini') {
      mergeJsonFile(join(root, '.gemini', 'settings.json'), (current) => {
        const security = asRecord(current.security) ?? {}
        const auth = asRecord(security.auth) ?? {}
        return { ...current, security: { ...security, auth: { ...auth, selectedType: 'gemini-api-key' } } }
      })
    } else {
      return { ok: false, ready: false, error: 'This CLI cannot use an API key yet.' }
    }
    const metadata = readJson(metadataPath(kind, accountId)) ?? {}
    writeFileSync(
      metadataPath(kind, accountId),
      JSON.stringify({ ...metadata, kind, accountId, apiKeyId: keyId, name: record.label, updatedAt: Date.now() }, null, 2),
      'utf8'
    )
    return { ok: true, ready: true, identity: { email: '', name: record.label } }
  } catch (error) {
    return { ok: false, ready: false, error: error instanceof Error ? error.message : 'Could not connect this API key' }
  }
}

/** True when any CLI account still signs in with this key. */
export function apiKeyInUseByCli(keyId: string): boolean {
  for (const kind of AI_ACCOUNT_KINDS) {
    const dir = join(profilesRoot(), kind)
    if (!existsSync(dir)) continue
    for (const entry of readdirSync(dir)) {
      const metadata = readJson(join(dir, entry, 'profile.json'))
      if (asString(metadata?.apiKeyId) === keyId) return true
    }
  }
  return false
}

function ensureCodexConfig(root: string): void {
  const configPath = join(root, 'config.toml')
  const globalConfig = join(homedir(), '.codex', 'config.toml')
  let config = existsSync(configPath)
    ? readFileSync(configPath, 'utf8')
    : existsSync(globalConfig)
      ? readFileSync(globalConfig, 'utf8')
      : ''
  if (/^\s*cli_auth_credentials_store\s*=/m.test(config)) {
    config = config.replace(
      /^\s*cli_auth_credentials_store\s*=.*$/m,
      'cli_auth_credentials_store = "file"'
    )
  } else {
    config = `cli_auth_credentials_store = "file"\n${config}`
  }
  mkdirSync(root, { recursive: true })
  writeFileSync(configPath, config, 'utf8')
}

async function captureAntigravity(request: AuthProfileRequest): Promise<AuthProfileResult> {
  if (!safeStorage.isEncryptionAvailable()) {
    return {
      ok: false,
      ready: false,
      error: 'Secure local credential encryption is not available on this computer'
    }
  }
  const captured = await captureAntigravityLogin(request.accountId)
  if (captured.error) return { ok: false, ready: false, error: captured.error }
  if (!captured.ready) return { ok: true, ready: false }
  const email = captured.identity?.email || request.email
  writeMetadata(email ? { ...request, email } : request)
  return {
    ok: true,
    ready: true,
    ...(captured.identity
      ? { identity: captured.identity }
      : email
        ? { identity: { email, name: email } }
        : {})
  }
}

async function captureCursor(request: AuthProfileRequest): Promise<AuthProfileResult> {
  const identity = await captureCursorProfile(request)
  return identity ? { ok: true, ready: true, identity } : { ok: true, ready: false }
}

export async function importCurrentAuthProfile(
  request: AuthProfileRequest
): Promise<AuthProfileResult> {
  try {
    if (request.kind === 'antigravity') return await captureAntigravity(request)
    if (request.kind === 'cursor') return await captureCursor(request)

    const root = ensureProfileRoot(request.kind, request.accountId)
    let copied = false
    if (request.kind === 'codex') {
      ensureCodexConfig(root)
      copied = copyIfPresent(join(homedir(), '.codex', 'auth.json'), join(root, 'auth.json'))
    } else if (request.kind === 'gemini') {
      const target = join(root, '.gemini')
      copied = copyIfPresent(
        join(homedir(), '.gemini', 'oauth_creds.json'),
        join(target, 'oauth_creds.json')
      )
      copyIfPresent(
        join(homedir(), '.gemini', 'google_accounts.json'),
        join(target, 'google_accounts.json')
      )
      copyIfPresent(join(homedir(), '.gemini', 'settings.json'), join(target, 'settings.json'))
    } else if (request.kind === 'claude') {
      copied = await importSystemClaudeLogin(root)
      copyIfPresent(join(homedir(), '.claude', 'settings.json'), join(root, 'settings.json'))
    }
    writeMetadata(request)
    const inspected = inspectAuthProfile(request)
    return { ...inspected, ready: copied || inspected.ready }
  } catch (error) {
    return {
      ok: false,
      ready: false,
      error: error instanceof Error ? error.message : 'Could not import CLI account'
    }
  }
}

export function getAuthProfileEnv(
  kind: CliUsageKind,
  accountId: string
): Record<string, string> {
  const root = ensureProfileRoot(kind, accountId)
  if (kind === 'codex') {
    ensureCodexConfig(root)
    return { CODEX_HOME: root }
  }
  const keyId = boundApiKeyId(kind, accountId)
  const keyEnv = API_KEY_ENV[kind]
  const secret = keyId && keyEnv ? readApiKeySecret(keyId) : null
  const apiKeyEnv: Record<string, string> = secret && keyEnv ? { [keyEnv]: secret } : {}
  if (kind === 'gemini') return { GEMINI_CLI_HOME: root, ...apiKeyEnv }
  if (kind === 'antigravity') return { GEMINI_CLI_HOME: root }
  if (kind === 'claude') return { CLAUDE_CONFIG_DIR: root, ...apiKeyEnv }
  if (kind === 'cursor') {
    return cursorProfileEnv(accountId)
  }
  return {}
}

export async function prepareAuthProfileLaunch(
  request: AuthProfileRequest,
  launchMode: 'normal' | 'login',
  resumeLogin = false
): Promise<AuthProfileResult> {
  try {
    if (launchMode === 'login' && resumeLogin) {
      ensureProfileRoot(request.kind, request.accountId)
      getAuthProfileEnv(request.kind, request.accountId)
      return inspectAuthProfile(request)
    }
    if (launchMode === 'login') {
      if (request.kind === 'antigravity') {
        await prepareAntigravityFreshLogin(request.accountId)
      }
      if (request.kind === 'cursor') {
        logoutCursorProfile(request.accountId)
        writeMetadata(request)
        return { ok: true, ready: false }
      }
      removeProfileDirectory(request.kind, request.accountId)
      const root = ensureProfileRoot(request.kind, request.accountId)
      if (request.kind === 'codex') ensureCodexConfig(root)
      writeMetadata(request)
      return { ok: true, ready: false }
    }

    ensureProfileRoot(request.kind, request.accountId)
    if (request.kind === 'antigravity') {
      if (!hasStoredAntigravityCredentials(request.accountId)) {
        return { ok: true, ready: false }
      }
      const applied = await applyAntigravityCredentialsForAccount(request.accountId)
      if (!applied) {
        return {
          ok: false,
          ready: false,
          error:
            'Could not activate this Antigravity account. Sign in again to recapture its token.'
        }
      }
      return {
        ok: true,
        ready: true,
        identity: readMetadataIdentity(request.kind, request.accountId)
      }
    }

    if (request.kind === 'cursor') {
      const ready = await prepareCursorProfile(request.accountId)
      const identity = cursorExpectedIdentity(request.accountId)
      return {
        ok: true,
        ready,
        identity: { email: identity.email ?? '', name: identity.name ?? identity.email ?? '' }
      }
    }

    getAuthProfileEnv(request.kind, request.accountId)
    return inspectAuthProfile(request)
  } catch (error) {
    return {
      ok: false,
      ready: false,
      error: error instanceof Error ? error.message : 'Could not prepare CLI account'
    }
  }
}

export function inspectAuthProfile(request: AuthProfileRequest): AuthProfileResult {
  try {
    const root = getAuthProfileRoot(request.kind, request.accountId)
    let identity: AuthProfileIdentity | undefined
    let ready = false

    if (request.kind === 'antigravity') {
      ready = existsSync(join(root, 'credential.bin'))
      identity = readMetadataIdentity(request.kind, request.accountId)
    } else if (request.kind === 'cursor') {
      ready = hasCursorProfileCredentials(request.accountId)
      const configIdentity = cursorExpectedIdentity(request.accountId)
      const metadata = readMetadataIdentity(request.kind, request.accountId)
      const email = configIdentity?.email || metadata?.email || ''
      const name = configIdentity?.name || metadata?.name || email
      identity = email || name ? { email, name } : undefined
    } else if (request.kind === 'codex') {
      const auth = readJson(join(root, 'auth.json'))
      const tokens = asRecord(auth?.tokens)
      const idToken = asString(tokens?.id_token)
      const payload = idToken ? decodeJwtPayload(idToken) : null
      const email =
        asString(payload?.email) ??
        asString(payload?.email_address) ??
        getNestedString(payload, ['https://api.openai.com/auth', 'email'])
      ready = Boolean(auth && (tokens || asString(auth.OPENAI_API_KEY)))
      if (email) identity = { email, name: email }
    } else if (request.kind === 'gemini') {
      const accounts = readJson(join(root, '.gemini', 'google_accounts.json'))
      const email = asString(accounts?.active)
      ready = existsSync(join(root, '.gemini', 'oauth_creds.json'))
      if (email) identity = { email, name: email }
    } else if (request.kind === 'claude') {
      const login = inspectClaudeLoginFiles(root)
      ready = login.ready
      if (login.email) identity = { email: login.email, name: login.email }
    }

    // An API-key account is ready while its key is in the vault, whatever the CLI's own files say.
    const keyId = boundApiKeyId(request.kind, request.accountId)
    if (keyId) {
      ready = Boolean(readApiKeySecret(keyId))
      const label = findApiKey(keyId)?.label
      if (label) identity = { email: '', name: label }
    }

    if (ready && request.email && request.kind !== 'cursor') {
      writeMetadata(request)
      identity ??= { email: request.email, name: request.email }
    }
    return { ok: true, ready, ...(identity ? { identity } : {}) }
  } catch (error) {
    return {
      ok: false,
      ready: false,
      error: error instanceof Error ? error.message : 'Could not inspect CLI account'
    }
  }
}

export async function listAuthProfiles(): Promise<AuthProfileSummary[]> {
  const profiles: AuthProfileSummary[] = []
  const cursorRoot = join(profilesRoot(), 'cursor')
  const migrations: Promise<unknown>[] = []
  if (existsSync(cursorRoot)) {
    for (const entry of readdirSync(cursorRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const metadata = readJson(join(cursorRoot, entry.name, 'profile.json'))
      const accountId = asString(metadata?.accountId)
      if (accountId && metadata?.cursorIsolationVersion !== 1) {
        migrations.push(withCursorAccountLock(accountId, () => prepareCursorProfile(accountId)))
      }
    }
  }
  await Promise.allSettled(migrations)

  // Take a fresh local snapshot after migration. Existing profiles never wait for usage checks.
  for (const kind of AI_ACCOUNT_KINDS) {
    const kindRoot = join(profilesRoot(), kind)
    if (!existsSync(kindRoot)) continue

    let entries
    try {
      entries = readdirSync(kindRoot, { withFileTypes: true })
    } catch {
      continue
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue

      const metadata = readJson(join(kindRoot, entry.name, 'profile.json'))
      const accountId = asString(metadata?.accountId)
      if (!accountId) continue

      const inspected = inspectAuthProfile({ kind, accountId })
      if (!inspected.ready && kind !== 'cursor') continue

      const storedEmail = asString(metadata?.email)
      const email = cleanCliLabel(inspected.identity?.email || storedEmail || '')
      const name = cleanCliLabel(
        inspected.identity?.name ||
          asString(metadata?.name) ||
          email ||
          `${AI_ACCOUNT_LABELS[kind]} account`
      )

      profiles.push({
        kind,
        accountId,
        name,
        email,
        ready: inspected.ready
      })
    }
  }

  return profiles
}

export async function removeAuthProfile(request: AuthProfileRequest): Promise<AuthProfileResult> {
  try {
    if (request.kind === 'antigravity') {
      const profileSecret = readStoredAntigravitySecret(request.accountId)
      const liveSecret = await readAntigravityCredential().catch(() => null)
      if (profileSecret && liveSecret === profileSecret) {
        markAntigravitySessionAccount(null)
        await logoutAntigravityCli()
      }
    }
    if (request.kind === 'cursor') {
      logoutCursorProfile(request.accountId)
    }
    removeProfileDirectory(request.kind, request.accountId)
    return { ok: true, ready: false }
  } catch (error) {
    return {
      ok: false,
      ready: false,
      error: error instanceof Error ? error.message : 'Could not remove CLI account profile'
    }
  }
}

/**
 * Signs an account out but keeps its card, so the user can sign the same
 * account back in later. Only the account's own Bikorch profile is touched.
 */
export async function logoutAuthProfile(request: AuthProfileRequest): Promise<AuthProfileResult> {
  try {
    const root = getAuthProfileRoot(request.kind, request.accountId)
    // An API-key account signs out by dropping its key binding; the key stays in the vault.
    if (boundApiKeyId(request.kind, request.accountId)) {
      const metadata = readJson(metadataPath(request.kind, request.accountId)) ?? {}
      delete metadata.apiKeyId
      writeFileSync(metadataPath(request.kind, request.accountId), JSON.stringify(metadata, null, 2), 'utf8')
    }
    if (request.kind === 'cursor') {
      logoutCursorProfile(request.accountId)
    } else if (request.kind === 'antigravity') {
      const profileSecret = readStoredAntigravitySecret(request.accountId)
      const liveSecret = await readAntigravityCredential().catch(() => null)
      if (profileSecret && liveSecret === profileSecret) {
        markAntigravitySessionAccount(null)
        await logoutAntigravityCli()
      }
      rmSync(join(root, 'credential.bin'), { force: true })
    } else if (request.kind === 'codex') {
      rmSync(join(root, 'auth.json'), { force: true })
    } else if (request.kind === 'gemini') {
      rmSync(join(root, '.gemini', 'oauth_creds.json'), { force: true })
      rmSync(join(root, '.gemini', 'google_accounts.json'), { force: true })
    } else if (request.kind === 'claude') {
      await logoutClaudeProfile(root)
    }
    return { ok: true, ready: false }
  } catch (error) {
    return {
      ok: false,
      ready: false,
      error: error instanceof Error ? error.message : 'Could not sign this account out'
    }
  }
}

export async function inspectSystemAuthProfile(kind: CliUsageKind): Promise<AuthProfileResult> {
  try {
    const home = homedir()

    if (kind === 'antigravity') {
      const secret = await readAntigravityCredential()
      if (!secret) return { ok: true, ready: false }
      return {
        ok: true,
        ready: true,
        identity: { email: '', name: `${AI_ACCOUNT_LABELS[kind]} account` }
      }
    }

    if (kind === 'cursor') {
      const identity = await inspectSystemCursor()
      return identity ? { ok: true, ready: true, identity } : { ok: true, ready: false }
    }

    if (kind === 'codex') {
      const auth = readJson(join(home, '.codex', 'auth.json'))
      const tokens = asRecord(auth?.tokens)
      const idToken = asString(tokens?.id_token)
      const payload = idToken ? decodeJwtPayload(idToken) : null
      const email =
        asString(payload?.email) ??
        asString(payload?.email_address) ??
        getNestedString(payload, ['https://api.openai.com/auth', 'email'])
      const ready = Boolean(auth && (tokens || asString(auth.OPENAI_API_KEY)))
      if (!ready) return { ok: true, ready: false }
      return {
        ok: true,
        ready: true,
        identity: { email: email ?? '', name: email ?? `${AI_ACCOUNT_LABELS[kind]} account` }
      }
    }

    if (kind === 'gemini') {
      const accounts = readJson(join(home, '.gemini', 'google_accounts.json'))
      const email = asString(accounts?.active)
      const ready = existsSync(join(home, '.gemini', 'oauth_creds.json'))
      if (!ready) return { ok: true, ready: false }
      return {
        ok: true,
        ready: true,
        identity: { email: email ?? '', name: email ?? `${AI_ACCOUNT_LABELS[kind]} account` }
      }
    }

    if (kind === 'claude') {
      const login = await inspectClaudeLogin(null)
      const email = login.email
      if (!login.ready) return { ok: true, ready: false }
      return {
        ok: true,
        ready: true,
        identity: { email: email ?? '', name: email ?? `${AI_ACCOUNT_LABELS[kind]} account` }
      }
    }

    return { ok: true, ready: false }
  } catch (error) {
    return {
      ok: false,
      ready: false,
      error: error instanceof Error ? error.message : 'Could not inspect system CLI account'
    }
  }
}

export async function discoverSystemAuthProfiles(): Promise<SystemAuthDiscovery[]> {
  const discoveries: SystemAuthDiscovery[] = []

  for (const kind of AI_ACCOUNT_KINDS) {
    const inspected = await inspectSystemAuthProfile(kind)
    if (!inspected.ready) continue
    discoveries.push({
      kind,
      ready: true,
      name: inspected.identity?.name || `${AI_ACCOUNT_LABELS[kind]} account`,
      email: inspected.identity?.email || ''
    })
  }

  return discoveries
}
