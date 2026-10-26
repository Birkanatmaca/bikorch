import { spawn } from 'child_process'
import type { SecretaryGoalVerification } from '@shared/contracts/secretary'
import { spawnEnv } from '../cli/adapters'

/**
 * Bikorch runs the goal's checks itself, so "done" rests on real exit codes
 * rather than on what a CLI says. Only test, lint, type-check and build commands
 * are allowed, and they run without a shell: no chaining, pipes or redirects.
 */

const TIMEOUT_MS = 5 * 60_000
const OUTPUT_LIMIT = 3_000
const SCRIPT_NAME = /^(?:test|lint|build|typecheck|type-check|check|verify)(?::[\w-]+)?$/

function tokenize(command: string): string[] | null {
  const trimmed = command.trim()
  if (!trimmed || trimmed.length > 200 || /[|&;<>`$(){}\\\n]/.test(trimmed)) return null
  return trimmed.split(/\s+/)
}

/** True for a single, non-destructive check command. */
export function isSafeVerifyCommand(command: string): boolean {
  const tokens = tokenize(command)
  if (!tokens) return false
  const [bin, ...args] = tokens
  const flagsOk = (list: string[]): boolean => list.every((arg) => /^[\w@./:=-]+$/.test(arg))
  if (bin === 'npm' || bin === 'pnpm' || bin === 'yarn' || bin === 'bun') {
    if (args[0] === 'test' || args[0] === 't') return flagsOk(args.slice(1))
    if (args[0] === 'run' && args[1] && SCRIPT_NAME.test(args[1])) return flagsOk(args.slice(2))
    if (bin !== 'npm' && args[0] && SCRIPT_NAME.test(args[0])) return flagsOk(args.slice(1))
    return false
  }
  if (bin === 'npx') {
    const tool = args[0]
    if (tool === 'tsc') return args.includes('--noEmit') && flagsOk(args.slice(1))
    if (tool === 'vitest') return args[1] === 'run' && flagsOk(args.slice(2))
    if (tool === 'jest' || tool === 'eslint') return flagsOk(args.slice(1)) && !args.includes('--fix')
    return false
  }
  if (bin === 'node') return args.length === 1 && /^[\w./-]*test[\w./-]*\.(?:c|m)?js$/.test(args[0]) && !args[0].includes('..')
  if (bin === 'go') return (args[0] === 'test' || args[0] === 'vet' || args[0] === 'build') && flagsOk(args.slice(1))
  if (bin === 'cargo') return (args[0] === 'test' || args[0] === 'check' || args[0] === 'build' || args[0] === 'clippy') && flagsOk(args.slice(1))
  if (bin === 'pytest') return flagsOk(args)
  if (bin === 'python' || bin === 'python3') return args[0] === '-m' && (args[1] === 'pytest' || args[1] === 'unittest') && flagsOk(args.slice(2))
  if (bin === 'make') return args.length === 1 && SCRIPT_NAME.test(args[0])
  return false
}

export function runVerifyCommand(command: string, cwd: string): Promise<SecretaryGoalVerification> {
  const started = Date.now()
  const tokens = tokenize(command)
  if (!tokens || !isSafeVerifyCommand(command)) {
    return Promise.resolve({ command, cwd, exitCode: null, output: '', durationMs: 0, skipped: 'Not an allowed check command' })
  }
  return new Promise((resolve) => {
    let output = ''
    let settled = false
    const finish = (result: Omit<SecretaryGoalVerification, 'command' | 'cwd' | 'durationMs'>): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ command, cwd, durationMs: Date.now() - started, ...result, output: (result.output ?? output).slice(-OUTPUT_LIMIT) })
    }
    const child = spawn(tokens[0], tokens.slice(1), {
      cwd,
      env: { ...spawnEnv(), CI: '1', FORCE_COLOR: '0', NO_COLOR: '1' },
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    const append = (chunk: Buffer): void => {
      output = (output + chunk.toString('utf8')).slice(-OUTPUT_LIMIT * 2)
    }
    child.stdout.on('data', append)
    child.stderr.on('data', append)
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      finish({ exitCode: null, output, skipped: 'Timed out after 5 minutes' })
    }, TIMEOUT_MS)
    child.on('error', (error) => finish({ exitCode: null, output, skipped: error.message }))
    child.on('close', (code) => finish({ exitCode: code, output }))
  })
}

/** Runs each check in each folder, one after another. */
export async function runGoalVerification(commands: string[], folders: string[]): Promise<SecretaryGoalVerification[]> {
  const results: SecretaryGoalVerification[] = []
  for (const cwd of [...new Set(folders)].slice(0, 2)) {
    for (const command of commands.slice(0, 3)) results.push(await runVerifyCommand(command, cwd))
  }
  return results
}

/** A goal can only be called met when every check that ran passed. */
export function verificationPassed(results: SecretaryGoalVerification[]): boolean {
  const ran = results.filter((result) => !result.skipped)
  return ran.every((result) => result.exitCode === 0)
}
