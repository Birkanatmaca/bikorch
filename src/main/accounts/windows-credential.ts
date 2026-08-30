import { spawn } from 'child_process'
import { join } from 'path'

type CredentialAction = 'read' | 'write' | 'delete'

interface CredentialResponse {
  ok: boolean
  found?: boolean
  secret?: string
  error?: string
}

const WINDOWS_CREDENTIAL_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$source = @"
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;

public static class BikorchCredential {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  private struct CREDENTIAL {
    public int Flags;
    public int Type;
    [MarshalAs(UnmanagedType.LPWStr)] public string TargetName;
    [MarshalAs(UnmanagedType.LPWStr)] public string Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
    public int CredentialBlobSize;
    public IntPtr CredentialBlob;
    public int Persist;
    public int AttributeCount;
    public IntPtr Attributes;
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
      int error = Marshal.GetLastWin32Error();
      if (error == 1168) return null;
      throw new Win32Exception(error);
    }

    try {
      CREDENTIAL credential = (CREDENTIAL)Marshal.PtrToStructure(pointer, typeof(CREDENTIAL));
      byte[] bytes = new byte[credential.CredentialBlobSize];
      if (bytes.Length > 0) Marshal.Copy(credential.CredentialBlob, bytes, 0, bytes.Length);
      return Convert.ToBase64String(bytes);
    } finally {
      CredFree(pointer);
    }
  }

  public static void Write(string target, string username, string base64Secret) {
    byte[] bytes = Convert.FromBase64String(base64Secret);
    IntPtr blob = Marshal.AllocHGlobal(bytes.Length);
    try {
      if (bytes.Length > 0) Marshal.Copy(bytes, 0, blob, bytes.Length);
      CREDENTIAL credential = new CREDENTIAL();
      credential.Type = 1;
      credential.TargetName = target;
      credential.UserName = username;
      credential.CredentialBlobSize = bytes.Length;
      credential.CredentialBlob = blob;
      credential.Persist = 2;
      if (!CredWrite(ref credential, 0)) throw new Win32Exception(Marshal.GetLastWin32Error());
    } finally {
      Marshal.FreeHGlobal(blob);
    }
  }

  public static void Delete(string target) {
    if (CredDelete(target, 1, 0)) return;
    int error = Marshal.GetLastWin32Error();
    if (error != 1168) throw new Win32Exception(error);
  }
}
"@

Add-Type -TypeDefinition $source

function Invoke-BikorchCredential([string]$encodedRequest) {
  try {
    $json = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($encodedRequest))
    $request = $json | ConvertFrom-Json
    if ($request.action -eq 'read') {
      $secret = [BikorchCredential]::Read($request.target)
      @{ ok = $true; found = $null -ne $secret; secret = $secret } | ConvertTo-Json -Compress
      return
    }
    if ($request.action -eq 'write') {
      [BikorchCredential]::Write($request.target, $request.username, $request.secret)
      @{ ok = $true } | ConvertTo-Json -Compress
      return
    }
    if ($request.action -eq 'delete') {
      [BikorchCredential]::Delete($request.target)
      @{ ok = $true } | ConvertTo-Json -Compress
      return
    }
    throw 'Unsupported credential action'
  } catch {
    @{ ok = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress
  }
}
`

function powershellPath(): string {
  const systemRoot = process.env.SystemRoot ?? 'C:\\Windows'
  return join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
}

async function runCredentialAction(
  action: CredentialAction,
  secret?: string
): Promise<CredentialResponse> {
  if (process.platform !== 'win32') {
    return { ok: false, error: 'Windows Credential Manager is only available on Windows' }
  }

  const request = Buffer.from(
    JSON.stringify({
      action,
      target: 'gemini:antigravity',
      username: 'antigravity',
      ...(secret ? { secret } : {})
    }),
    'utf8'
  ).toString('base64')

  return new Promise((resolve) => {
    const child = spawn(
      powershellPath(),
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', '-'],
      { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }
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
    child.stdin.end(`${WINDOWS_CREDENTIAL_SCRIPT}\nInvoke-BikorchCredential '${request}'\n`)
  })
}

export async function readAntigravityCredential(): Promise<string | null> {
  const result = await runCredentialAction('read')
  if (!result.ok) throw new Error(result.error || 'Could not read Antigravity credential')
  return result.found ? result.secret ?? null : null
}

export async function writeAntigravityCredential(secret: string): Promise<void> {
  const result = await runCredentialAction('write', secret)
  if (!result.ok) throw new Error(result.error || 'Could not write Antigravity credential')
}

export async function deleteAntigravityCredential(): Promise<void> {
  const result = await runCredentialAction('delete')
  if (!result.ok) throw new Error(result.error || 'Could not remove Antigravity credential')
}
