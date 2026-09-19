import { execFileSync } from 'child_process'
import { existsSync } from 'fs'
import { homedir } from 'os'
import { isAbsolute, join, normalize, resolve } from 'path'

const shortPathCache = new Map<string, string>()

function queryWindowsShortPath(target: string): string {
  if (process.platform !== 'win32' || !/[^\u0000-\u007F]/.test(target) || !existsSync(target)) {
    return target
  }
  const cached = shortPathCache.get(target)
  if (cached) return cached
  try {
    const powershell = join(
      process.env.SystemRoot ?? 'C:\\Windows',
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe'
    )
    const out = execFileSync(
      existsSync(powershell) ? powershell : 'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        '$p = $env:BIKORCH_CWD; $f = New-Object -ComObject Scripting.FileSystemObject; if (Test-Path -LiteralPath $p -PathType Container) { $f.GetFolder($p).ShortPath } elseif (Test-Path -LiteralPath $p -PathType Leaf) { $f.GetFile($p).ShortPath } else { $p }'
      ],
      {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 4000,
        env: { ...process.env, BIKORCH_CWD: target }
      }
    )
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .at(-1)
    const resolved = out && existsSync(out) ? out : target
    shortPathCache.set(target, resolved)
    return resolved
  } catch {
    return target
  }
}

export function resolveWindowsSpawnPath(target: string): string {
  return queryWindowsShortPath(target)
}

export function isSameFilePath(left: string, right: string): boolean {
  const a = resolve(left)
  const b = resolve(right)
  if (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b) {
    return true
  }
  if (process.platform !== 'win32') return false
  return resolveWindowsSpawnPath(a).toLowerCase() === resolveWindowsSpawnPath(b).toLowerCase()
}

export function resolveSafeCwd(requestedCwd: string | null | undefined): string {
  if (!requestedCwd || requestedCwd.trim() === '') {
    return homedir()
  }

  const normalized = normalize(requestedCwd.trim())
  const absolute = isAbsolute(normalized) ? normalized : resolve(normalized)
  return existsSync(absolute) ? absolute : homedir()
}

export function isValidSessionId(sessionId: string): boolean {
  return typeof sessionId === 'string' && sessionId.length > 0 && sessionId.length <= 128
}
