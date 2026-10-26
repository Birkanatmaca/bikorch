import { execFile, spawn } from 'child_process'
import { createHash } from 'crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { homedir, userInfo } from 'os'
import { join } from 'path'

type JsonRecord = Record<string, unknown>

const KEYCHAIN_SERVICE = 'Claude Code-credentials'
const SECURITY = '/usr/bin/security'

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : null
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

function runSecurity(args: string[]): Promise<{ ok: boolean; stdout: string }> {
  return new Promise((resolve) => {
    execFile(SECURITY, args, { timeout: 5000, maxBuffer: 1024 * 1024 }, (error, stdout) => {
      resolve({ ok: !error, stdout: String(stdout ?? '') })
    })
  })
}

function quoteForSecurity(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/**
 * Writes a generic password through `security -i` so the secret travels over
 * stdin instead of argv, where any local user could read it with `ps`.
 */
function writeKeychainPassword(account: string, service: string, secret: string): Promise<boolean> {
  if (/[\r\n]/.test(secret)) return Promise.resolve(false)
  return new Promise((resolve) => {
    const child = spawn(SECURITY, ['-i'], { stdio: ['pipe', 'ignore', 'ignore'] })
    const timer = setTimeout(() => child.kill(), 5000)
    child.on('error', () => {
      clearTimeout(timer)
      resolve(false)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve(code === 0)
    })
    child.stdin.end(
      `add-generic-password -U -a ${quoteForSecurity(account)} -s ${quoteForSecurity(service)} -w ${quoteForSecurity(secret)}\n`
    )
  })
}

/**
 * Keychain service Claude Code uses on macOS. With CLAUDE_CONFIG_DIR set it
 * appends the first 8 hex chars of the directory's SHA-256 so each config dir
 * gets its own entry; the default ~/.claude uses the bare name.
 */
export function claudeKeychainService(configDir: string | null): string {
  if (!configDir) return KEYCHAIN_SERVICE
  const hash = createHash('sha256').update(configDir.normalize('NFC')).digest('hex').slice(0, 8)
  return `${KEYCHAIN_SERVICE}-${hash}`
}

/** `.claude.json` sits inside CLAUDE_CONFIG_DIR, or in the home folder by default. */
export function claudeGlobalConfigPath(configDir: string | null): string {
  return configDir ? join(configDir, '.claude.json') : join(homedir(), '.claude.json')
}

function credentialsFilePath(configDir: string | null): string {
  return join(configDir ?? join(homedir(), '.claude'), '.credentials.json')
}

export interface ClaudeLoginState {
  ready: boolean
  email?: string
}

/**
 * Claude Code keeps its OAuth token in the macOS Keychain and in
 * `.credentials.json` elsewhere, and records the signed-in account under
 * `oauthAccount` in `.claude.json`. Any of these means the login finished.
 * The Keychain is only asked whether the entry exists; the secret is never read.
 */
export async function inspectClaudeLogin(
  configDir: string | null,
  platform: NodeJS.Platform = process.platform
): Promise<ClaudeLoginState> {
  const credentials = readJson(credentialsFilePath(configDir))
  const config = readJson(claudeGlobalConfigPath(configDir))
  const account = asRecord(config?.oauthAccount)
  const oauth = asRecord(credentials?.claudeAiOauth)
  const email =
    asString(account?.emailAddress) ??
    asString(oauth?.emailAddress) ??
    asString(oauth?.email) ??
    asString(credentials?.email)
  const apiKey = asString(config?.primaryApiKey)

  if (credentials || account || apiKey) return { ready: true, ...(email ? { email } : {}) }
  if (platform !== 'darwin') return { ready: false }

  const found = await runSecurity(['find-generic-password', '-s', claudeKeychainService(configDir)])
  return found.ok ? { ready: true, ...(email ? { email } : {}) } : { ready: false }
}

/** Synchronous variant for the polling inspector: files only, no Keychain call. */
export function inspectClaudeLoginFiles(configDir: string | null): ClaudeLoginState {
  const credentials = readJson(credentialsFilePath(configDir))
  const config = readJson(claudeGlobalConfigPath(configDir))
  const account = asRecord(config?.oauthAccount)
  const oauth = asRecord(credentials?.claudeAiOauth)
  const email =
    asString(account?.emailAddress) ??
    asString(oauth?.emailAddress) ??
    asString(oauth?.email) ??
    asString(credentials?.email)
  const ready = Boolean(credentials || account || asString(config?.primaryApiKey))
  return ready ? { ready, ...(email ? { email } : {}) } : { ready: false }
}

/**
 * Copies the system Claude Code login into a Bikorch profile directory so a user
 * who already signed in from their terminal does not have to sign in again.
 * Returns true when a credential was copied.
 */
export async function importSystemClaudeLogin(
  targetDir: string,
  platform: NodeJS.Platform = process.platform
): Promise<boolean> {
  mkdirSync(targetDir, { recursive: true })
  let copied = false

  const fileCredentials = credentialsFilePath(null)
  if (existsSync(fileCredentials)) {
    writeFileSync(join(targetDir, '.credentials.json'), readFileSync(fileCredentials), { mode: 0o600 })
    copied = true
  } else if (platform === 'darwin') {
    const account = userInfo().username
    const secret = await runSecurity(['find-generic-password', '-a', account, '-s', KEYCHAIN_SERVICE, '-w'])
    const value = secret.stdout.replace(/\n$/, '')
    if (secret.ok && value) {
      copied = await writeKeychainPassword(account, claudeKeychainService(targetDir), value)
    }
  }

  // Carry over the account record and onboarding flags so the CLI starts signed in
  // instead of replaying its first-run theme and login screens.
  const systemConfig = readJson(claudeGlobalConfigPath(null))
  if (copied && systemConfig) {
    const targetConfigPath = claudeGlobalConfigPath(targetDir)
    const current = readJson(targetConfigPath) ?? {}
    const carried: JsonRecord = {}
    for (const key of ['oauthAccount', 'hasCompletedOnboarding', 'lastOnboardingVersion', 'theme']) {
      if (systemConfig[key] !== undefined) carried[key] = systemConfig[key]
    }
    writeFileSync(targetConfigPath, JSON.stringify({ ...current, ...carried }, null, 2), {
      encoding: 'utf8',
      mode: 0o600
    })
  }
  return copied
}

/** Signs a Bikorch Claude profile out: token file, Keychain entry and account record. */
export async function logoutClaudeProfile(
  configDir: string,
  platform: NodeJS.Platform = process.platform
): Promise<void> {
  rmSync(join(configDir, '.credentials.json'), { force: true })
  const configPath = claudeGlobalConfigPath(configDir)
  const config = readJson(configPath)
  if (config) {
    delete config.oauthAccount
    delete config.primaryApiKey
    writeFileSync(configPath, JSON.stringify(config, null, 2), { encoding: 'utf8', mode: 0o600 })
  }
  if (platform === 'darwin') {
    await runSecurity(['delete-generic-password', '-a', userInfo().username, '-s', claudeKeychainService(configDir)])
  }
}
