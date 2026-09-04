import { app, safeStorage } from 'electron'
import { createHash } from 'crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync
} from 'fs'
import { homedir } from 'os'
import { dirname, join } from 'path'
import {
  readAntigravityCredential,
  writeAntigravityCredential
} from './windows-credential'

const GEMINI_AUTH_FILES = ['oauth_creds.json', 'google_accounts.json'] as const

let sessionAccountId: string | null = null

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

export function markAntigravitySessionAccount(accountId: string | null): void {
  sessionAccountId = accountId
}

export function getAntigravitySessionAccount(): string | null {
  return sessionAccountId
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
}

function restoreGeminiAuth(accountId: string): void {
  const sourceDir = geminiDir(accountId)
  const targetDir = systemGeminiDir()
  for (const file of GEMINI_AUTH_FILES) {
    copyIfPresent(join(sourceDir, file), join(targetDir, file))
  }
}

function secretOwnedByOtherAccount(accountId: string, secret: string): boolean {
  const kindRoot = join(app.getPath('userData'), 'cli-profiles', 'antigravity')
  if (!existsSync(kindRoot)) return false

  let entries
  try {
    entries = readdirSync(kindRoot, { withFileTypes: true })
  } catch {
    return false
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const otherCredential = join(kindRoot, entry.name, 'credential.bin')
    const otherMeta = join(kindRoot, entry.name, 'profile.json')
    if (!existsSync(otherCredential)) continue
    try {
      const metadata = JSON.parse(readFileSync(otherMeta, 'utf8')) as { accountId?: string }
      if (metadata.accountId === accountId) continue
      const otherSecret = safeStorage.decryptString(readFileSync(otherCredential))
      if (otherSecret === secret) return true
    } catch {
      continue
    }
  }
  return false
}

export async function captureAntigravityCredentialsForAccount(
  accountId: string
): Promise<boolean> {
  const secret = await readAntigravityCredential()
  if (!secret) return false
  if (secretOwnedByOtherAccount(accountId, secret)) return false
  writeStoredSecret(accountId, secret)
  snapshotGeminiAuth(accountId)
  return true
}

export async function applyAntigravityCredentialsForAccount(
  accountId: string
): Promise<boolean> {
  const secret = readStoredAntigravitySecret(accountId)
  if (!secret) return false
  restoreGeminiAuth(accountId)
  await writeAntigravityCredential(secret)
  const applied = await readAntigravityCredential()
  return applied === secret
}
