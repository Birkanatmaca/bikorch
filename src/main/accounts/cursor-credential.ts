import { execFile } from 'child_process'

export interface CursorKeychainTokens {
  accessToken: string
  refreshToken: string
}

// Read-only import for older macOS installations. Managed accounts always use
// their own file store and never overwrite or delete the system keychain.
export async function readCursorKeychainTokens(): Promise<CursorKeychainTokens | null> {
  if (process.platform !== 'darwin') return null
  const read = (service: string): Promise<string | null> => new Promise((resolve, reject) => {
    execFile('/usr/bin/security', ['find-generic-password', '-s', service, '-a', 'cursor-user', '-w'],
      { encoding: 'utf8', timeout: 5000, maxBuffer: 64 * 1024 }, (error, stdout, stderr) => {
        if (!error) return resolve(stdout.trim() || null)
        if (/could not be found|not found/i.test(stderr)) return resolve(null)
        reject(new Error('Cursor system credentials could not be read from Keychain.'))
      })
  })
  const [accessToken, refreshToken] = await Promise.all([read('cursor-access-token'), read('cursor-refresh-token')])
  return accessToken && refreshToken ? { accessToken, refreshToken } : null
}
