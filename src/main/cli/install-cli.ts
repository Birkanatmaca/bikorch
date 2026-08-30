import { execFile } from 'child_process'
import { promisify } from 'util'
import { detectCli, spawnEnv } from './adapters'

const execFileAsync = promisify(execFile)

export async function installCursorCli(): Promise<{ ok: boolean; error?: string }> {
  try {
    await execFileAsync(
      'powershell.exe',
      [
        '-NoLogo',
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        'irm https://cursor.com/install | iex'
      ],
      {
        timeout: 5 * 60 * 1000,
        windowsHide: true,
        env: spawnEnv()
      }
    )
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Cursor CLI install failed'
    }
  }

  if (detectCli('cursor').installed) {
    return { ok: true }
  }

  return {
    ok: false,
    error: 'Install finished but Cursor CLI was still not found. Restart the app and try again.'
  }
}
