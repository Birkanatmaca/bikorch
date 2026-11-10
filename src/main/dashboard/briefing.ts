import { mkdirSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import {
  BRIEFING_TTL_MS,
  type Briefing,
  type BriefingKind,
  type BriefingMode,
  type DevTip,
  type NewsItem
} from '@shared/contracts/dashboard'
import { readMetaValue, writeMetaValue } from '../persistence/database'
import { resolveSpawnConfigCandidates, spawnEnv } from '../cli/adapters'
import { getAuthProfileEnv, listAuthProfiles, prepareAuthProfileLaunch } from '../accounts/profile-manager'
import { getDeveloperIntelligenceSettings, listMemories } from '../developer-intelligence/service'
import { memoriesForDailyLearn, localDateKey } from '../secretary/daily-learn'
import { runManagerCliProcess } from '../secretary/cli-manager-session'
import { recordLog } from '../logs'
import {
  briefingFromStore,
  briefingSchema,
  newsPrompt,
  parseBriefingItems,
  parseStoredBriefing,
  readClaudeJson,
  tipsPrompt,
  type StoredBriefing
} from './briefing-content'

/**
 * Home's AI briefings. Claude Code runs headless with only WebSearch and
 * WebFetch, answers against a JSON schema, and the result is kept in the meta
 * table so Home shows it instantly and asks again only when it goes stale.
 */

const RUN_TIMEOUT_MS = 4 * 60 * 1000
const MODEL = 'sonnet'
const metaKey = (kind: BriefingKind): string => `home_briefing_${kind}`
const inFlight = new Map<BriefingKind, Promise<Briefing>>()

function outputLanguage(): string {
  const preferred = app.getPreferredSystemLanguages?.()[0] || app.getLocale() || 'en'
  return preferred.slice(0, 20)
}

/** A signed-in Bikorch Claude account, else the Claude login on this Mac. */
export async function claudeEnv(): Promise<Record<string, string>> {
  const base = spawnEnv() as Record<string, string>
  try {
    const profile = (await listAuthProfiles()).find((entry) => entry.kind === 'claude' && entry.ready)
    if (!profile) return base
    const launch = await prepareAuthProfileLaunch({ kind: 'claude', accountId: profile.accountId }, 'normal')
    if (!launch.ok || !launch.ready) return base
    return { ...base, ...getAuthProfileEnv('claude', profile.accountId) }
  } catch {
    return base
  }
}

function stackFacts(): string[] {
  try {
    if (!getDeveloperIntelligenceSettings().includeMemoryInPrompts) return []
    return memoriesForDailyLearn(listMemories()).map((memory) => `${memory.category}: ${memory.content}`).slice(0, 10)
  } catch {
    return []
  }
}

function readStored(kind: BriefingKind): StoredBriefing | null {
  return parseStoredBriefing(readMetaValue(metaKey(kind)))
}

function historyKeys(kind: BriefingKind, items: Array<NewsItem | DevTip>): string[] {
  return kind === 'news' ? (items as NewsItem[]).map((item) => item.url) : (items as DevTip[]).map((item) => item.title)
}

async function generate(kind: BriefingKind): Promise<Briefing> {
  const stored = readStored(kind)
  const previous = briefingFromStore(kind, stored, Date.now(), BRIEFING_TTL_MS[kind])
  const fail = (status: Briefing['status'], error: string): Briefing => ({
    ...previous,
    status: previous.items.length > 0 && status === 'error' ? 'stale' : status,
    error
  })

  const claude = resolveSpawnConfigCandidates('claude')[0]
  if (!claude) return fail('no-claude', 'Claude Code is not installed.')

  const today = localDateKey()
  const language = outputLanguage()
  const prompt = kind === 'news'
    ? newsPrompt({ today, language, avoidUrls: stored?.history ?? [] })
    : tipsPrompt({ today, language, stack: stackFacts(), avoidTitles: stored?.history ?? [] })

  const workspace = join(app.getPath('userData'), 'home-briefing')
  mkdirSync(workspace, { recursive: true })
  const args = [
    ...claude.args,
    '-p',
    '--output-format', 'json',
    '--model', MODEL,
    '--no-session-persistence',
    '--strict-mcp-config',
    '--tools', 'WebSearch', 'WebFetch',
    '--allowedTools', 'WebSearch', 'WebFetch',
    '--json-schema', briefingSchema(kind),
    prompt
  ]

  try {
    const result = await runManagerCliProcess({
      command: claude.command,
      args,
      cwd: workspace,
      env: { ...(await claudeEnv()), ...(claude.env ?? {}) },
      timeoutMs: RUN_TIMEOUT_MS
    })
    const { value, error } = readClaudeJson(result.stdout)
    if (error) {
      const detail = `${result.stderr}\n${error}`
      const signIn = /not logged|login|unauthorized|authentication|invalid api key/i.test(detail)
      recordLog('warn', `Home ${kind} briefing failed: ${error}`, 'dashboard')
      return fail('error', signIn ? 'Sign in to Claude Code to load this.' : error)
    }
    const items = parseBriefingItems(kind, value)
    if (items.length === 0) return fail('error', 'Claude found nothing this time. Try again later.')
    const generatedAt = Date.now()
    const history = [...historyKeys(kind, items), ...(stored?.history ?? [])].slice(0, 60)
    writeMetaValue(metaKey(kind), JSON.stringify({ items, generatedAt, history } satisfies StoredBriefing))
    return { kind, items, generatedAt, status: 'ready', error: null }
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    recordLog('warn', `Home ${kind} briefing failed: ${message}`, 'dashboard')
    return fail('error', /did not answer in time/.test(message) ? 'Claude took too long. Try again.' : 'Could not run Claude Code.')
  }
}

export function getBriefing(kind: BriefingKind, mode: BriefingMode): Promise<Briefing> {
  const cached = briefingFromStore(kind, readStored(kind), Date.now(), BRIEFING_TTL_MS[kind])
  const running = inFlight.get(kind)
  if (mode === 'cached') return Promise.resolve(cached)
  if (running) return running
  if (mode === 'auto' && cached.status === 'ready') return Promise.resolve(cached)
  const run = generate(kind).finally(() => inFlight.delete(kind))
  inFlight.set(kind, run)
  return run
}

export function isBriefingRunning(kind: BriefingKind): boolean {
  return inFlight.has(kind)
}
