import { app, safeStorage } from 'electron'
import { execFile } from 'child_process'
import { createHash } from 'crypto'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'

export interface CursorKeychainTokens {
  accessToken: string
  refreshToken: string
}

function cursorProfileRoot(accountId: string): string {
  const hash = createHash('sha256').update(accountId).digest('hex').slice(0, 32)
  return join(app.getPath('userData'), 'cli-profiles', 'cursor', hash)
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

function credentialPath(profileRoot: string): string {
  return join(profileRoot, 'cursor-credentials.bin')
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
$request = '${Buffer.from(
    JSON.stringify({ action, target, username: ACCOUNT, ...(secret ? { secret } : {}) }),
    'utf8'
  ).toString('base64')}' | ConvertFrom-Json -AsHashtable
try {
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

function readStoredTokens(profileRoot: string): CursorKeychainTokens | null {
  const path = credentialPath(profileRoot)
  if (!existsSync(path)) return null
  if (!safeStorage.isEncryptionAvailable()) return null
  try {
    const parsed = JSON.parse(safeStorage.decryptString(readFileSync(path))) as CursorKeychainTokens
    if (
      typeof parsed.accessToken === 'string' &&
      parsed.accessToken.length > 0 &&
      typeof parsed.refreshToken === 'string' &&
      parsed.refreshToken.length > 0
    ) {
      return parsed
    }
  } catch {
    return null
  }
  return null
}

function writeStoredTokens(profileRoot: string, tokens: CursorKeychainTokens): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Secure local credential encryption is not available on this computer')
  }
  writeFileSync(
    credentialPath(profileRoot),
    safeStorage.encryptString(JSON.stringify(tokens)),
    'utf8'
  )
}

export function hasStoredCursorCredentials(accountId: string): boolean {
  return readStoredTokens(cursorProfileRoot(accountId)) !== null
}

export async function captureCursorCredentialsForAccount(accountId: string): Promise<boolean> {
  const tokens = await readCursorKeychainTokens()
  if (!tokens) return false
  writeStoredTokens(cursorProfileRoot(accountId), tokens)
  return true
}

export async function applyCursorCredentialsForAccount(accountId: string): Promise<boolean> {
  const tokens = readStoredTokens(cursorProfileRoot(accountId))
  if (!tokens) return false
  await writeCursorKeychainTokens(tokens)
  return true
}

export function removeStoredCursorCredentials(accountId: string): void {
  const path = credentialPath(cursorProfileRoot(accountId))
  if (existsSync(path)) rmSync(path, { force: true })
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
