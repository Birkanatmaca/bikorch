import { existsSync } from 'fs'
import { homedir } from 'os'
import { isAbsolute, normalize, resolve } from 'path'

export function resolveSafeCwd(requestedCwd: string | null | undefined): string {
  if (!requestedCwd || requestedCwd.trim() === '') {
    return homedir()
  }

  const normalized = normalize(requestedCwd.trim())
  const absolute = isAbsolute(normalized) ? normalized : resolve(normalized)

  if (existsSync(absolute)) {
    return absolute
  }

  return homedir()
}

export function isValidSessionId(sessionId: string): boolean {
  return typeof sessionId === 'string' && sessionId.length > 0 && sessionId.length <= 128
}
