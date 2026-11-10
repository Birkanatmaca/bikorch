import { mkdirSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import type { CleanupAdvice, SystemMetrics } from '@shared/contracts/dashboard'
import { STORAGE_GROUP_COPY, type StorageItem, type StorageReport } from '@shared/contracts/storage'
import { resolveSpawnConfigCandidates } from '../cli/adapters'
import { runManagerCliProcess } from '../secretary/cli-manager-session'
import { latestStorageReport, scanStorage } from '../storage/scan'
import { recordLog } from '../logs'
import { claudeEnv } from './briefing'
import { readClaudeJson } from './briefing-content'
import { getSystemMetrics } from './system-metrics'

/**
 * Claude reads this computer's numbers and the storage scan and says, in the
 * user's language, whether a cleanup is worth it and which items to clean. It
 * runs with no tools: it sees only the summary below and cannot touch the disk.
 * Deleting stays the user's click, through the storage cleaner.
 */

const RUN_TIMEOUT_MS = 90_000
const MODEL = 'haiku'
const ADVICE_TTL_MS = 6 * 60 * 60 * 1000
/** The largest items Claude is shown; the rest is summed up. */
const PROMPT_ITEMS = 40
const GB = 1024 ** 3
const DAY = 86_400_000

let lastAdvice: CleanupAdvice | null = null
let flight: Promise<CleanupAdvice> | null = null

const ADVICE_SCHEMA = JSON.stringify({
  type: 'object',
  additionalProperties: false,
  properties: {
    headline: { type: 'string', description: 'One short sentence, at most 70 characters.' },
    message: { type: 'string', description: 'Two or three short sentences addressed to the user.' },
    recommend: { type: 'boolean' },
    picks: { type: 'array', items: { type: 'string' }, description: 'Item ids from the list.' }
  },
  required: ['headline', 'message', 'recommend', 'picks']
})

const size = (bytes: number): string => (bytes >= GB ? `${(bytes / GB).toFixed(1)} GB` : `${Math.round(bytes / 1024 ** 2)} MB`)

function outputLanguage(): string {
  const preferred = app.getPreferredSystemLanguages?.()[0] || app.getLocale() || 'en'
  return preferred.slice(0, 20)
}

function itemLine(item: StorageItem, now: number): string {
  const unused = item.lastUsedAt ? Math.floor((now - item.lastUsedAt) / DAY) : null
  return [
    `- id=${item.id}`,
    `[${STORAGE_GROUP_COPY[item.group].label}]`,
    item.project ? `${item.project}: ${item.label}` : item.label,
    size(item.bytes),
    `safety=${item.safety}`,
    unused !== null ? `untouched ${unused}d` : ''
  ].filter(Boolean).join(' ')
}

export function cleanupAdvicePrompt(metrics: SystemMetrics | null, report: StorageReport, language: string, now = Date.now()): string {
  const shown = report.items.slice(0, PROMPT_ITEMS)
  const restBytes = report.items.slice(PROMPT_ITEMS).reduce((sum, item) => sum + item.bytes, 0)
  const disk = report.disk
  return [
    'You are the system-care assistant inside Bikorch, a developer workstation app.',
    'Decide whether the user should clean up now so they can start coding on a clean, fast machine, and which items to clean.',
    '',
    'Computer:',
    disk ? `- Disk: ${size(disk.freeBytes)} free of ${size(disk.totalBytes)} (${Math.round((disk.freeBytes / disk.totalBytes) * 100)}% free)` : '- Disk: unknown',
    metrics ? `- Memory: ${size(metrics.memory.usedBytes)} used of ${size(metrics.memory.totalBytes)}` : '',
    report.swapUsedBytes !== null ? `- Swap in use: ${size(report.swapUsedBytes)}` : '',
    metrics ? `- CPU: ${metrics.cpuPercent}% busy, load ${metrics.load1.toFixed(1)} on ${metrics.cpus} cores; thermal ${metrics.thermal ?? 'unknown'}` : '',
    '',
    'Cleanable items (largest first). safety: safe = pure cache; rebuild = downloaded or built again; caution = may lose something.',
    shown.length > 0 ? shown.map((item) => itemLine(item, now)).join('\n') : '- nothing found',
    restBytes > 0 ? `- …and ${report.items.length - shown.length} smaller items, ${size(restBytes)} in total (not pickable)` : '',
    '',
    'Rules:',
    '- picks: ids from the list above, copied exactly. Pick every safe item worth more than ~100 MB.',
    '- Pick rebuild items when the disk is under 20% free or they belong to projects untouched for 30+ days.',
    '- Pick caution items only when the disk is under 5% free, and then name them in the message.',
    '- Never pick node_modules or build output of a project touched in the last 7 days.',
    '- recommend is true when cleaning clearly helps: the disk is low, or several GB can go.',
    '- message: say what you saw (free disk, the biggest items) and how much your picks free up, then, when recommend is true, ask for the go-ahead (for example "Shall I clean these for you?"). Use only the numbers given here.',
    '- If swap or memory is high, say in one short clause that cleaning files does not fix memory.',
    `- Write headline and message in this language: ${language}.`
  ].filter((line) => line !== '').join('\n')
}

/** What to say when Claude cannot be asked: safe caches, plus stale rebuildables when space is short. */
export function rulesAdvice(report: StorageReport, note: string | null, now = Date.now()): CleanupAdvice {
  const disk = report.disk
  const low = disk ? disk.freeBytes / Math.max(1, disk.totalBytes) < 0.15 || disk.freeBytes < 25 * GB : false
  const picks = report.items.filter((item) => {
    if (item.bytes < 100 * 1024 ** 2) return false
    if (item.safety === 'safe') return true
    if (item.safety !== 'rebuild') return false
    const stale = item.lastUsedAt !== null && now - item.lastUsedAt > 30 * DAY
    return low || (item.group === 'projects' && stale)
  })
  const picked = picks.reduce((sum, item) => sum + item.bytes, 0)
  const recommend = picked >= GB && (low || picked >= 5 * GB)
  const top = picks.slice(0, 3).map((item) => `${item.project ? `${item.project} ` : ''}${item.label} ${size(item.bytes)}`).join(', ')
  const free = disk ? `${size(disk.freeBytes)} free. ` : ''
  return {
    generatedAt: now,
    source: 'rules',
    headline: recommend ? (low ? 'Your disk is nearly full' : 'Caches are piling up') : 'Nothing urgent to clean',
    message: recommend
      ? `${free}${size(picked)} can be cleaned and rebuilt on demand (${top}). Shall I clean them?`
      : `${free}Only ${size(picked)} worth cleaning; no cleanup needed right now.`,
    recommend,
    picks: picks.map((item) => item.id),
    note
  }
}

export function parseAdvice(value: unknown, report: StorageReport, now = Date.now()): CleanupAdvice | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  if (typeof raw.headline !== 'string' || typeof raw.message !== 'string' || typeof raw.recommend !== 'boolean') return null
  // Only ids Claude was actually shown can be picked.
  const known = new Set(report.items.slice(0, PROMPT_ITEMS).map((item) => item.id))
  const picks = Array.isArray(raw.picks)
    ? [...new Set(raw.picks.filter((id): id is string => typeof id === 'string' && known.has(id)))]
    : []
  return {
    generatedAt: now,
    source: 'ai',
    headline: raw.headline.trim().slice(0, 120),
    message: raw.message.trim().slice(0, 700),
    recommend: raw.recommend,
    picks,
    note: null
  }
}

async function askClaude(report: StorageReport): Promise<CleanupAdvice> {
  const claude = resolveSpawnConfigCandidates('claude')[0]
  if (!claude) return rulesAdvice(report, 'Claude Code is not installed; this is a simple rule-based check.')
  const metrics = await getSystemMetrics().catch(() => null)
  const workspace = join(app.getPath('userData'), 'home-cleanup')
  mkdirSync(workspace, { recursive: true })
  try {
    const result = await runManagerCliProcess({
      command: claude.command,
      args: [
        ...claude.args,
        '-p',
        '--output-format', 'json',
        '--model', MODEL,
        '--no-session-persistence',
        '--strict-mcp-config',
        '--tools', '',
        '--json-schema', ADVICE_SCHEMA,
        cleanupAdvicePrompt(metrics, report, outputLanguage())
      ],
      cwd: workspace,
      env: { ...(await claudeEnv()), ...(claude.env ?? {}) },
      timeoutMs: RUN_TIMEOUT_MS
    })
    const { value, error } = readClaudeJson(result.stdout)
    const advice = error ? null : parseAdvice(value, report)
    if (advice) return advice
    recordLog('warn', `Home cleanup advice failed: ${error ?? 'unexpected answer'}`, 'dashboard')
    return rulesAdvice(report, 'Claude did not answer; this is a simple rule-based check.')
  } catch (cause) {
    recordLog('warn', `Home cleanup advice failed: ${cause instanceof Error ? cause.message : String(cause)}`, 'dashboard')
    return rulesAdvice(report, 'Claude could not be reached; this is a simple rule-based check.')
  }
}

/**
 * cached: the last advice, or null. auto: ask again when it is old or a newer
 * scan exists. force: ask now. Uses the latest storage scan, scanning if none.
 */
export async function getCleanupAdvice(mode: 'cached' | 'auto' | 'force'): Promise<CleanupAdvice | null> {
  if (mode === 'cached') return lastAdvice
  if (flight) return flight
  const report = latestStorageReport() ?? (await scanStorage())
  if (
    mode === 'auto' &&
    lastAdvice &&
    lastAdvice.generatedAt >= report.collectedAt &&
    Date.now() - lastAdvice.generatedAt < ADVICE_TTL_MS
  ) {
    return lastAdvice
  }
  flight = askClaude(report)
    .then((advice) => {
      lastAdvice = advice
      return advice
    })
    .finally(() => {
      flight = null
    })
  return flight
}
