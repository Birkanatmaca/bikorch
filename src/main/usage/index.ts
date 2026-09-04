import { spawn } from 'child_process'
import { existsSync, readFileSync } from 'fs'
import * as pty from '@homebridge/node-pty-prebuilt-multiarch'
import { homedir } from 'os'
import { join } from 'path'
import type {
  CliUsageRequest,
  CliUsageBreakdown,
  CliUsageInfo,
  CliUsageKind,
  CliUsageResponse,
  CliUsageWindow,
  UsageAccountRequest
} from '@shared/contracts/usage'
import { detectCli, resolveSpawnConfigCandidates, spawnEnv } from '../cli/adapters'
import { getAuthProfileEnv, prepareAuthProfileLaunch } from '../accounts/profile-manager'
import {
  deleteAntigravityCredential,
  readAntigravityCredential,
  writeAntigravityCredential
} from '../accounts/windows-credential'
import {
  applyAntigravityCredentialsForAccount,
  getAntigravitySessionAccount,
  hasStoredAntigravityCredentials
} from '../accounts/antigravity-credential'
import {
  cursorCredentialsSupported
} from '../accounts/cursor-credential'
import {
  withAntigravityCredentialLock,
  withCursorCredentialLock
} from '../accounts/credential-lock'

const USAGE_KINDS: CliUsageKind[] = ['claude', 'cursor', 'gemini', 'antigravity', 'codex']

const USAGE_LABELS: Record<CliUsageKind, string> = {
  claude: 'Claude Code',
  cursor: 'Cursor CLI',
  gemini: 'Gemini CLI',
  antigravity: 'Antigravity CLI',
  codex: 'Codex CLI'
}

interface JsonRecord {
  [key: string]: unknown
}

interface CliAccountIdentity {
  accountEmail?: string
  accountName?: string
}

interface UsageScope {
  accountId?: string
}

function usageRequestKey(request: UsageAccountRequest): string {
  return `${request.kind}:${request.accountId}`
}

const INTERACTIVE_USAGE_READY_DELAY_MS = 300
const INTERACTIVE_USAGE_COMMAND_ENTRY_DELAY_MS = 180
const INTERACTIVE_USAGE_SUBMIT_DELAY_MS = 400
const INTERACTIVE_USAGE_RETRY_DELAY_MS = 3500
const INTERACTIVE_USAGE_SETTLE_DELAY_MS = 120
const INTERACTIVE_USAGE_TIMEOUT_MS = 18000
const INTERACTIVE_USAGE_OUTPUT_LIMIT = 120000

function withCursorUsageLock<T>(task: () => Promise<T>): Promise<T> {
  return withCursorCredentialLock(task)
}

function withAntigravityUsageLock<T>(task: () => Promise<T>): Promise<T> {
  return withAntigravityCredentialLock(task)
}

interface CodexUsageSnapshot {
  planType: string | null
  primary: CliUsageWindow | undefined
  secondary: CliUsageWindow | undefined
  credits:
    | {
        hasCredits: boolean
        unlimited: boolean
        balance: string | null
      }
    | undefined
}

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : null
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function readJsonFile(path: string): JsonRecord | null {
  if (!existsSync(path)) return null
  try {
    return asRecord(JSON.parse(readFileSync(path, 'utf8')))
  } catch {
    return null
  }
}

function getNestedValue(root: unknown, keys: string[]): unknown {
  let value: unknown = root
  for (const key of keys) {
    const record = asRecord(value)
    if (!record) return undefined
    value = record[key]
  }
  return value
}

function decodeJwtPayload(token: string): JsonRecord | null {
  const encodedPayload = token.split('.')[1]
  if (!encodedPayload) return null
  try {
    const normalized = encodedPayload.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
    return asRecord(JSON.parse(Buffer.from(padded, 'base64').toString('utf8')))
  } catch {
    return null
  }
}

function readLocalAccountIdentity(
  kind: CliUsageKind,
  profileEnv: Record<string, string> = {}
): CliAccountIdentity {
  const root = homedir()

  if (kind === 'cursor') {
    const configDir = profileEnv.CURSOR_CONFIG_DIR ?? join(root, '.cursor')
    const config = readJsonFile(join(configDir, 'cli-config.json'))
    const authInfo = asRecord(config?.authInfo)
    const accountEmail = asString(authInfo?.email)
    const accountName = asString(authInfo?.displayName)
    return {
      ...(accountEmail ? { accountEmail } : {}),
      ...(accountName ? { accountName } : {})
    }
  }

  if (kind === 'gemini') {
    const geminiHome = profileEnv.GEMINI_CLI_HOME ?? root
    const accounts = readJsonFile(join(geminiHome, '.gemini', 'google_accounts.json'))
    const accountEmail = asString(accounts?.active)
    return accountEmail ? { accountEmail } : {}
  }

  if (kind === 'codex') {
    const codexHome = profileEnv.CODEX_HOME ?? join(root, '.codex')
    const auth = readJsonFile(join(codexHome, 'auth.json'))
    const tokens = asRecord(auth?.tokens)
    const idToken = asString(tokens?.id_token)
    const payload = idToken ? decodeJwtPayload(idToken) : null
    const nestedEmail =
      asString(payload?.email) ??
      asString(payload?.email_address) ??
      asString(getNestedValue(payload, ['https://api.openai.com/auth', 'email']))
    return nestedEmail ? { accountEmail: nestedEmail } : {}
  }

  if (kind === 'claude') {
    const configDir = profileEnv.CLAUDE_CONFIG_DIR ?? join(root, '.claude')
    const credentials = readJsonFile(join(configDir, '.credentials.json'))
    const oauth = asRecord(credentials?.claudeAiOauth)
    const accountEmail =
      asString(oauth?.emailAddress) ?? asString(oauth?.email) ?? asString(credentials?.email)
    return accountEmail ? { accountEmail } : {}
  }

  return {}
}

function parseWindow(value: unknown): CliUsageWindow | undefined {
  const record = asRecord(value)
  if (!record) return undefined

  const usedPercent = asFiniteNumber(record.usedPercent)
  const windowDurationMins = asFiniteNumber(record.windowDurationMins)
  if (usedPercent === null || windowDurationMins === null || windowDurationMins <= 0) {
    return undefined
  }

  const resetsAt = asFiniteNumber(record.resetsAt)
  return {
    usedPercent: Math.min(100, Math.max(0, usedPercent)),
    windowDurationMins,
    resetsAt,
    resetLabel: null
  }
}

function parseCodexUsage(value: unknown): CodexUsageSnapshot | null {
  const root = asRecord(value)
  const rateLimits = asRecord(root?.rateLimits)
  if (!rateLimits) return null

  const primary = parseWindow(rateLimits.primary)
  const secondary = parseWindow(rateLimits.secondary)
  const creditsRecord = asRecord(rateLimits.credits)
  const credits = creditsRecord
    ? {
        hasCredits: creditsRecord.hasCredits === true,
        unlimited: creditsRecord.unlimited === true,
        balance: asString(creditsRecord.balance)
      }
    : undefined

  return {
    planType: asString(rateLimits.planType),
    primary,
    secondary,
    credits
  }
}

function queryCodexRateLimits(profileEnv: Record<string, string> = {}): Promise<CodexUsageSnapshot> {
  const config = resolveSpawnConfigCandidates('codex')[0]
  if (!config) {
    return Promise.reject(new Error('Codex CLI is not installed'))
  }

  return new Promise((resolve, reject) => {
    const process = spawn(config.command, [...config.args, 'app-server'], {
      cwd: undefined,
      env: { ...spawnEnv(), ...profileEnv },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    })

    let outputBuffer = ''
    let errorOutput = ''
    let settled = false
    const timeout = setTimeout(() => {
      finishError(new Error('Codex rate limit request timed out'))
    }, 10000)

    const finish = (callback: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      callback()
      try {
        process.kill()
      } catch {
        // The process may already have exited.
      }
    }

    const finishError = (error: Error): void => finish(() => reject(error))

    const handleLine = (line: string): void => {
      if (!line.trim()) return

      let message: JsonRecord
      try {
        const parsed: unknown = JSON.parse(line)
        const record = asRecord(parsed)
        if (!record) return
        message = record
      } catch {
        return
      }

      if (message.id !== 2) return
      if (asRecord(message.error)) {
        const errorMessage = asString(asRecord(message.error)?.message) ?? 'Codex returned an error'
        finishError(new Error(errorMessage))
        return
      }

      const snapshot = parseCodexUsage(message.result)
      if (!snapshot) {
        finishError(new Error('Codex did not return rate limit data'))
        return
      }
      finish(() => resolve(snapshot))
    }

    process.stdout.on('data', (chunk: Buffer | string) => {
      outputBuffer += chunk.toString()
      let newlineIndex = outputBuffer.indexOf('\n')
      while (newlineIndex >= 0) {
        handleLine(outputBuffer.slice(0, newlineIndex).replace(/\r$/, ''))
        outputBuffer = outputBuffer.slice(newlineIndex + 1)
        newlineIndex = outputBuffer.indexOf('\n')
      }
    })

    process.stderr.on('data', (chunk: Buffer | string) => {
      errorOutput = (errorOutput + chunk.toString()).slice(-500)
    })

    process.on('error', (error) => finishError(error))
    process.on('exit', (code) => {
      if (settled) return
      const detail = errorOutput.trim() || `Codex app-server exited with code ${code ?? 'unknown'}`
      finishError(new Error(detail))
    })

    const send = (payload: JsonRecord): void => {
      process.stdin.write(`${JSON.stringify(payload)}\n`)
    }

    send({
      method: 'initialize',
      id: 1,
      params: {
        clientInfo: {
          name: 'bikorch_usage',
          title: 'BIKORCH Usage',
          version: '0.1.0'
        },
        capabilities: { experimentalApi: true }
      }
    })
    send({ method: 'initialized', params: {} })
    send({ method: 'account/rateLimits/read', id: 2, params: {} })
  })
}

interface CursorUsageSnapshot {
  planType: string | null
  resetLabel: string | null
  primary: CliUsageWindow | undefined
  breakdown: CliUsageBreakdown[]
}

interface AntigravityUsageSnapshot {
  accountEmail: string | null
  planType: string | null
  primary: CliUsageWindow | undefined
  secondary: CliUsageWindow | undefined
  breakdown: CliUsageBreakdown[]
}

interface GeminiUsageSnapshot {
  planType: string | null
  primary: CliUsageWindow | undefined
  breakdown: CliUsageBreakdown[]
}

interface InteractiveUsageFailure {
  status: Extract<CliUsageInfo['status'], 'error' | 'unavailable'>
  detail: string
}

interface InteractiveUsageOptions<T> {
  command: string
  parse: (output: string) => T | null
  isReady: (output: string) => boolean
  detectFailure?: (output: string) => InteractiveUsageFailure | null
  detectFailureAfterCommand?: boolean
  extraArgs?: string[]
  timeoutMs?: number
}

class InteractiveUsageError extends Error {
  readonly status: InteractiveUsageFailure['status']

  constructor(failure: InteractiveUsageFailure) {
    super(failure.detail)
    this.name = 'InteractiveUsageError'
    this.status = failure.status
  }
}

function stripTerminalControlCodes(value: string): string {
  return value
    .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, '')
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\u001b[@-_]/g, '')
    .replace(/\r/g, '')
}

function parseCursorUsage(output: string): CursorUsageSnapshot | null {
  const lines = stripTerminalControlCodes(output)
    .split('\n')
    .map((line) => line.trimEnd())
  const usageIndex = lines.findIndex((line) => /Usage\s*[•·]/i.test(line))
  if (usageIndex < 0) return null

  const header = lines[usageIndex] ?? ''
  const headerMatch = header.match(/Usage\s*[•·]\s*(.+?)(?:\s+Resets\s+(.+))?$/i)
  const planType = headerMatch?.[1]?.trim() || null
  const resetLabel = headerMatch?.[2]?.trim() || null
  const breakdown: CliUsageBreakdown[] = []

  for (const line of lines.slice(usageIndex + 1, usageIndex + 16)) {
    const match = line.match(/^\s*(Included|Auto|API|On-Demand)\s+(.+?)\s*$/i)
    if (!match) continue

    const label = match[1]
    const value = match[2].replace(/\s+[█▉▊▋▓▒░—─-]{2,}.*$/, '').trim()
    if (!value) continue
    const percentMatch = value.match(/(\d+(?:\.\d+)?)%\s+used/i)
    breakdown.push({
      label,
      value,
      ...(percentMatch ? { usedPercent: Number(percentMatch[1]) } : {})
    })
  }

  const included = breakdown.find((item) => item.label.toLowerCase() === 'included')
  const includedPercent = included?.usedPercent
  if (includedPercent === undefined && breakdown.length === 0) return null

  return {
    planType,
    resetLabel,
    primary:
      includedPercent === undefined
        ? undefined
        : {
            label: 'Included usage',
            usedPercent: Math.min(100, Math.max(0, includedPercent)),
            windowDurationMins: 43200,
            resetsAt: null,
            resetLabel
          },
    breakdown
  }
}

function queryInteractiveUsage<T>(
  kind: Extract<CliUsageKind, 'cursor' | 'gemini' | 'antigravity'>,
  options: InteractiveUsageOptions<T>,
  profileEnv: Record<string, string> = {}
): Promise<T> {
  const config = resolveSpawnConfigCandidates(kind)[0]
  if (!config) {
    return Promise.reject(new Error(`${USAGE_LABELS[kind]} is not installed`))
  }

  return new Promise((resolve, reject) => {
    const terminal = pty.spawn(config.command, [...config.args, ...(options.extraArgs ?? [])], {
      name: 'xterm-256color',
      cols: 140,
      rows: 50,
      cwd: process.cwd(),
      env: { ...spawnEnv(), ...profileEnv },
      ...(process.platform === 'win32' ? { useConpty: false } : {})
    })

    let output = ''
    let settled = false
    let commandSent = false
    let commandScheduled = false
    let commandAttempt = 0
    let readyTimer: NodeJS.Timeout | null = null
    let entryTimer: NodeJS.Timeout | null = null
    let submitTimer: NodeJS.Timeout | null = null
    let retryTimer: NodeJS.Timeout | null = null
    let settleTimer: NodeJS.Timeout | null = null
    const timeout = setTimeout(() => {
      finishError(
        new InteractiveUsageError({
          status: 'error',
          detail: `${USAGE_LABELS[kind]} limit sorgusu zaman aşımına uğradı`
        })
      )
    }, options.timeoutMs ?? INTERACTIVE_USAGE_TIMEOUT_MS)

    const cleanup = (): void => {
      if (readyTimer) clearTimeout(readyTimer)
      if (entryTimer) clearTimeout(entryTimer)
      if (submitTimer) clearTimeout(submitTimer)
      if (retryTimer) clearTimeout(retryTimer)
      if (settleTimer) clearTimeout(settleTimer)
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

    const sendUsageCommand = (): void => {
      if (settled) return
      commandAttempt += 1
      commandSent = true
      terminal.write('\x15')
      entryTimer = setTimeout(() => {
        if (settled) return
        terminal.write(options.command)
        submitTimer = setTimeout(() => {
          if (!settled) terminal.write('\r')
        }, INTERACTIVE_USAGE_SUBMIT_DELAY_MS)
      }, INTERACTIVE_USAGE_COMMAND_ENTRY_DELAY_MS)

      if (commandAttempt === 1) {
        retryTimer = setTimeout(() => {
          if (settled) return
          const cleanOutput = stripTerminalControlCodes(output)
          if (options.detectFailure?.(cleanOutput) || options.parse(output)) return
          sendUsageCommand()
        }, INTERACTIVE_USAGE_RETRY_DELAY_MS)
      }
    }

    const scheduleUsageCommand = (): void => {
      if (settled || commandScheduled || commandSent) return
      commandScheduled = true
      readyTimer = setTimeout(sendUsageCommand, INTERACTIVE_USAGE_READY_DELAY_MS)
    }

    terminal.onData((chunk) => {
      output = (output + chunk).slice(-INTERACTIVE_USAGE_OUTPUT_LIMIT)
      const cleanOutput = stripTerminalControlCodes(output)

      const snapshot = options.parse(output)
      if (snapshot) {
        if (!settleTimer) {
          settleTimer = setTimeout(
            () => finish(() => resolve(snapshot)),
            INTERACTIVE_USAGE_SETTLE_DELAY_MS
          )
        }
        return
      }

      const failure = options.detectFailure?.(cleanOutput)
      if (failure && (!options.detectFailureAfterCommand || commandSent)) {
        finishError(new InteractiveUsageError(failure))
        return
      }

      if (!commandSent && options.isReady(cleanOutput)) scheduleUsageCommand()
    })

    terminal.onExit(({ exitCode }) => {
      if (settled) return
      const snapshot = options.parse(output)
      if (snapshot) {
        finish(() => resolve(snapshot))
        return
      }
      const failure = options.detectFailure?.(stripTerminalControlCodes(output))
      if (failure) {
        finishError(new InteractiveUsageError(failure))
        return
      }
      finishError(
        new Error(`${USAGE_LABELS[kind]} usage command exited with code ${exitCode ?? 'unknown'}`)
      )
    })
  })
}

function queryCursorUsage(profileEnv: Record<string, string> = {}): Promise<CursorUsageSnapshot> {
  return queryInteractiveUsage(
    'cursor',
    {
      command: '/usage',
      parse: parseCursorUsage,
      isReady: (output) => /Plan,\s*search,\s*build anything/i.test(output),
      // Each account has its own Cursor data directory. New profiles otherwise
      // stop at the interactive workspace trust prompt before /usage is sent.
      extraArgs: ['--trust'],
      detectFailure: (output) => {
        if (/not logged in|please (?:sign|log) in|authentication required/i.test(output)) {
          return { status: 'unavailable', detail: 'Cursor hesabı yeniden giriş gerektiriyor' }
        }
        return null
      }
    },
    profileEnv
  )
}

function parseGeminiUsage(output: string): GeminiUsageSnapshot | null {
  const cleanOutput = stripTerminalControlCodes(output)
  if (!/Stats For Nerds/i.test(cleanOutput)) return null

  const percentMatch = cleanOutput.match(
    /(\d+(?:\.\d+)?)%\s+used\s*(?:\(Limit resets in ([^)]+)\))?/i
  )
  const limitMatch = cleanOutput.match(/Usage limit:\s*([\d,.]+)/i)
  const tierMatch = cleanOutput.match(/Tier:\s*([^\n]+)/i)
  if (!percentMatch && !limitMatch) return null

  const usedPercent = percentMatch ? Math.min(100, Math.max(0, Number(percentMatch[1]))) : null
  const resetLabel = percentMatch?.[2]?.trim() ?? null
  const breakdown: CliUsageBreakdown[] = []
  if (limitMatch) breakdown.push({ label: 'Usage limit', value: limitMatch[1] })
  if (tierMatch) breakdown.push({ label: 'Tier', value: tierMatch[1].trim() })

  return {
    planType: tierMatch?.[1]?.trim() ?? null,
    primary:
      usedPercent === null
        ? undefined
        : {
            label: 'Daily pooled usage',
            usedPercent,
            windowDurationMins: 1440,
            resetsAt: null,
            resetLabel
          },
    breakdown
  }
}

function detectGeminiUsageFailure(output: string): InteractiveUsageFailure | null {
  if (/This client is no longer supported/i.test(output)) {
    return {
      status: 'unavailable',
      detail: 'Bu Gemini oturumu artık desteklenmiyor; hesabı yeniden bağlayın veya Antigravity’ye taşıyın'
    }
  }
  if (
    /Failed to sign in|How would you like to authenticate|Waiting for authentication|Opening authentication page|authentication required/i.test(
      output
    )
  ) {
    return { status: 'unavailable', detail: 'Gemini hesabı yeniden giriş gerektiriyor' }
  }
  if (/No API calls have been made in this session/i.test(output)) {
    return {
      status: 'unavailable',
      detail: 'Gemini bu oturumda henüz limit verisi döndürmedi'
    }
  }
  return null
}

function queryGeminiUsage(profileEnv: Record<string, string> = {}): Promise<GeminiUsageSnapshot> {
  return queryInteractiveUsage(
    'gemini',
    {
      command: '/usage model',
      parse: parseGeminiUsage,
      isReady: (output) =>
        /Type your message/i.test(output) || /(?:^|\n)>\s*(?:\n|$)/m.test(output),
      detectFailure: detectGeminiUsageFailure,
      extraArgs: ['--skip-trust']
    },
    profileEnv
  )
}

function parseAntigravityUsage(output: string): AntigravityUsageSnapshot | null {
  const cleanOutput = stripTerminalControlCodes(output)
  if (!/Models\s*&\s*Quota|Model Quota|Weekly Limit|Five Hour Limit/i.test(cleanOutput)) {
    return null
  }

  const lines = cleanOutput
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  const accountLine = lines.find((line) => /^Account:/i.test(line))
  const accountFromLabel = accountLine
    ?.replace(/^Account:\s*/i, '')
    .replace(/\s*\(.*\)\s*$/, '')
    .trim()
  const accountFromEmail = cleanOutput.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0]
  const accountEmail = accountFromLabel || accountFromEmail || null
  const planType =
    cleanOutput.match(/\(([^)\n]*(?:Quota|Plan|Pro|Ultra|Starter)[^)\n]*)\)/i)?.[1]?.trim() ??
    null

  const windows: CliUsageWindow[] = []
  const breakdown: CliUsageBreakdown[] = []
  let currentGroup: string | null = null

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    if (/MODELS/i.test(line) && !/limit|quota|remaining/i.test(line)) {
      currentGroup = line
        .replace(/\s+/g, ' ')
        .toLowerCase()
        .replace(/\b\w/g, (letter) => letter.toUpperCase())
      continue
    }

    const limitMatch = line.match(
      /^(Weekly Limit(?: Remaining)?|Five Hour Limit|5[- ]Hour Limit|Included usage)\s*$/i
    )
    if (!limitMatch) continue

    const nearby = [lines[index + 1], lines[index + 2], lines[index + 3]]
      .filter((value): value is string => Boolean(value))
      .join(' ')
    const remainingMatch =
      nearby.match(/([\d.]+)\s*%\s*remaining/i) ??
      nearby.match(/\]\s*([\d.]+)%/) ??
      nearby.match(/([\d.]+)%/)
    if (!remainingMatch && !/Quota available/i.test(nearby)) continue

    const remaining = remainingMatch
      ? Math.min(100, Math.max(0, Number(remainingMatch[1])))
      : 100
    const resetLabel =
      nearby.match(/Refreshes in [^·\n]+/i)?.[0]?.trim() ??
      ( /Quota available/i.test(nearby) ? 'Quota available' : null)
    const limitName = limitMatch[1]
    const label = currentGroup ? `${currentGroup} · ${limitName}` : limitName
    windows.push({
      label,
      usedPercent: 100 - remaining,
      windowDurationMins: /week/i.test(limitName) ? 10080 : 300,
      resetsAt: null,
      resetLabel
    })
    breakdown.push({
      label,
      value: `${remaining.toFixed(2)}% remaining`,
      usedPercent: 100 - remaining
    })
  }

  if (windows.length === 0) return null
  return {
    accountEmail,
    planType,
    primary: windows[0],
    secondary: windows[1],
    breakdown
  }
}

function looksLikeAntigravitySignedIn(output: string): boolean {
  return (
    /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(output) ||
    /Models\s*&\s*Quota|Model Quota/i.test(output) ||
    /\((?:Antigravity|Gemini).*(?:Quota|Plan|Pro|Ultra|Starter)/i.test(output)
  )
}

function looksLikeAntigravityLoginScreen(output: string): boolean {
  const tail = output.slice(-2500)
  if (looksLikeAntigravitySignedIn(output)) return false
  return /how would you like to authenticate|waiting for authentication|opening authentication page|sign in with google/i.test(
    tail
  )
}

function queryAntigravityUsage(
  profileEnv: Record<string, string> = {}
): Promise<AntigravityUsageSnapshot> {
  return queryInteractiveUsage(
    'antigravity',
    {
      command: '/usage',
      parse: parseAntigravityUsage,
      isReady: (output) =>
        /(?:^|\n)>\s*(?:\n|$)/m.test(output) && !looksLikeAntigravityLoginScreen(output),
      detectFailureAfterCommand: true,
      timeoutMs: 24000,
      detectFailure: (output) => {
        if (!looksLikeAntigravityLoginScreen(output)) return null
        return { status: 'unavailable', detail: 'Antigravity hesabı yeniden giriş gerektiriyor' }
      }
    },
    profileEnv
  )
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function baseUsageInfo(
  kind: CliUsageKind,
  status: CliUsageInfo['status'],
  detail: string
): CliUsageInfo {
  return {
    kind,
    label: USAGE_LABELS[kind],
    status,
    detail
  }
}

function withAccountScope(info: CliUsageInfo, accountId?: string): CliUsageInfo {
  return accountId ? { ...info, accountId } : info
}

async function readProviderUsage(
  kind: CliUsageKind,
  scope: UsageScope = {},
  antigravityLockHeld = false,
  cursorLockHeld = false
): Promise<CliUsageInfo> {
  if (kind === 'antigravity' && !antigravityLockHeld) {
    return withAntigravityUsageLock(() => readProviderUsage(kind, scope, true, cursorLockHeld))
  }
  if (kind === 'cursor' && !cursorLockHeld && cursorCredentialsSupported()) {
    return withCursorUsageLock(() => readProviderUsage(kind, scope, antigravityLockHeld, true))
  }

  const scoped = (info: CliUsageInfo): CliUsageInfo => withAccountScope(info, scope.accountId)

  let preparedIdentity: CliAccountIdentity = {}
  if (
    scope.accountId &&
    !(kind === 'antigravity' && antigravityLockHeld)
  ) {
    const prepared = await prepareAuthProfileLaunch(
      { kind, accountId: scope.accountId },
      'normal'
    )
    if (!prepared.ok) {
      return scoped({
        ...baseUsageInfo(
          kind,
          'error',
          prepared.error ?? 'Hesap profili hazırlanamadı'
        )
      })
    }
    if (!prepared.ready) {
      return scoped({
        ...baseUsageInfo(kind, 'unavailable', 'Hesap profili hazır değil')
      })
    }
    preparedIdentity = {
      ...(prepared.identity?.email ? { accountEmail: prepared.identity.email } : {}),
      ...(prepared.identity?.name ? { accountName: prepared.identity.name } : {})
    }
  }

  const profileEnv = scope.accountId ? getAuthProfileEnv(kind, scope.accountId) : {}
  const localIdentity = { ...readLocalAccountIdentity(kind, profileEnv), ...preparedIdentity }
  const detected = detectCli(kind)
  if (!detected.installed) {
    return scoped({ ...baseUsageInfo(kind, 'not-installed', 'CLI bulunamadı'), ...localIdentity })
  }

  if (kind !== 'codex') {
    if (kind === 'cursor' || kind === 'gemini' || kind === 'antigravity') {
      try {
        if (kind === 'cursor') {
          const snapshot = await queryCursorUsage(profileEnv)
          return scoped({
            ...baseUsageInfo(kind, 'available', 'Live usage pulled from /usage'),
            ...localIdentity,
            planType: snapshot.planType,
            primary: snapshot.primary,
            breakdown: snapshot.breakdown
          })
        }

        if (kind === 'gemini') {
          const snapshot = await queryGeminiUsage(profileEnv)
          return scoped({
            ...baseUsageInfo(kind, 'available', 'Canlı limit bilgisi alındı'),
            ...localIdentity,
            planType: snapshot.planType,
            primary: snapshot.primary,
            breakdown: snapshot.breakdown
          })
        }

        const snapshot = await queryAntigravityUsage(profileEnv)
        return scoped({
          ...baseUsageInfo(kind, 'available', 'Live usage pulled from /usage'),
          ...localIdentity,
          ...(snapshot.accountEmail ? { accountEmail: snapshot.accountEmail } : {}),
          ...(snapshot.planType ? { planType: snapshot.planType } : {}),
          primary: snapshot.primary,
          secondary: snapshot.secondary,
          breakdown: snapshot.breakdown
        })
      } catch (error) {
        return scoped({
          ...baseUsageInfo(
            kind,
            error instanceof InteractiveUsageError ? error.status : 'error',
            error instanceof Error ? error.message : 'CLI usage could not be read'
          ),
          ...localIdentity
        })
      }
    }
    return scoped({
      ...baseUsageInfo(
        kind,
        'unavailable',
        'Bu CLI aktif hesap limitlerini dışarıya sunmuyor'
      ),
      ...localIdentity
    })
  }

  try {
    const snapshot = await queryCodexRateLimits(profileEnv)
    return scoped({
      ...baseUsageInfo(kind, 'available', 'Canlı hesap limiti alındı'),
      ...localIdentity,
      planType: snapshot.planType,
      primary: snapshot.primary,
      secondary: snapshot.secondary,
      credits: snapshot.credits
    })
  } catch (error) {
    return scoped({
      ...baseUsageInfo(
        kind,
        'error',
        error instanceof Error ? error.message : 'Limit bilgisi alınamadı'
      ),
      ...localIdentity
    })
  }
}

async function readCursorAccountUsage(
  requests: UsageAccountRequest[]
): Promise<CliUsageInfo[]> {
  const providers: CliUsageInfo[] = []
  for (const request of requests) {
    providers.push(
      await readProviderUsage('cursor', { accountId: request.accountId }, false, true)
    )
  }
  return providers
}

async function readAntigravityAccountUsage(
  requests: UsageAccountRequest[]
): Promise<CliUsageInfo[]> {
  return withAntigravityUsageLock(async () => {
    let previousCredential: string | null
    try {
      previousCredential = await readAntigravityCredential()
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Antigravity credential could not be read'
      return requests.map((request) =>
        withAccountScope(baseUsageInfo('antigravity', 'error', detail), request.accountId)
      )
    }

    const providers: CliUsageInfo[] = []
    try {
      for (const request of requests) {
        const prepared = await prepareAuthProfileLaunch(request, 'normal')
        if (!prepared.ok) {
          providers.push(
            withAccountScope(
              baseUsageInfo(
                'antigravity',
                'error',
                prepared.error ?? 'Antigravity hesabı hazırlanamadı'
              ),
              request.accountId
            )
          )
          continue
        }
        if (!prepared.ready) {
          providers.push(
            withAccountScope(
              baseUsageInfo('antigravity', 'unavailable', 'Hesap profili hazır değil'),
              request.accountId
            )
          )
          continue
        }

        await delay(600)
        const identity: CliAccountIdentity = {
          ...(prepared.identity?.email ? { accountEmail: prepared.identity.email } : {}),
          ...(prepared.identity?.name ? { accountName: prepared.identity.name } : {})
        }

        try {
          const snapshot = await queryAntigravityUsage({})
          providers.push(
            withAccountScope(
              {
                ...baseUsageInfo('antigravity', 'available', 'Live usage pulled from /usage'),
                ...identity,
                ...(snapshot.accountEmail ? { accountEmail: snapshot.accountEmail } : {}),
                ...(snapshot.planType ? { planType: snapshot.planType } : {}),
                primary: snapshot.primary,
                secondary: snapshot.secondary,
                breakdown: snapshot.breakdown
              },
              request.accountId
            )
          )
        } catch (error) {
          providers.push(
            withAccountScope(
              {
                ...baseUsageInfo(
                  'antigravity',
                  error instanceof InteractiveUsageError ? error.status : 'error',
                  error instanceof Error ? error.message : 'CLI usage could not be read'
                ),
                ...identity
              },
              request.accountId
            )
          )
        }
      }
    } finally {
      try {
        const sessionAccountId = getAntigravitySessionAccount()
        if (sessionAccountId && hasStoredAntigravityCredentials(sessionAccountId)) {
          await applyAntigravityCredentialsForAccount(sessionAccountId)
        } else if (previousCredential) {
          const currentCredential = await readAntigravityCredential()
          if (currentCredential !== previousCredential) {
            await writeAntigravityCredential(previousCredential)
          }
        } else {
          const currentCredential = await readAntigravityCredential()
          if (currentCredential) await deleteAntigravityCredential()
        }
      } catch (error) {
        console.error('Could not restore Antigravity credential after usage check:', error)
      }
    }

    return providers
  })
}

async function readAccountUsage(requests: UsageAccountRequest[]): Promise<CliUsageInfo[]> {
  const antigravityRequests = requests.filter((request) => request.kind === 'antigravity')
  const cursorRequests = requests.filter((request) => request.kind === 'cursor')
  const otherRequests = requests.filter(
    (request) => request.kind !== 'antigravity' && request.kind !== 'cursor'
  )
  const requestsByKind = new Map<CliUsageKind, UsageAccountRequest[]>()
  for (const request of otherRequests) {
    const current = requestsByKind.get(request.kind) ?? []
    current.push(request)
    requestsByKind.set(request.kind, current)
  }

  const providersByRequest = new Map<string, CliUsageInfo>()
  await Promise.all(
    [...requestsByKind.values()].map(async (kindRequests) => {
      for (const request of kindRequests) {
        try {
          const provider = await readProviderUsage(request.kind, { accountId: request.accountId })
          providersByRequest.set(usageRequestKey(request), provider)
        } catch (error) {
          providersByRequest.set(
            usageRequestKey(request),
            withAccountScope(
              baseUsageInfo(
                request.kind,
                'error',
                error instanceof Error ? error.message : 'Account usage could not be read'
              ),
              request.accountId
            )
          )
        }
      }
    })
  )

  const otherProviders = otherRequests.map(
    (request) => providersByRequest.get(usageRequestKey(request)) as CliUsageInfo
  )
  const cursorProviders =
    cursorRequests.length > 0 ? await readCursorAccountUsage(cursorRequests) : []
  const antigravityProviders =
    antigravityRequests.length > 0
      ? await readAntigravityAccountUsage(antigravityRequests)
      : []
  return [...otherProviders, ...cursorProviders, ...antigravityProviders]
}

export async function readCliUsage(request?: CliUsageRequest): Promise<CliUsageResponse> {
  const providers = request?.accounts
    ? await readAccountUsage(
        [
          ...new Map(
            request.accounts.map((account) => [usageRequestKey(account), account])
          ).values()
        ]
      )
    : await Promise.all(USAGE_KINDS.map((kind) => readProviderUsage(kind)))
  return {
    checkedAt: Date.now(),
    providers
  }
}
