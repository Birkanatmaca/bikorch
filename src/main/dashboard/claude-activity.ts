import { app } from 'electron'
import { createReadStream } from 'fs'
import { readdir, readFile, stat, writeFile } from 'fs/promises'
import { homedir } from 'os'
import { join } from 'path'
import { createInterface } from 'readline'
import type { ClaudeActivity, DayTokens } from '@shared/contracts/dashboard'

/**
 * Prompts and tokens come from Claude Code's own session transcripts
 * (~/.claude/projects and Bikorch's Claude profiles). Each file is read once and
 * cached by size and modification time, so later refreshes only read new work.
 */

type DayTotals = Omit<DayTokens, 'date'>

interface FileSummary {
  size: number
  mtimeMs: number
  days: Record<string, DayTotals>
  models: Record<string, number>
}

interface Cache {
  version: 1
  files: Record<string, FileSummary>
}

const CACHE_FILE = 'dashboard-claude-activity.json'
const RANGE_DAYS = 371
const EMPTY = (): DayTotals => ({ prompts: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 })

let cache: Cache | null = null
let running: Promise<ClaudeActivity> | null = null

export function localDate(timestamp: string | number): string | null {
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return null
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

/** Wrappers Claude Code writes as "user" lines that the person did not type. */
function isTypedPrompt(content: unknown): boolean {
  if (typeof content === 'string') {
    const text = content.trimStart()
    return text.length > 0 && !/^<(?:command-|local-command|system-reminder|bash-|task-notification)/.test(text)
  }
  if (!Array.isArray(content)) return false
  return content.some((part) => part && typeof part === 'object' && (part as { type?: string }).type === 'text') &&
    !content.some((part) => part && typeof part === 'object' && (part as { type?: string }).type === 'tool_result')
}

/** Summarizes one transcript. Streamed responses repeat a message id; the last usage wins. */
export async function summarizeTranscript(path: string): Promise<Omit<FileSummary, 'size' | 'mtimeMs'>> {
  const days: Record<string, DayTotals> = {}
  const models: Record<string, number> = {}
  const usageById = new Map<string, { date: string; model: string; usage: Record<string, unknown> }>()
  const lines = createInterface({ input: createReadStream(path, { encoding: 'utf8' }), crlfDelay: Infinity })
  for await (const line of lines) {
    // Skip the large request/attachment lines without parsing them.
    const assistant = line.includes('"type":"assistant"')
    if (!assistant && !line.includes('"type":"user"')) continue
    let entry: Record<string, unknown>
    try {
      entry = JSON.parse(line) as Record<string, unknown>
    } catch {
      continue
    }
    const date = typeof entry.timestamp === 'string' ? localDate(entry.timestamp) : null
    const message = entry.message as Record<string, unknown> | undefined
    if (!date || !message) continue
    if (entry.type === 'user') {
      if (entry.isMeta || entry.isSidechain || !isTypedPrompt(message.content)) continue
      days[date] ??= EMPTY()
      days[date].prompts += 1
    } else if (entry.type === 'assistant' && message.usage && typeof message.usage === 'object') {
      const id = typeof message.id === 'string' ? message.id : `${date}:${usageById.size}`
      usageById.set(id, { date, model: String(message.model ?? 'unknown'), usage: message.usage as Record<string, unknown> })
    }
  }
  const count = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0)
  for (const { date, model, usage } of usageById.values()) {
    const day = (days[date] ??= EMPTY())
    day.inputTokens += count(usage.input_tokens)
    day.outputTokens += count(usage.output_tokens)
    day.cacheReadTokens += count(usage.cache_read_input_tokens)
    day.cacheWriteTokens += count(usage.cache_creation_input_tokens)
    if (model !== '<synthetic>') models[model] = (models[model] ?? 0) + count(usage.output_tokens)
  }
  return { days, models }
}

async function transcriptFiles(root: string): Promise<string[]> {
  const files: string[] = []
  const pending = [root]
  while (pending.length) {
    const directory = pending.pop()!
    for (const entry of await readdir(directory, { withFileTypes: true }).catch(() => [])) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) pending.push(path)
      else if (entry.isFile() && entry.name.endsWith('.jsonl')) files.push(path)
    }
  }
  return files
}

async function roots(): Promise<string[]> {
  const list = [join(homedir(), '.claude', 'projects')]
  const profiles = join(app.getPath('userData'), 'cli-profiles', 'claude')
  for (const entry of await readdir(profiles, { withFileTypes: true }).catch(() => [])) {
    if (entry.isDirectory()) list.push(join(profiles, entry.name, 'projects'))
  }
  return list
}

async function loadCache(): Promise<Cache> {
  if (cache) return cache
  try {
    const parsed = JSON.parse(await readFile(join(app.getPath('userData'), CACHE_FILE), 'utf8')) as Cache
    cache = parsed?.version === 1 && parsed.files ? parsed : { version: 1, files: {} }
  } catch {
    cache = { version: 1, files: {} }
  }
  return cache
}

async function compute(): Promise<ClaudeActivity> {
  const current = await loadCache()
  const files = (await Promise.all((await roots()).map(transcriptFiles))).flat()
  const next: Record<string, FileSummary> = {}
  let changed = false
  for (const path of files) {
    let info
    try {
      info = await stat(path)
    } catch {
      continue
    }
    const known = current.files[path]
    if (known && known.size === info.size && known.mtimeMs === info.mtimeMs) {
      next[path] = known
      continue
    }
    try {
      next[path] = { size: info.size, mtimeMs: info.mtimeMs, ...(await summarizeTranscript(path)) }
      changed = true
    } catch {
      // A transcript being written right now is read on the next refresh.
    }
  }
  if (changed || Object.keys(next).length !== Object.keys(current.files).length) {
    cache = { version: 1, files: next }
    await writeFile(join(app.getPath('userData'), CACHE_FILE), JSON.stringify(cache)).catch(() => undefined)
  }

  const since = localDate(Date.now() - RANGE_DAYS * 86_400_000) ?? ''
  const totals: Record<string, DayTotals> = {}
  const models: Record<string, number> = {}
  let sessions = 0
  for (const summary of Object.values(next)) {
    let active = false
    for (const [date, day] of Object.entries(summary.days)) {
      if (date < since) continue
      active = true
      const total = (totals[date] ??= EMPTY())
      total.prompts += day.prompts
      total.inputTokens += day.inputTokens
      total.outputTokens += day.outputTokens
      total.cacheReadTokens += day.cacheReadTokens
      total.cacheWriteTokens += day.cacheWriteTokens
    }
    if (active) sessions += 1
    for (const [model, tokens] of Object.entries(summary.models)) models[model] = (models[model] ?? 0) + tokens
  }
  return {
    computedAt: Date.now(),
    days: Object.entries(totals).sort(([a], [b]) => a.localeCompare(b)).map(([date, day]) => ({ date, ...day })),
    models: Object.entries(models).map(([model, outputTokens]) => ({ model, outputTokens })).sort((a, b) => b.outputTokens - a.outputTokens),
    sessions
  }
}

export function getClaudeActivity(): Promise<ClaudeActivity> {
  running ??= compute().finally(() => {
    running = null
  })
  return running
}
