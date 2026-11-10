/** Data behind the Home dashboard widgets. Everything is read locally. */

export interface DayTokens {
  /** Local date, YYYY-MM-DD. */
  date: string
  prompts: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

export interface ClaudeActivity {
  computedAt: number
  /** Oldest first, one entry per day that had activity. */
  days: DayTokens[]
  /** Output tokens per model over the whole range. */
  models: Array<{ model: string; outputTokens: number }>
  sessions: number
}

export interface GitActivity {
  computedAt: number
  /** Commits per local date (YYYY-MM-DD) over the last year, by you. */
  days: Record<string, number>
  projects: Array<{ name: string; commits: number }>
  total: number
}

export interface SystemProcess {
  pid: number
  name: string
  cpuPercent: number
  memoryBytes: number
}

export interface SystemMetrics {
  collectedAt: number
  cpuPercent: number
  cpus: number
  load1: number
  memory: { totalBytes: number; usedBytes: number }
  swapUsedBytes: number | null
  disk: { totalBytes: number; freeBytes: number } | null
  /** macOS thermal state: nominal, fair, serious or critical; null elsewhere. */
  thermal: 'nominal' | 'fair' | 'serious' | 'critical' | null
  battery: { percent: number; charging: boolean } | null
  topProcesses: SystemProcess[]
}

export const DASHBOARD_IPC = {
  SYSTEM: 'dashboard:system',
  CLAUDE_ACTIVITY: 'dashboard:claude-activity',
  GIT_ACTIVITY: 'dashboard:git-activity',
  BRIEFING: 'dashboard:briefing',
  CHAT_HISTORY: 'dashboard:chat-history',
  CHAT_SEND: 'dashboard:chat-send',
  CHAT_STOP: 'dashboard:chat-stop',
  CHAT_RESET: 'dashboard:chat-reset',
  CHAT_IMAGE: 'dashboard:chat-image',
  CHAT_EVENT: 'dashboard:chat-event',
  CLEANUP_ADVICE: 'dashboard:cleanup-advice'
} as const

/* Cleanup advice -------------------------------------------------------- */

/** Claude's read of this computer and the storage scan, shown on Home. */
export interface CleanupAdvice {
  generatedAt: number
  /** ai: Claude read the numbers. rules: Claude was not available. */
  source: 'ai' | 'rules'
  headline: string
  message: string
  /** A cleanup is worth doing now. */
  recommend: boolean
  /** Storage item ids from the latest scan worth cleaning. */
  picks: string[]
  /** Why Claude could not be asked, when source is rules. */
  note: string | null
}

/* Home chat --------------------------------------------------------------- */

/** An image attached to a question, kept on disk under the chat folder. */
export interface HomeChatImage {
  id: string
  name: string
  mediaType: HomeChatImageType
}

export const HOME_CHAT_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const
export type HomeChatImageType = (typeof HOME_CHAT_IMAGE_TYPES)[number]
export const HOME_CHAT_MAX_IMAGES = 4
/** Claude's per-image limit; Home scales larger pictures down before sending. */
export const HOME_CHAT_MAX_IMAGE_BYTES = 5 * 1024 * 1024

/** What the renderer sends: text plus base64 images. */
export interface HomeChatInput {
  text: string
  images: Array<{ name: string; mediaType: HomeChatImageType; data: string }>
}

export interface HomeChatMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  at: number
  images?: HomeChatImage[]
  /** The answer stopped early: cancelled or failed. */
  incomplete?: boolean
}

export interface HomeChatState {
  messages: HomeChatMessage[]
  /** Text of the answer being written right now, if any. */
  streaming: string | null
  /** What Claude is doing while it has not written yet ("Searching the web"). */
  activity: string | null
  error: string | null
}

export type HomeChatEvent =
  | { type: 'state'; state: HomeChatState }
  | { type: 'delta'; text: string }
  | { type: 'activity'; activity: string | null }

/** Longest question Home sends; longer pastes are cut. */
export const HOME_CHAT_MAX_INPUT = 20_000

/* AI briefings ------------------------------------------------------------ */

/** What Claude finds and writes for Home: fresh news, or practical know-how. */
export type BriefingKind = 'news' | 'tips'

/**
 * cached: only what is on disk, instantly. auto: regenerate when stale.
 * force: regenerate now.
 */
export type BriefingMode = 'cached' | 'auto' | 'force'

export const NEWS_LIMIT = 10

export interface NewsItem {
  title: string
  summary: string
  /** Claude's one-line take: why it matters to a developer, what to do. */
  analysis: string
  category: 'software' | 'security'
  region: 'tr' | 'global'
  source: string
  url: string
  /** YYYY-MM-DD when the source states it. */
  publishedAt: string | null
  /** Security items only: how urgent it is to act. */
  severity: 'critical' | 'high' | 'medium' | 'low' | null
}

export interface DevTip {
  title: string
  body: string
  category: string
  /** A short command or code line that shows the idea, when one helps. */
  snippet: string | null
  /** A page to read more, when Claude used one. */
  url: string | null
}

export type BriefingItem<K extends BriefingKind> = K extends 'news' ? NewsItem : DevTip

export interface Briefing<K extends BriefingKind = BriefingKind> {
  kind: K
  items: Array<BriefingItem<K>>
  generatedAt: number | null
  /** ready: items are current. stale: older than the refresh window. */
  status: 'ready' | 'stale' | 'empty' | 'no-claude' | 'error'
  error: string | null
}

/** How long a briefing stays current before Home asks Claude again. */
export const BRIEFING_TTL_MS: Record<BriefingKind, number> = {
  news: 3 * 60 * 60 * 1000,
  tips: 12 * 60 * 60 * 1000
}

export const HOME_WIDGETS = ['today', 'claude', 'sessions', 'system', 'servers', 'tokens', 'git', 'projects', 'tasks', 'tips', 'news', 'chat'] as const

export type HomeWidgetId = (typeof HOME_WIDGETS)[number]

export const HOME_WIDGET_COPY: Record<HomeWidgetId, { title: string; description: string }> = {
  today: { title: 'Today', description: 'Prompts, tokens, commits and your streak at a glance.' },
  claude: { title: 'Claude limits', description: 'Accounts, plan and how much of each limit is used.' },
  sessions: { title: 'Live sessions', description: 'Every open Claude and terminal session across projects.' },
  system: { title: 'System care', description: 'CPU, memory and disk at a glance; Claude checks what to clean and cleans it when you agree.' },
  servers: { title: 'Servers', description: 'Health of the servers you saved.' },
  tokens: { title: 'Prompts & tokens', description: 'Daily Claude prompts and tokens from your sessions.' },
  git: { title: 'Commit map', description: 'Your commits across projects over the last year.' },
  projects: { title: 'Projects', description: 'Open a project or start a new one.' },
  tasks: { title: 'Tasks', description: 'Open tasks across every project; tick them off here.' },
  tips: { title: 'Dev notes', description: 'Practical know-how Claude picks for your stack.' },
  news: { title: 'News', description: 'Software and security news Claude finds and explains.' },
  chat: { title: 'Ask Claude', description: 'Ask Claude anything, on any topic; attach images, follow up, start over.' }
}

/** The Home canvas is a fixed grid that always fits one screen. */
export const HOME_GRID = { columns: 12, rows: 12 } as const

/** A widget's cell rectangle on the Home grid. */
export interface HomeWidgetRect {
  id: HomeWidgetId
  x: number
  y: number
  w: number
  h: number
}

export const HOME_MIN_SIZE = { w: 2, h: 2 } as const

export const DEFAULT_HOME_LAYOUT: HomeWidgetRect[] = [
  { id: 'today', x: 0, y: 0, w: 12, h: 2 },
  { id: 'chat', x: 0, y: 2, w: 4, h: 10 },
  { id: 'system', x: 4, y: 2, w: 5, h: 6 },
  { id: 'news', x: 4, y: 8, w: 5, h: 4 },
  { id: 'tasks', x: 9, y: 2, w: 3, h: 4 },
  { id: 'tips', x: 9, y: 6, w: 3, h: 3 },
  { id: 'claude', x: 9, y: 9, w: 3, h: 3 }
]

/** Keeps a rectangle whole and inside the grid. */
export function clampHomeRect(rect: HomeWidgetRect): HomeWidgetRect {
  const w = Math.max(HOME_MIN_SIZE.w, Math.min(HOME_GRID.columns, Math.round(rect.w)))
  const h = Math.max(HOME_MIN_SIZE.h, Math.min(HOME_GRID.rows, Math.round(rect.h)))
  return {
    id: rect.id,
    w,
    h,
    x: Math.max(0, Math.min(HOME_GRID.columns - w, Math.round(rect.x))),
    y: Math.max(0, Math.min(HOME_GRID.rows - h, Math.round(rect.y)))
  }
}

export function parseHomeLayout(value: unknown): HomeWidgetRect[] {
  if (!Array.isArray(value)) return DEFAULT_HOME_LAYOUT
  const seen = new Set<string>()
  const layout: HomeWidgetRect[] = []
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue
    const { id, x, y, w, h } = entry as Record<string, unknown>
    if (typeof id !== 'string' || !(HOME_WIDGETS as readonly string[]).includes(id) || seen.has(id)) continue
    if (![x, y, w, h].every((value) => typeof value === 'number' && Number.isFinite(value))) continue
    seen.add(id)
    layout.push(clampHomeRect({ id: id as HomeWidgetId, x: x as number, y: y as number, w: w as number, h: h as number }))
  }
  return layout
}

const SYSTEM_CARE_SIZES = [{ w: 5, h: 6 }, { w: 4, h: 5 }, { w: 3, h: 4 }]

/** An earlier arrangement with System care added where it fits, or null when it does not fit. */
export function withSystemCare(layout: HomeWidgetRect[]): HomeWidgetRect[] | null {
  if (layout.some((rect) => rect.id === 'system')) return layout
  for (const size of SYSTEM_CARE_SIZES) {
    for (let y = 0; y + size.h <= HOME_GRID.rows; y += 1) {
      for (let x = 0; x + size.w <= HOME_GRID.columns; x += 1) {
        const overlaps = layout.some((rect) => x < rect.x + rect.w && x + size.w > rect.x && y < rect.y + rect.h && y + size.h > rect.y)
        if (!overlaps) return [...layout, { id: 'system', x, y, ...size }]
      }
    }
  }
  return null
}

/** First free spot for a widget of this size, scanning rows top to bottom. */
export function findHomeSpot(layout: HomeWidgetRect[], w: number, h: number): { x: number; y: number } {
  const taken = (x: number, y: number): boolean =>
    layout.some((rect) => x < rect.x + rect.w && x + w > rect.x && y < rect.y + rect.h && y + h > rect.y)
  for (let y = 0; y + h <= HOME_GRID.rows; y += 1) {
    for (let x = 0; x + w <= HOME_GRID.columns; x += 1) {
      if (!taken(x, y)) return { x, y }
    }
  }
  return { x: 0, y: 0 }
}
