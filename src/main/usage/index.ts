import { spawn } from 'child_process'
import { existsSync, readFileSync } from 'fs'
import * as pty from '@homebridge/node-pty-prebuilt-multiarch'
import { homedir } from 'os'
import { join } from 'path'
import type {
  CliUsageBreakdown,
  CliUsageInfo,
  CliUsageKind,
  CliUsageResponse,
  CliUsageWindow
} from '@shared/contracts/usage'
import { detectCli, resolveSpawnConfigCandidates, spawnEnv } from '../cli/adapters'

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

function readLocalAccountIdentity(kind: CliUsageKind): CliAccountIdentity {
  const root = homedir()

  if (kind === 'cursor') {
    const config = readJsonFile(join(root, '.cursor', 'cli-config.json'))
    const authInfo = asRecord(config?.authInfo)
    const accountEmail = asString(authInfo?.email)
    const accountName = asString(authInfo?.displayName)
    return {
      ...(accountEmail ? { accountEmail } : {}),
      ...(accountName ? { accountName } : {})
    }
  }

  if (kind === 'gemini') {
    const accounts = readJsonFile(join(root, '.gemini', 'google_accounts.json'))
    const accountEmail = asString(accounts?.active)
    return accountEmail ? { accountEmail } : {}
  }

  if (kind === 'codex') {
    const auth = readJsonFile(join(root, '.codex', 'auth.json'))
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
    const credentials = readJsonFile(join(root, '.claude', '.credentials.json'))
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

function queryCodexRateLimits(): Promise<CodexUsageSnapshot> {
  const config = resolveSpawnConfigCandidates('codex')[0]
  if (!config) {
    return Promise.reject(new Error('Codex CLI is not installed'))
  }

  return new Promise((resolve, reject) => {
    const process = spawn(config.command, [...config.args, 'app-server'], {
      cwd: undefined,
      env: spawnEnv(),
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
          name: 'bikorch_limits',
          title: 'BIKORCH Limits',
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
  primary: CliUsageWindow | undefined
  secondary: CliUsageWindow | undefined
  breakdown: CliUsageBreakdown[]
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
  kind: Extract<CliUsageKind, 'cursor' | 'antigravity'>,
  parse: (output: string) => T | null
): Promise<T> {
  const config = resolveSpawnConfigCandidates(kind)[0]
  if (!config) {
    return Promise.reject(new Error(`${USAGE_LABELS[kind]} is not installed`))
  }

  return new Promise((resolve, reject) => {
    const terminal = pty.spawn(config.command, config.args, {
      name: 'xterm-256color',
      cols: 140,
      rows: 50,
      cwd: process.cwd(),
      env: spawnEnv(),
      ...(process.platform === 'win32' ? { useConpty: false } : {})
    })

    let output = ''
    let settled = false
    let submitTimer: NodeJS.Timeout | null = null
    const usageTimer = setTimeout(() => {
      terminal.write('/usage')
      submitTimer = setTimeout(() => terminal.write('\r'), 700)
    }, 5000)
    const timeout = setTimeout(() => {
      finishError(new Error(`${USAGE_LABELS[kind]} usage request timed out`))
    }, 16000)

    const cleanup = (): void => {
      clearTimeout(usageTimer)
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

    terminal.onData((chunk) => {
      output += chunk

      const snapshot = parse(output)
      if (snapshot) {
        setTimeout(() => finish(() => resolve(snapshot)), 350)
      }
    })

    terminal.onExit(({ exitCode }) => {
      if (settled) return
      const snapshot = parse(output)
      if (snapshot) {
        finish(() => resolve(snapshot))
        return
      }
      finishError(
        new Error(`${USAGE_LABELS[kind]} usage command exited with code ${exitCode ?? 'unknown'}`)
      )
    })
  })
}

function queryCursorUsage(): Promise<CursorUsageSnapshot> {
  return queryInteractiveUsage('cursor', parseCursorUsage)
}

function parseAntigravityUsage(output: string): AntigravityUsageSnapshot | null {
  const lines = stripTerminalControlCodes(output)
    .split('\n')
    .map((line) => line.trim())
  const usageIndex = lines.findIndex((line) => /Models\s*&\s*Quota/i.test(line))
  if (usageIndex < 0) return null

  const accountLine = lines
    .slice(usageIndex + 1, usageIndex + 5)
    .find((line) => /^Account:/i.test(line))
  const accountEmail = accountLine?.replace(/^Account:\s*/i, '').trim() || null

  const windows: CliUsageWindow[] = []
  const breakdown: CliUsageBreakdown[] = []
  let currentGroup: string | null = null

  for (let index = usageIndex + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    if (/^[A-Z][A-Z ]+$/.test(line) && /MODELS/.test(line)) {
      currentGroup = line.toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase())
      continue
    }
    if (!/Weekly Limit Remaining/i.test(line)) continue

    const percentLine = lines[index + 1] ?? ''
    const percentMatch = percentLine.match(/([\d.]+)%/)
    if (!percentMatch) continue

    const remaining = Math.min(100, Math.max(0, Number(percentMatch[1])))
    const nextLine = lines[index + 2] ?? ''
    const resetMatch = nextLine.match(/^(Refreshes in .+|Quota available)$/i)
    const label = currentGroup ?? `Limit ${windows.length + 1}`
    const window: CliUsageWindow = {
      label,
      usedPercent: 100 - remaining,
      windowDurationMins: 10080,
      resetsAt: null,
      resetLabel: resetMatch?.[1] ?? null
    }
    windows.push(window)
    breakdown.push({ label, value: `${remaining.toFixed(2)}% remaining`, usedPercent: 100 - remaining })
  }

  if (windows.length === 0) return null
  return {
    accountEmail,
    primary: windows[0],
    secondary: windows[1],
    breakdown
  }
}

function queryAntigravityUsage(): Promise<AntigravityUsageSnapshot> {
  return queryInteractiveUsage('antigravity', parseAntigravityUsage)
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

async function readProviderUsage(kind: CliUsageKind): Promise<CliUsageInfo> {
  const localIdentity = readLocalAccountIdentity(kind)
  const detected = detectCli(kind)
  if (!detected.installed) {
    return { ...baseUsageInfo(kind, 'not-installed', 'CLI bulunamadı'), ...localIdentity }
  }

  if (kind !== 'codex') {
    if (kind === 'cursor' || kind === 'antigravity') {
      try {
        if (kind === 'cursor') {
          const snapshot = await queryCursorUsage()
          return {
            ...baseUsageInfo(kind, 'available', 'Live usage pulled from /usage'),
            ...localIdentity,
            planType: snapshot.planType,
            primary: snapshot.primary,
            breakdown: snapshot.breakdown
          }
        }

        const snapshot = await queryAntigravityUsage()
        return {
          ...baseUsageInfo(kind, 'available', 'Live usage pulled from /usage'),
          ...localIdentity,
          ...(snapshot.accountEmail ? { accountEmail: snapshot.accountEmail } : {}),
          primary: snapshot.primary,
          secondary: snapshot.secondary,
          breakdown: snapshot.breakdown
        }
      } catch (error) {
        return {
          ...baseUsageInfo(
            kind,
            'error',
            error instanceof Error ? error.message : 'CLI usage could not be read'
          ),
          ...localIdentity
        }
      }
    }
    return {
      ...baseUsageInfo(
        kind,
        'unavailable',
        'Bu CLI aktif hesap limitlerini dışarıya sunmuyor'
      ),
      ...localIdentity
    }
  }

  try {
    const snapshot = await queryCodexRateLimits()
    return {
      ...baseUsageInfo(kind, 'available', 'Canlı hesap limiti alındı'),
      ...localIdentity,
      planType: snapshot.planType,
      primary: snapshot.primary,
      secondary: snapshot.secondary,
      credits: snapshot.credits
    }
  } catch (error) {
    return {
      ...baseUsageInfo(
        kind,
        'error',
        error instanceof Error ? error.message : 'Limit bilgisi alınamadı'
      ),
      ...localIdentity
    }
  }
}

export async function readCliUsage(): Promise<CliUsageResponse> {
  const providers = await Promise.all(USAGE_KINDS.map((kind) => readProviderUsage(kind)))
  return {
    checkedAt: Date.now(),
    providers
  }
}
