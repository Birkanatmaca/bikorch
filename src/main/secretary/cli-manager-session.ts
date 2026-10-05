import { spawn } from 'child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import type { CliUsageKind } from '@shared/contracts/usage'
import { spawnEnv, resolveSpawnConfig } from '../cli/adapters'
import { getAuthProfileEnv, prepareAuthProfileLaunch } from '../accounts/profile-manager'
import type { ManagerModelMessage } from './manager-ai-provider'
import {
  managerCliOpenCommand,
  managerCliPrintCommand,
  managerCliSessionId,
  readCursorChatId
} from './cli-manager-launch'
import { normalizeManagerCliOutput } from './cli-manager-output'
import { readManagerDisplayName } from './manager-name'
import type { SecretaryResponseFormat } from './response-schema'

const TURN_TIMEOUT_MS = 90_000
const OPEN_TIMEOUT_MS = 20_000

export interface ManagerCliProcessResult {
  stdout: string
  stderr: string
  code: number | null
}

export type ManagerCliProcess = (input: {
  command: string
  args: string[]
  cwd: string
  env: Record<string, string>
  timeoutMs: number
  stdin?: string
}) => Promise<ManagerCliProcessResult>

function workspaceFor(kind: CliUsageKind, accountId: string): string {
  return join(app.getPath('userData'), 'manager-cli', kind, accountId)
}

function readChatId(workspace: string): string | null {
  try {
    const parsed = JSON.parse(readFileSync(join(workspace, 'session.json'), 'utf8')) as { chatId?: unknown }
    return typeof parsed.chatId === 'string' && parsed.chatId.trim() ? parsed.chatId.trim() : null
  } catch {
    return null
  }
}

function writeChatId(workspace: string, chatId: string): void {
  writeFileSync(join(workspace, 'session.json'), JSON.stringify({
    role: 'manager',
    chatId
  }), { mode: 0o600 })
}

export function runManagerCliProcess(input: {
  command: string
  args: string[]
  cwd: string
  env: Record<string, string>
  timeoutMs: number
  stdin?: string
}): Promise<ManagerCliProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(input.command, input.args, {
      cwd: input.cwd,
      env: input.env,
      shell: false,
      windowsHide: true,
      stdio: [input.stdin === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe']
    })
    if (input.stdin !== undefined && child.stdin) {
      child.stdin.on('error', () => undefined)
      child.stdin.end(input.stdin)
    }
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      reject(new Error('The Manager CLI did not answer in time.'))
    }, input.timeoutMs)
    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      if (stdout.length < 1_000_000) stdout += chunk
    })
    child.stderr?.on('data', (chunk: string) => {
      if (stderr.length < 200_000) stderr += chunk
    })
    child.on('error', (cause) => {
      clearTimeout(timer)
      const code = cause && typeof cause === 'object' && 'code' in cause ? cause.code : undefined
      if (code === 'ENAMETOOLONG') {
        reject(new Error('The Manager CLI could not start because the command was too long for this system.'))
        return
      }
      reject(cause)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ stdout, stderr, code })
    })
  })
}

function promptFor(input: ManagerModelMessage[], format: SecretaryResponseFormat): string {
  const turns = input.map((message) => {
    const text = message.content.map((part) => part.text).join('\n')
    return `${message.role}:\n${text}`
  }).join('\n\n')
  return [
    `You are ${readManagerDisplayName()}. Think, chat, and plan only.`,
    'Do not edit files, run commands, or change the workspace. Coding work is dispatched later, after the user approves.',
    'Reply with one JSON object and no markdown. It must match this schema:',
    JSON.stringify(format.schema),
    '',
    turns
  ].join('\n')
}

function failureMessage(result: ManagerCliProcessResult): string {
  const detail = `${result.stderr}\n${result.stdout}`.toLowerCase()
  if (/sign in|not logged|login|unauthenticated|authentication|unauthorized/.test(detail)) {
    return 'Authentication required'
  }
  return 'The Manager CLI returned no structured result.'
}

export function createManagerCliRunner(processRun: ManagerCliProcess = runManagerCliProcess) {
  async function prepared(kind: CliUsageKind, accountId: string): Promise<{ workspace: string; env: Record<string, string>; command: string; baseArgs: string[] }> {
    const launch = await prepareAuthProfileLaunch({ kind, accountId }, 'normal')
    if (!launch.ok) throw new Error(launch.error ?? 'Could not prepare the CLI account')
    if (!launch.ready) throw new Error('Authentication required')
    const spawnConfig = resolveSpawnConfig(kind)
    const workspace = workspaceFor(kind, accountId)
    mkdirSync(workspace, { recursive: true })
    return {
      workspace,
      env: { ...spawnEnv(), ...getAuthProfileEnv(kind, accountId) },
      command: spawnConfig.command,
      baseArgs: spawnConfig.args
    }
  }

  return {
    sessionId(kind: CliUsageKind, accountId: string): string {
      return managerCliSessionId(kind, accountId)
    },

    async open(kind: CliUsageKind, accountId: string): Promise<string> {
      const ready = await prepared(kind, accountId)
      const sessionId = managerCliSessionId(kind, accountId)
      const open = managerCliOpenCommand({ kind, command: ready.command, baseArgs: ready.baseArgs })
      if (!open) return sessionId
      const result = await processRun({
        command: open.command,
        args: open.args,
        cwd: ready.workspace,
        env: ready.env,
        timeoutMs: OPEN_TIMEOUT_MS
      })
      if (result.code !== 0) throw new Error(failureMessage(result))
      const chatId = readCursorChatId(result.stdout)
      if (chatId) writeChatId(ready.workspace, chatId)
      return sessionId
    },

    async generate(input: {
      kind: CliUsageKind
      accountId: string
      model: string | null
      messages: ManagerModelMessage[]
      format: SecretaryResponseFormat
    }): Promise<string> {
      const ready = await prepared(input.kind, input.accountId)
      let chatId = input.kind === 'cursor' ? readChatId(ready.workspace) : null
      if (input.kind === 'cursor' && !chatId) {
        const open = managerCliOpenCommand({ kind: input.kind, command: ready.command, baseArgs: ready.baseArgs })
        if (open) {
          const opened = await processRun({
            command: open.command,
            args: open.args,
            cwd: ready.workspace,
            env: ready.env,
            timeoutMs: OPEN_TIMEOUT_MS
          })
          const created = opened.code === 0 ? readCursorChatId(opened.stdout) : null
          if (created) {
            writeChatId(ready.workspace, created)
            chatId = created
          }
        }
      }
      const command = managerCliPrintCommand({
        kind: input.kind,
        command: ready.command,
        baseArgs: ready.baseArgs,
        workspace: ready.workspace,
        model: input.model,
        chatId,
        prompt: promptFor(input.messages, input.format)
      })
      const result = await processRun({
        command: command.command,
        args: command.args,
        cwd: ready.workspace,
        env: ready.env,
        stdin: command.stdin,
        timeoutMs: TURN_TIMEOUT_MS
      })
      if (result.code !== 0 && !result.stdout.trim()) throw new Error(failureMessage(result))
      return normalizeManagerCliOutput(result.stdout, input.format)
    }
  }
}
