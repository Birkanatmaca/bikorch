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
import type { CliUsageKind } from '@shared/contracts/usage'
import {
  readAntigravityCredential
} from './windows-credential'
import {
  applyCursorCredentialsForAccount,
  captureCursorCredentialsForAccount,
  cursorCredentialsSupported,
  hasStoredCursorCredentials,
  removeStoredCursorCredentials
} from './cursor-credential'
import { withAntigravityCredentialLock } from './credential-lock'
import { logoutAntigravityCli } from './antigravity-logout'
import {
  applyAntigravityCredentialsForAccount,
  captureAntigravityCredentialsForAccount,
  hasStoredAntigravityCredentials,
  markAntigravitySessionAccount
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
        ...(request.email ? { email: request.email } : {}),
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
  return { email: email ?? '', name: name ?? email ?? '' }
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
  const captured = await captureAntigravityCredentialsForAccount(request.accountId)
  if (!captured) return { ok: true, ready: false }
  ensureProfileRoot(request.kind, request.accountId)
  writeMetadata(request)
  return {
    ok: true,
    ready: true,
    ...(request.email ? { identity: { email: request.email, name: request.email } } : {})
  }
}

export async function importCurrentAuthProfile(
  request: AuthProfileRequest
): Promise<AuthProfileResult> {
  try {
    if (request.kind === 'antigravity') return await captureAntigravity(request)

    const root = ensureProfileRoot(request.kind, request.accountId)
    let copied = false
    if (request.kind === 'cursor') {
      const profileConfigPath = join(root, 'config', 'cli-config.json')
      const profileConfig = readJson(profileConfigPath)
      const profileHasAuth = Boolean(asRecord(profileConfig?.authInfo))
      copied = profileHasAuth
        ? true
        : copyIfPresent(
            join(homedir(), '.cursor', 'cli-config.json'),
            profileConfigPath
          )
      if (cursorCredentialsSupported()) {
        await captureCursorCredentialsForAccount(request.accountId)
      }
    } else if (request.kind === 'codex') {
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
      copied = copyIfPresent(
        join(homedir(), '.claude', '.credentials.json'),
        join(root, '.credentials.json')
      )
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
  if (kind === 'cursor') {
    return {
      CURSOR_CONFIG_DIR: join(root, 'config'),
      CURSOR_DATA_DIR: join(root, 'data')
    }
  }
  if (kind === 'codex') {
    ensureCodexConfig(root)
    return { CODEX_HOME: root }
  }
  if (kind === 'gemini') return { GEMINI_CLI_HOME: root }
  if (kind === 'antigravity') return { GEMINI_CLI_HOME: root }
  if (kind === 'claude') return { CLAUDE_CONFIG_DIR: root }
  return {}
}

export async function prepareAuthProfileLaunch(
  request: AuthProfileRequest,
  launchMode: 'normal' | 'login'
): Promise<AuthProfileResult> {
  try {
    if (launchMode === 'login') {
      if (request.kind === 'antigravity') {
        markAntigravitySessionAccount(null)
        await logoutAntigravityCli()
      }
      if (request.kind === 'cursor') removeStoredCursorCredentials(request.accountId)
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
      const inspected = inspectAuthProfile(request)
      if (!inspected.ready) return inspected
      if (cursorCredentialsSupported()) {
        if (!hasStoredCursorCredentials(request.accountId)) {
          return {
            ok: false,
            ready: false,
            error:
              'Cursor session tokens are missing for this account. Open Sign in and authenticate again.'
          }
        }
        const applied = await applyCursorCredentialsForAccount(request.accountId)
        if (!applied) {
          return {
            ok: false,
            ready: false,
            error: 'Could not activate Cursor credentials for this account'
          }
        }
      }
      return inspected
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
      const config = readJson(join(root, 'config', 'cli-config.json'))
      const auth = asRecord(config?.authInfo)
      const email = asString(auth?.email)
      const name = asString(auth?.displayName)
      ready = Boolean(auth)
      if (email || name) identity = { email: email ?? '', name: name ?? email ?? '' }
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
      const credentials = readJson(join(root, '.credentials.json'))
      const oauth = asRecord(credentials?.claudeAiOauth)
      const email =
        asString(oauth?.emailAddress) ?? asString(oauth?.email) ?? asString(credentials?.email)
      ready = Boolean(credentials)
      if (email) identity = { email, name: email }
    }

    if (ready && request.email) {
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

export function listAuthProfiles(): AuthProfileSummary[] {
  const profiles: AuthProfileSummary[] = []

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
      if (!inspected.ready) continue

      const storedEmail = asString(metadata?.email)
      const email = inspected.identity?.email || storedEmail || ''
      const name =
        inspected.identity?.name ||
        asString(metadata?.name) ||
        email ||
        `${AI_ACCOUNT_LABELS[kind]} account`

      profiles.push({
        kind,
        accountId,
        name,
        email,
        ready: true
      })
    }
  }

  return profiles
}

export async function removeAuthProfile(request: AuthProfileRequest): Promise<AuthProfileResult> {
  try {
    if (request.kind === 'antigravity') {
      markAntigravitySessionAccount(null)
      await withAntigravityCredentialLock(() => logoutAntigravityCli())
    }
    if (request.kind === 'cursor') removeStoredCursorCredentials(request.accountId)
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
      const config = readJson(join(home, '.cursor', 'cli-config.json'))
      const auth = asRecord(config?.authInfo)
      const email = asString(auth?.email)
      const name = asString(auth?.displayName)
      const ready = Boolean(auth)
      if (!ready) return { ok: true, ready: false }
      return {
        ok: true,
        ready: true,
        identity: {
          email: email ?? '',
          name: name ?? email ?? `${AI_ACCOUNT_LABELS[kind]} account`
        }
      }
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
      const credentials = readJson(join(home, '.claude', '.credentials.json'))
      const oauth = asRecord(credentials?.claudeAiOauth)
      const email =
        asString(oauth?.emailAddress) ?? asString(oauth?.email) ?? asString(credentials?.email)
      const ready = Boolean(credentials)
      if (!ready) return { ok: true, ready: false }
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
