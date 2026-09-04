import * as pty from '@homebridge/node-pty-prebuilt-multiarch'
import { resolveSpawnConfigCandidates, spawnEnv } from '../cli/adapters'
import {
  deleteAntigravityCredential,
  readAntigravityCredential
} from './windows-credential'

const LOGOUT_TIMEOUT_MS = 18000
const READY_DELAY_MS = 300
const COMMAND_ENTRY_DELAY_MS = 180
const SUBMIT_DELAY_MS = 400
const OUTPUT_LIMIT = 80_000

function stripTerminalControlCodes(value: string): string {
  return value
    .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, '')
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\u001b[@-_]/g, '')
    .replace(/\r/g, '')
}

function isPromptReady(output: string): boolean {
  return /(?:^|\n)>\s*(?:\n|$)/m.test(output)
}

function looksSignedOut(output: string): boolean {
  return /logged out|signed out|not signed in|please (?:sign|log) in|authentication required|sign in with google/i.test(
    output
  )
}

async function credentialCleared(): Promise<boolean> {
  try {
    return (await readAntigravityCredential()) === null
  } catch {
    return false
  }
}

function runAntigravityLogoutCommand(): Promise<void> {
  const config = resolveSpawnConfigCandidates('antigravity')[0]
  if (!config) {
    return Promise.reject(new Error('Antigravity CLI is not installed'))
  }

  return new Promise((resolve, reject) => {
    const terminal = pty.spawn(config.command, config.args, {
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
      finishError(new Error('Antigravity /logout timed out'))
    }, LOGOUT_TIMEOUT_MS)

    const cleanup = (): void => {
      if (readyTimer) clearTimeout(readyTimer)
      if (entryTimer) clearTimeout(entryTimer)
      if (submitTimer) clearTimeout(submitTimer)
      clearTimeout(timeout)
      try {
        terminal.kill()
      } catch {
        // Process may already have exited.
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

    const succeedIfSignedOut = async (): Promise<boolean> => {
      const cleanOutput = stripTerminalControlCodes(output)
      if (looksSignedOut(cleanOutput) || (await credentialCleared())) {
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
      void succeedIfSignedOut().then((done) => {
        if (done || settled || commandSent || commandScheduled) return
        if (isPromptReady(stripTerminalControlCodes(output))) {
          commandScheduled = true
          readyTimer = setTimeout(sendLogout, READY_DELAY_MS)
        }
      })
    })

    terminal.onExit(() => {
      void succeedIfSignedOut().then((done) => {
        if (!done) finishError(new Error('Antigravity /logout did not complete'))
      })
    })
  })
}

export async function logoutAntigravityCli(): Promise<void> {
  if (await credentialCleared()) return

  try {
    await runAntigravityLogoutCommand()
  } catch {
    // Keychain cleanup below is the fallback if the CLI command does not finish.
  }

  await deleteAntigravityCredential()
}
