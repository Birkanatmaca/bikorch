import { app, safeStorage } from 'electron'
import { execFile } from 'child_process'
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

import {
  identityFromCursorJwt,
  looksLikeEmail,
  cursorIdentitiesMatch,
  type CursorTokenIdentity
} from './cursor-identity'

export interface CursorKeychainTokens {
  accessToken: string
  refreshToken: string
}

interface StoredCursorSession {
  accessToken?: string
  refreshToken?: string
  signedIn?: boolean
  email?: string
  name?: string
}

function cursorProfileRoot(accountId: string): string {
  const hash = createHash('sha256').update(accountId).digest('hex').slice(0, 32)
  return join(app.getPath('userData'), 'cli-profiles', 'cursor', hash)
}

let sessionAccountId: string | null = null

function systemCursorConfigPath(): string {
  return join(homedir(), '.cursor', 'cli-config.json')
}

function snapshotConfigPath(accountId: string): string {
  return join(cursorProfileRoot(accountId), 'cli-config.json')
}

function profileCursorConfigPath(accountId: string): string {
  return join(cursorProfileRoot(accountId), '.cursor', 'cli-config.json')
}

function credentialPath(profileRoot: string): string {
  return join(profileRoot, 'cursor-credentials.bin')
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function pickString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = asString(record[key])
    if (value) return value
  }
  return undefined
}

function identityFromJwt(token: string): CursorTokenIdentity | undefined {
  return identityFromCursorJwt(token)
}

function mergeIdentity(
  ...parts: Array<{ email?: string; name?: string } | undefined>
): { email?: string; name?: string } | undefined {
  let email: string | undefined
  let name: string | undefined
  for (const part of parts) {
    email ??= part?.email
    name ??= part?.name
  }
  if (!email && !name) return undefined
  return { ...(email ? { email } : {}), ...(name ? { name } : {}) }
}

function hasCursorAuthInfo(value: unknown): boolean {
  if (typeof value === 'string') return value.trim().length > 0
  const record = asRecord(value)
  return Boolean(record && Object.keys(record).length > 0)
}

function identityFromAuthInfo(
  auth: Record<string, unknown>
): { email?: string; name?: string } | undefined {
  const emailRaw = pickString(auth, [
    'email',
    'emailAddress',
    'userEmail',
    'accountEmail'
  ])
  const email = looksLikeEmail(emailRaw) ? emailRaw : undefined
  const name = pickString(auth, ['displayName', 'name', 'userName', 'username', 'preferred_username'])
  const token =
    pickString(auth, ['accessToken', 'access_token', 'token', 'idToken', 'id_token']) ?? ''
  return mergeIdentity(
    email || name ? { ...(email ? { email } : {}), ...(name ? { name } : {}) } : undefined,
    token ? identityFromJwt(token) : undefined
  )
}

function tokensFromAuthInfo(auth: Record<string, unknown>): CursorKeychainTokens | null {
  const accessToken = pickString(auth, ['accessToken', 'access_token', 'token'])
  const refreshToken = pickString(auth, ['refreshToken', 'refresh_token'])
  if (!accessToken || !refreshToken) return null
  return { accessToken, refreshToken }
}

function readCursorConfigFile(path: string): Record<string, unknown> | null {
  if (!existsSync(path)) return null
  try {
    return asRecord(JSON.parse(readFileSync(path, 'utf8')))
  } catch {
    return null
  }
}

const ACCESS_SERVICE = 'cursor-access-token'
const REFRESH_SERVICE = 'cursor-refresh-token'
const ACCOUNT = 'cursor-user'

const WINDOWS_ACCESS_TARGET = 'cursor-access-token'
const WINDOWS_REFRESH_TARGET = 'cursor-refresh-token'

type CredentialAction = 'read' | 'write' | 'delete'

interface CredentialResponse {
  ok: boolean
  found?: boolean
  secret?: string
  error?: string
}

function readCursorConfigIdentityFromPath(
  path: string
): { email?: string; name?: string } | undefined {
  const parsed = readCursorConfigFile(path)
  if (!parsed) return undefined
  if (typeof parsed.authInfo === 'string') return identityFromJwt(parsed.authInfo)
  const auth = asRecord(parsed.authInfo)
  return auth ? identityFromAuthInfo(auth) : undefined
}

export function hasSystemCursorAuthInfo(): boolean {
  const parsed = readCursorConfigFile(systemCursorConfigPath())
  return hasCursorAuthInfo(parsed?.authInfo)
}

export function readSystemCursorConfigIdentity(): { email?: string; name?: string } | undefined {
  return readCursorConfigIdentityFromPath(systemCursorConfigPath())
}

function readSystemCursorConfigTokens(): CursorKeychainTokens | null {
  const parsed = readCursorConfigFile(systemCursorConfigPath())
  const auth = asRecord(parsed?.authInfo)
  return auth ? tokensFromAuthInfo(auth) : null
}

function readProfileCursorConfigTokens(accountId: string): CursorKeychainTokens | null {
  const auth = asRecord(readCursorConfigFile(profileCursorConfigPath(accountId))?.authInfo)
  return auth ? tokensFromAuthInfo(auth) : null
}

export function hasCursorAuthInfoForAccount(accountId: string): boolean {
  return hasCursorAuthInfo(readCursorConfigFile(profileCursorConfigPath(accountId))?.authInfo)
}

function missingCredential(action: CredentialAction): CredentialResponse {
  return action === 'read' ? { ok: true, found: false } : { ok: true }
}

function runMacKeychain(
  action: CredentialAction,
  service: string,
  secret?: string
): Promise<CredentialResponse> {
  const identityArgs = ['-s', service, '-a', ACCOUNT]

  return new Promise((resolve) => {
    const args =
      action === 'read'
        ? ['find-generic-password', ...identityArgs, '-w']
        : action === 'delete'
          ? ['delete-generic-password', ...identityArgs]
          : ['add-generic-password', ...identityArgs, '-w', secret ?? '']

    const run = (): void => {
      execFile(
        '/usr/bin/security',
        args,
        { encoding: 'utf8', maxBuffer: 1024 * 1024 },
        (error, stdout, stderr) => {
          if (!error) {
            if (action === 'read') {
              const value = stdout.replace(/\r?\n$/, '')
              resolve(value ? { ok: true, found: true, secret: value } : missingCredential(action))
              return
            }
            resolve({ ok: true })
            return
          }

          const detail = `${stderr || ''}${stdout || ''}`.trim()
          if (/could not be found|not found|no keychain/i.test(detail)) {
            resolve(missingCredential(action))
            return
          }
          resolve({
            ok: false,
            error: detail || `macOS Keychain ${action} action failed for ${service}`
          })
        }
      )
    }

    if (action === 'write') {
      execFile(
        '/usr/bin/security',
        ['delete-generic-password', ...identityArgs],
        () => run()
      )
      return
    }

    run()
  })
}

async function runWindowsCredential(
  action: CredentialAction,
  target: string,
  secret?: string
): Promise<CredentialResponse> {
  const { spawn } = await import('child_process')
  const { join: joinPath } = await import('path')

  const script = `
$ErrorActionPreference = 'Stop'
Add-Type @"
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
public static class BikorchCursorCredential {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  private struct CREDENTIAL {
    public int Flags; public int Type;
    [MarshalAs(UnmanagedType.LPWStr)] public string TargetName;
    [MarshalAs(UnmanagedType.LPWStr)] public string Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
    public int CredentialBlobSize; public IntPtr CredentialBlob;
    public int Persist; public int AttributeCount; public IntPtr Attributes;
    [MarshalAs(UnmanagedType.LPWStr)] public string TargetAlias;
    [MarshalAs(UnmanagedType.LPWStr)] public string UserName;
  }
  [DllImport("advapi32.dll", EntryPoint = "CredReadW", CharSet = CharSet.Unicode, SetLastError = true)]
  private static extern bool CredRead(string target, int type, int flags, out IntPtr credentialPtr);
  [DllImport("advapi32.dll", EntryPoint = "CredWriteW", CharSet = CharSet.Unicode, SetLastError = true)]
  private static extern bool CredWrite(ref CREDENTIAL credential, int flags);
  [DllImport("advapi32.dll", EntryPoint = "CredDeleteW", CharSet = CharSet.Unicode, SetLastError = true)]
  private static extern bool CredDelete(string target, int type, int flags);
  [DllImport("advapi32.dll", SetLastError = true)]
  private static extern void CredFree(IntPtr buffer);
  public static string Read(string target) {
    IntPtr pointer;
    if (!CredRead(target, 1, 0, out pointer)) {
      if (Marshal.GetLastWin32Error() == 1168) return null;
      throw new Win32Exception(Marshal.GetLastWin32Error());
    }
    try {
      CREDENTIAL credential = (CREDENTIAL)Marshal.PtrToStructure(pointer, typeof(CREDENTIAL));
      byte[] bytes = new byte[credential.CredentialBlobSize];
      if (bytes.Length > 0) Marshal.Copy(credential.CredentialBlob, bytes, 0, bytes.Length);
      return Convert.ToBase64String(bytes);
    } finally { CredFree(pointer); }
  }
  public static void Write(string target, string username, string base64Secret) {
    byte[] bytes = Convert.FromBase64String(base64Secret);
    IntPtr blob = Marshal.AllocHGlobal(bytes.Length);
    try {
      if (bytes.Length > 0) Marshal.Copy(bytes, 0, blob, bytes.Length);
      CREDENTIAL credential = new CREDENTIAL();
      credential.Type = 1; credential.TargetName = target; credential.UserName = username;
      credential.CredentialBlobSize = bytes.Length; credential.CredentialBlob = blob; credential.Persist = 2;
      if (!CredWrite(ref credential, 0)) throw new Win32Exception(Marshal.GetLastWin32Error());
    } finally { Marshal.FreeHGlobal(blob); }
  }
  public static void Delete(string target) {
    if (CredDelete(target, 1, 0)) return;
    if (Marshal.GetLastWin32Error() != 1168) throw new Win32Exception(Marshal.GetLastWin32Error());
  }
}
"@
$encodedRequest = '${Buffer.from(
    JSON.stringify({ action, target, username: ACCOUNT, ...(secret ? { secret } : {}) }),
    'utf8'
  ).toString('base64')}'
try {
  $json = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($encodedRequest))
  $request = $json | ConvertFrom-Json
  if ($request.action -eq 'read') {
    $value = [BikorchCursorCredential]::Read($request.target)
    @{ ok = $true; found = $null -ne $value; secret = $value } | ConvertTo-Json -Compress
  } elseif ($request.action -eq 'write') {
    [BikorchCursorCredential]::Write($request.target, $request.username, $request.secret)
    @{ ok = $true } | ConvertTo-Json -Compress
  } else {
    [BikorchCursorCredential]::Delete($request.target)
    @{ ok = $true } | ConvertTo-Json -Compress
  }
} catch {
  @{ ok = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress
}
`

  const systemRoot = process.env.SystemRoot ?? 'C:\\Windows'
  const powershell = joinPath(
    systemRoot,
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe'
  )

  return new Promise((resolve) => {
    const child = spawn(
      powershell,
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }
    )
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => {
      stdout = (stdout + chunk.toString('utf8')).slice(-12000)
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString('utf8')).slice(-4000)
    })
    child.on('error', (error) => resolve({ ok: false, error: error.message }))
    child.on('close', () => {
      const line = stdout
        .split(/\r?\n/)
        .map((value) => value.trim())
        .filter(Boolean)
        .at(-1)
      if (!line) {
        resolve({ ok: false, error: stderr.trim() || 'Credential Manager returned no response' })
        return
      }
      try {
        resolve(JSON.parse(line) as CredentialResponse)
      } catch {
        resolve({ ok: false, error: 'Credential Manager returned an invalid response' })
      }
    })
  })
}

async function readServiceSecret(service: string): Promise<string | null> {
  if (process.platform === 'darwin') {
    const result = await runMacKeychain('read', service)
    if (!result.ok) throw new Error(result.error || `Could not read ${service}`)
    return result.found ? result.secret ?? null : null
  }
  if (process.platform === 'win32') {
    const target = service === ACCESS_SERVICE ? WINDOWS_ACCESS_TARGET : WINDOWS_REFRESH_TARGET
    const result = await runWindowsCredential('read', target)
    if (!result.ok) throw new Error(result.error || `Could not read ${service}`)
    return result.found ? result.secret ?? null : null
  }
  return null
}

async function writeServiceSecret(service: string, secret: string): Promise<void> {
  if (process.platform === 'darwin') {
    const result = await runMacKeychain('write', service, secret)
    if (!result.ok) throw new Error(result.error || `Could not write ${service}`)
    return
  }
  if (process.platform === 'win32') {
    const target = service === ACCESS_SERVICE ? WINDOWS_ACCESS_TARGET : WINDOWS_REFRESH_TARGET
    const result = await runWindowsCredential('write', target, secret)
    if (!result.ok) throw new Error(result.error || `Could not write ${service}`)
  }
}

async function deleteServiceSecret(service: string): Promise<void> {
  if (process.platform === 'darwin') {
    const result = await runMacKeychain('delete', service)
    if (!result.ok) throw new Error(result.error || `Could not delete ${service}`)
    return
  }
  if (process.platform === 'win32') {
    const target = service === ACCESS_SERVICE ? WINDOWS_ACCESS_TARGET : WINDOWS_REFRESH_TARGET
    const result = await runWindowsCredential('delete', target)
    if (!result.ok) throw new Error(result.error || `Could not delete ${service}`)
  }
}

export function cursorCredentialsSupported(): boolean {
  return process.platform === 'darwin' || process.platform === 'win32'
}

export async function readCursorKeychainTokens(): Promise<CursorKeychainTokens | null> {
  if (!cursorCredentialsSupported()) return null
  const accessToken = await readServiceSecret(ACCESS_SERVICE)
  const refreshToken = await readServiceSecret(REFRESH_SERVICE)
  if (!accessToken || !refreshToken) return null
  return { accessToken, refreshToken }
}

export async function writeCursorKeychainTokens(tokens: CursorKeychainTokens): Promise<void> {
  if (!cursorCredentialsSupported()) {
    throw new Error('Cursor credential switching is unavailable on this platform')
  }
  await writeServiceSecret(ACCESS_SERVICE, tokens.accessToken)
  await writeServiceSecret(REFRESH_SERVICE, tokens.refreshToken)
}

export async function deleteCursorKeychainTokens(): Promise<void> {
  if (!cursorCredentialsSupported()) return
  await deleteServiceSecret(ACCESS_SERVICE)
  await deleteServiceSecret(REFRESH_SERVICE)
}

function readStoredSession(profileRoot: string): StoredCursorSession | null {
  const path = credentialPath(profileRoot)
  if (!existsSync(path) || !safeStorage.isEncryptionAvailable()) return null
  try {
    const parsed = JSON.parse(safeStorage.decryptString(readFileSync(path))) as StoredCursorSession
    if (!parsed || typeof parsed !== 'object') return null
    return parsed
  } catch {
    return null
  }
}

function sessionTokens(session: StoredCursorSession | null): CursorKeychainTokens | null {
  if (
    !session ||
    typeof session.accessToken !== 'string' ||
    session.accessToken.length === 0 ||
    typeof session.refreshToken !== 'string' ||
    session.refreshToken.length === 0
  ) {
    return null
  }
  return { accessToken: session.accessToken, refreshToken: session.refreshToken }
}

function readStoredTokens(profileRoot: string): CursorKeychainTokens | null {
  return sessionTokens(readStoredSession(profileRoot))
}

function writeStoredSession(profileRoot: string, session: StoredCursorSession): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Secure local credential encryption is not available on this computer')
  }
  mkdirSync(profileRoot, { recursive: true })
  writeFileSync(credentialPath(profileRoot), safeStorage.encryptString(JSON.stringify(session)))
}

export function markCursorSessionAccount(accountId: string | null): void {
  sessionAccountId = accountId
}

export function getCursorSessionAccount(): string | null {
  return sessionAccountId
}

function copyIfPresent(source: string, target: string): void {
  if (!existsSync(source)) return
  mkdirSync(dirname(target), { recursive: true })
  copyFileSync(source, target)
}

function snapshotCursorConfig(accountId: string): void {
  const profileConfig = profileCursorConfigPath(accountId)
  if (existsSync(profileConfig)) {
    copyIfPresent(profileConfig, snapshotConfigPath(accountId))
    return
  }
  copyIfPresent(systemCursorConfigPath(), snapshotConfigPath(accountId))
  copyIfPresent(systemCursorConfigPath(), profileConfig)
}

function restoreCursorConfig(accountId: string): void {
  const snapshot = snapshotConfigPath(accountId)
  const profileConfig = profileCursorConfigPath(accountId)
  const legacy = join(cursorProfileRoot(accountId), 'config', 'cli-config.json')
  const source = existsSync(snapshot)
    ? snapshot
    : existsSync(profileConfig)
      ? profileConfig
      : legacy
  if (!existsSync(source)) return
  copyIfPresent(source, profileConfig)
  copyIfPresent(source, systemCursorConfigPath())
}

function tokensEqual(left: CursorKeychainTokens, right: CursorKeychainTokens): boolean {
  return left.accessToken === right.accessToken && left.refreshToken === right.refreshToken
}

function metadataNameAndEmail(
  metadata: { accountId?: string; email?: string; name?: string } | null,
  identity: CursorTokenIdentity | undefined
): { email: string; name: string } {
  const email = identity?.email || asString(metadata?.email) || ''
  const name = identity?.name || asString(metadata?.name) || email || 'Cursor CLI account'
  return { email, name }
}

export interface CursorAccountConflict {
  accountId: string
  email: string
  name: string
}

export function readStoredCursorTokens(accountId: string): CursorKeychainTokens | null {
  return readStoredTokens(cursorProfileRoot(accountId))
}

export function findConflictingCursorAccount(
  accountId: string,
  tokens: CursorKeychainTokens | null,
  email?: string
): CursorAccountConflict | null {
  const kindRoot = join(app.getPath('userData'), 'cli-profiles', 'cursor')
  if (!existsSync(kindRoot)) return null

  let entries
  try {
    entries = readdirSync(kindRoot, { withFileTypes: true })
  } catch {
    return null
  }

  const incoming = tokens
    ? identityFromJwt(tokens.accessToken)
    : looksLikeEmail(email)
      ? { email }
      : undefined

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const root = join(kindRoot, entry.name)
    let metadata: { accountId?: string; email?: string; name?: string } | null = null
    try {
      metadata = JSON.parse(readFileSync(join(root, 'profile.json'), 'utf8')) as {
        accountId?: string
        email?: string
        name?: string
      }
    } catch {
      metadata = null
    }
    const otherId = asString(metadata?.accountId)
    if (!otherId || otherId === accountId) continue

    const otherTokens = readStoredTokens(root)
    if (tokens && otherTokens && tokensEqual(tokens, otherTokens)) {
      const identity = identityFromJwt(otherTokens.accessToken)
      return { accountId: otherId, ...metadataNameAndEmail(metadata, identity) }
    }

    const otherIdentity = otherTokens
      ? identityFromJwt(otherTokens.accessToken)
      : looksLikeEmail(asString(metadata?.email))
        ? { email: asString(metadata?.email) }
        : undefined

    if (cursorIdentitiesMatch(incoming, otherIdentity)) {
      return { accountId: otherId, ...metadataNameAndEmail(metadata, otherIdentity) }
    }
  }
  return null
}

function tokensOwnedByOtherAccount(accountId: string, tokens: CursorKeychainTokens): boolean {
  return findConflictingCursorAccount(accountId, tokens) !== null
}

export function hasStoredCursorCredentials(accountId: string): boolean {
  return sessionTokens(readStoredSession(cursorProfileRoot(accountId))) !== null
}

export async function captureCursorCredentialsForAccount(
  accountId: string,
  options?: { signedInHint?: boolean }
): Promise<boolean> {
  const readTokens = async (): Promise<CursorKeychainTokens | null> => {
    const keychainTokens = await readCursorKeychainTokens().catch(() => null)
    const profileTokens = readProfileCursorConfigTokens(accountId)
    const systemTokens = readSystemCursorConfigTokens()
    return keychainTokens ?? profileTokens ?? systemTokens
  }

  let tokens = await readTokens()
  if (tokens && tokensOwnedByOtherAccount(accountId, tokens) && options?.signedInHint) {
    await new Promise((resolve) => setTimeout(resolve, 600))
    tokens = await readTokens()
  }
  if (!tokens) return false
  if (tokensOwnedByOtherAccount(accountId, tokens)) return false

  const keychainTokens = await readCursorKeychainTokens().catch(() => null)
  const profileTokens = readProfileCursorConfigTokens(accountId)
  const identity = mergeIdentity(
    identityFromJwt(tokens.accessToken),
    readCursorConfigIdentityFromPath(profileCursorConfigPath(accountId)),
    keychainTokens || profileTokens ? undefined : readSystemCursorConfigIdentity()
  )
  if (!identity?.email && !options?.signedInHint) return false

  snapshotCursorConfig(accountId)
  writeStoredSession(cursorProfileRoot(accountId), {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    signedIn: true,
    ...(identity?.email ? { email: identity.email } : {}),
    ...(identity?.name ? { name: identity.name } : {})
  })
  return true
}

export async function applyCursorCredentialsForAccount(accountId: string): Promise<boolean> {
  const session = readStoredSession(cursorProfileRoot(accountId))
  const tokens = sessionTokens(session)
  if (!tokens) return false
  restoreCursorConfig(accountId)
  await writeCursorKeychainTokens(tokens)
  markCursorSessionAccount(accountId)
  return true
}

export function removeStoredCursorCredentials(accountId: string): void {
  const path = credentialPath(cursorProfileRoot(accountId))
  if (existsSync(path)) rmSync(path, { force: true })
}

export function readStoredCursorConfigIdentity(
  accountId: string
): { email?: string; name?: string } | undefined {
  const snapshot = existsSync(snapshotConfigPath(accountId))
    ? snapshotConfigPath(accountId)
    : join(cursorProfileRoot(accountId), 'config', 'cli-config.json')
  const session = readStoredSession(cursorProfileRoot(accountId))
  const storedTokens = sessionTokens(session)
  return mergeIdentity(
    session?.email || session?.name
      ? { ...(session.email ? { email: session.email } : {}), ...(session.name ? { name: session.name } : {}) }
      : undefined,
    readCursorConfigIdentityFromPath(profileCursorConfigPath(accountId)),
    readCursorConfigIdentityFromPath(snapshot),
    storedTokens ? identityFromJwt(storedTokens.accessToken) : undefined
  )
}

export async function restoreCursorKeychainTokens(
  previous: CursorKeychainTokens | null
): Promise<void> {
  if (previous) {
    await writeCursorKeychainTokens(previous)
    return
  }
  await deleteCursorKeychainTokens()
}
