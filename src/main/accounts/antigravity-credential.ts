import { app, safeStorage } from 'electron'
import { createHash } from 'crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'fs'
import { homedir } from 'os'
import { dirname, join } from 'path'
import { cleanCliLabel } from '@shared/terminal-text'
import {
  deleteAntigravityCredential,
  readAntigravityCredential,
  writeAntigravityCredential
} from './windows-credential'

const GEMINI_AUTH_FILES = ['oauth_creds.json', 'google_accounts.json'] as const
const ANTIGRAVITY_TOKEN_FILE = 'antigravity-oauth-token'
const ANTIGRAVITY_BROWSER_PROFILE = 'antigravity-browser-profile'
const DUPLICATE_ACCOUNT_ERROR =
  'Bu Antigravity hesabı zaten kayıtlı. Mevcut hesap kartını kullanın. Başka bir hesap eklemek için /logout yazıp /login ile farklı bir Google hesabı seçin.'

let sessionAccountId: string | null = null
let freshLoginAccountId: string | null = null

function profileRoot(accountId: string): string {
  const hash = createHash('sha256').update(accountId).digest('hex').slice(0, 32)
  return join(app.getPath('userData'), 'cli-profiles', 'antigravity', hash)
}

function credentialPath(accountId: string): string {
  return join(profileRoot(accountId), 'credential.bin')
}

function geminiDir(accountId: string): string {
  return join(profileRoot(accountId), '.gemini')
}

function systemGeminiDir(): string {
  return join(homedir(), '.gemini')
}

function systemTokenPath(): string {
  return join(systemGeminiDir(), 'antigravity-cli', ANTIGRAVITY_TOKEN_FILE)
}

function systemBrowserProfilePath(): string {
  return join(systemGeminiDir(), ANTIGRAVITY_BROWSER_PROFILE)
}

function profileTokenPath(accountId: string): string {
  return join(profileRoot(accountId), ANTIGRAVITY_TOKEN_FILE)
}

function removeIfPresent(path: string): void {
  if (!existsSync(path)) return
  rmSync(path, { force: true })
}

export function markAntigravitySessionAccount(accountId: string | null): void {
  sessionAccountId = accountId
}

export function getAntigravitySessionAccount(): string | null {
  return sessionAccountId
}

export function isAntigravityFreshLoginActive(): boolean {
  return freshLoginAccountId !== null
}

export function finishAntigravityFreshLogin(accountId?: string | null): void {
  if (!freshLoginAccountId) return
  if (accountId && accountId !== freshLoginAccountId) return
  freshLoginAccountId = null
}

export function hasStoredAntigravityCredentials(accountId: string): boolean {
  return existsSync(credentialPath(accountId))
}

export function readStoredAntigravitySecret(accountId: string): string | null {
  const path = credentialPath(accountId)
  if (!existsSync(path) || !safeStorage.isEncryptionAvailable()) return null
  try {
    const secret = safeStorage.decryptString(readFileSync(path))
    return secret.trim() ? secret : null
  } catch {
    return null
  }
}

function writeStoredSecret(accountId: string, secret: string): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Secure local credential encryption is not available on this computer')
  }
  const root = profileRoot(accountId)
  mkdirSync(root, { recursive: true })
  writeFileSync(credentialPath(accountId), safeStorage.encryptString(secret))
}

function copyIfPresent(source: string, target: string): void {
  if (!existsSync(source)) return
  mkdirSync(dirname(target), { recursive: true })
  copyFileSync(source, target)
}

function snapshotGeminiAuth(accountId: string): void {
  const sourceDir = systemGeminiDir()
  const targetDir = geminiDir(accountId)
  for (const file of GEMINI_AUTH_FILES) {
    copyIfPresent(join(sourceDir, file), join(targetDir, file))
  }
  copyIfPresent(systemTokenPath(), profileTokenPath(accountId))
}

function restoreGeminiAuth(accountId: string): void {
  const sourceDir = geminiDir(accountId)
  const targetDir = systemGeminiDir()
  for (const file of GEMINI_AUTH_FILES) {
    copyIfPresent(join(sourceDir, file), join(targetDir, file))
  }
  const token = profileTokenPath(accountId)
  if (existsSync(token)) copyIfPresent(token, systemTokenPath())
}

export function clearSystemAntigravityAuth(): void {
  const gemini = systemGeminiDir()
  for (const file of GEMINI_AUTH_FILES) removeIfPresent(join(gemini, file))
  removeIfPresent(systemTokenPath())
  if (existsSync(systemBrowserProfilePath())) {
    rmSync(systemBrowserProfilePath(), { recursive: true, force: true })
  }
}

function kindRoot(): string {
  return join(app.getPath('userData'), 'cli-profiles', 'antigravity')
}

function profileDirs(): Array<{ accountId: string; dir: string }> {
  const root = kindRoot()
  if (!existsSync(root)) return []
  let entries
  try {
    entries = readdirSync(root, { withFileTypes: true })
  } catch {
    return []
  }
  const profiles: Array<{ accountId: string; dir: string }> = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const dir = join(root, entry.name)
    try {
      const metadata = JSON.parse(readFileSync(join(dir, 'profile.json'), 'utf8')) as { accountId?: string }
      if (metadata.accountId) profiles.push({ accountId: metadata.accountId, dir })
    } catch {
      continue
    }
  }
  return profiles
}

function accountIdForSecret(secret: string): string | null {
  if (!safeStorage.isEncryptionAvailable()) return null
  for (const profile of profileDirs()) {
    const path = join(profile.dir, 'credential.bin')
    if (!existsSync(path)) continue
    try {
      if (safeStorage.decryptString(readFileSync(path)) === secret) return profile.accountId
    } catch {
      continue
    }
  }
  return null
}

function readEmailFile(path: string): string {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as { active?: string; email?: string }
    return cleanCliLabel((parsed.active || parsed.email || '').trim()).toLowerCase()
  } catch {
    return ''
  }
}

function emailFromIdToken(token: string): string {
  const payload = token.split('.')[1]
  if (!payload) return ''
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { email?: string }
    return (claims.email || '').trim().toLowerCase()
  } catch {
    return ''
  }
}

function readTokenEmail(path: string): string {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as { id_token?: string }
    return parsed.id_token ? emailFromIdToken(parsed.id_token) : ''
  } catch {
    return ''
  }
}

function accountIdForEmail(email: string): string | null {
  const target = email.trim().toLowerCase()
  if (!target) return null
  for (const profile of profileDirs()) {
    const metadataEmail = readEmailFile(join(profile.dir, 'profile.json'))
    const googleEmail = readEmailFile(join(profile.dir, '.gemini', 'google_accounts.json'))
    const tokenEmail = readTokenEmail(join(profile.dir, ANTIGRAVITY_TOKEN_FILE))
    if (metadataEmail === target || googleEmail === target || tokenEmail === target) return profile.accountId
  }
  return null
}

export function readSystemAntigravityEmail(): string {
  return readTokenEmail(systemTokenPath()) || readEmailFile(join(systemGeminiDir(), 'google_accounts.json'))
}

export async function captureAntigravityCredentialsForAccount(
  accountId: string
): Promise<boolean> {
  const secret = await readAntigravityCredential()
  if (!secret) return false
  const owner = accountIdForSecret(secret)
  if (owner && owner !== accountId) return false
  writeStoredSecret(accountId, secret)
  snapshotGeminiAuth(accountId)
  return true
}

export async function prepareAntigravityFreshLogin(accountId: string): Promise<void> {
  freshLoginAccountId = accountId
  const secret = await readAntigravityCredential().catch(() => null)
  const sessionId = getAntigravitySessionAccount()
  const owner = secret ? accountIdForSecret(secret) : null
  const preserveId = [sessionId, owner].find((id) => id && id !== accountId)
  if (preserveId) {
    await captureAntigravityCredentialsForAccount(preserveId).catch(() => false)
  }
  markAntigravitySessionAccount(null)
  await deleteAntigravityCredential().catch(() => undefined)
  clearSystemAntigravityAuth()
}

export async function captureAntigravityLogin(accountId: string): Promise<{
  ready: boolean
  error?: string
  identity?: { email: string; name: string }
}> {
  const secret = await readAntigravityCredential()
  if (!secret) return { ready: false }
  const email = readSystemAntigravityEmail()
  const secretOwner = accountIdForSecret(secret)
  const emailOwner = email ? accountIdForEmail(email) : null
  if ((secretOwner && secretOwner !== accountId) || (emailOwner && emailOwner !== accountId)) {
    return { ready: false, error: DUPLICATE_ACCOUNT_ERROR }
  }
  writeStoredSecret(accountId, secret)
  snapshotGeminiAuth(accountId)
  freshLoginAccountId = null
  markAntigravitySessionAccount(accountId)
  return email ? { ready: true, identity: { email, name: email } } : { ready: true }
}

export async function applyAntigravityCredentialsForAccount(
  accountId: string
): Promise<boolean> {
  if (freshLoginAccountId) return false
  const secret = readStoredAntigravitySecret(accountId)
  if (!secret) return false
  restoreGeminiAuth(accountId)
  await writeAntigravityCredential(secret)
  const applied = await readAntigravityCredential()
  return applied === secret
}
