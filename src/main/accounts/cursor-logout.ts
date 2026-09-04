import * as pty from '@homebridge/node-pty-prebuilt-multiarch'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { resolveSpawnConfigCandidates, spawnEnv } from '../cli/adapters'
import { deleteCursorKeychainTokens } from './cursor-credential'

const LOGOUT_TIMEOUT_MS = 18000
const READY_DELAY_MS = 300
const COMMAND_ENTRY_DELAY_MS = 180
const SUBMIT_DELAY_MS = 400
const OUTPUT_LIMIT = 80_000

function systemCursorConfigPath(): string {
  return join(homedir(), '.cursor', 'cli-config.json')
}

function stripTerminalControlCodes(value: string): string {
  return value
    .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, '')
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\u001b[@-_]/g, '')
    .replace(/\r/g, '')
}

function looksSignedOut(output: string): boolean {
  return /logged out|signed out|not logged in|not signed in|please (?:sign|log) in|authentication required/i.test(
    output
  )
}

function isPromptReady(output: string): boolean {
  return /Plan,\s*search,\s*build anything/i.test(output) || /(?:^|\n)>\s*(?:\n|$)/m.test(output)
}

function clearSystemCursorAuth(): void {
  const path = systemCursorConfigPath()
  if (!existsSync(path)) return
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
    if (!parsed.authInfo) return
    delete parsed.authInfo
    writeFileSync(path, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8')
  } catch {
    // Leave the file alone if it cannot be rewritten.
  }
}

function runCursorLogoutCommand(): Promise<void> {
  const config = resolveSpawnConfigCandidates('cursor')[0]
  if (!config) {
    return Promise.reject(new Error('Cursor CLI is not installed'))
  }

  return new Promise((resolve, reject) => {
    const terminal = pty.spawn(config.command, [...config.args, 'logout'], {
      name: 'xterm-256color',
      cols: 120,
      rows: 40,
      cwd: process.cwd(),
      env: {
        ...spawnEnv(),
        CI: '1',
        BROWSER: 'true'
      },
      ...(process.platform === 'win32' ? { useConpty: false } : {})
    })

    let output = ''
    let settled = false
    let commandSent = false
    let commandScheduled = false
    let readyTimer: NodeJS.Timeout | null = null
    let entryTimer: NodeJS.Timeout | null = null
    let submitTimer: NodeJS.Timeout | null = null
    const timeout = setTimeout(() => {
      finishError(new Error('Cursor logout timed out'))
    }, LOGOUT_TIMEOUT_MS)

    const cleanup = (): void => {
      if (readyTimer) clearTimeout(readyTimer)
      if (entryTimer) clearTimeout(entryTimer)
      if (submitTimer) clearTimeout(submitTimer)
      clearTimeout(timeout)
      try {
        terminal.kill()
      } catch {
        // The process may already have exited.
      }
    }

    const finish = (callback: () => void): void => {
      if (settled) return
      settled = true
      cleanup()
      callback()
    }

    const finishError = (error: Error): void => finish(() => reject(error))
    const finishOk = (): void => finish(() => resolve())

    const succeedIfSignedOut = (): boolean => {
      if (looksSignedOut(stripTerminalControlCodes(output))) {
        finishOk()
        return true
      }
      return false
    }

    const sendLogout = (): void => {
      if (settled || commandSent) return
      commandSent = true
      terminal.write('\x15')
      entryTimer = setTimeout(() => {
        if (settled) return
        terminal.write('/logout')
        submitTimer = setTimeout(() => {
          if (!settled) terminal.write('\r')
        }, SUBMIT_DELAY_MS)
      }, COMMAND_ENTRY_DELAY_MS)
    }

    terminal.onData((chunk) => {
      output = `${output}${chunk}`.slice(-OUTPUT_LIMIT)
      if (succeedIfSignedOut() || settled || commandSent || commandScheduled) return
      if (isPromptReady(stripTerminalControlCodes(output))) {
        commandScheduled = true
        readyTimer = setTimeout(sendLogout, READY_DELAY_MS)
      }
    })

    terminal.onExit(() => {
      if (!succeedIfSignedOut()) finishOk()
    })
  })
}

export async function logoutCursorCli(): Promise<void> {
  try {
    await runCursorLogoutCommand()
  } catch {
    // Keychain cleanup below is the fallback if the CLI command does not finish.
  }

  await deleteCursorKeychainTokens()
  clearSystemCursorAuth()
}
