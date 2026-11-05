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
  GIT_ACTIVITY: 'dashboard:git-activity'
} as const

export const HOME_WIDGETS = ['today', 'claude', 'sessions', 'system', 'servers', 'tokens', 'git', 'projects'] as const

export type HomeWidgetId = (typeof HOME_WIDGETS)[number]

export const HOME_WIDGET_COPY: Record<HomeWidgetId, { title: string; description: string }> = {
  today: { title: 'Today', description: 'Prompts, tokens, commits and your streak at a glance.' },
  claude: { title: 'Claude limits', description: 'Accounts, plan and how much of each limit is used.' },
  sessions: { title: 'Live sessions', description: 'Every open Claude and terminal session across projects.' },
  system: { title: 'This Mac', description: 'CPU, memory, heat and the processes using the most.' },
  servers: { title: 'Servers', description: 'Health of the servers you saved.' },
  tokens: { title: 'Prompts & tokens', description: 'Daily Claude prompts and tokens from your sessions.' },
  git: { title: 'Commit map', description: 'Your commits across projects over the last year.' },
  projects: { title: 'Projects', description: 'Open a project or start a new one.' }
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
  { id: 'claude', x: 0, y: 2, w: 3, h: 5 },
  { id: 'sessions', x: 3, y: 2, w: 6, h: 3 },
  { id: 'system', x: 9, y: 2, w: 3, h: 6 },
  { id: 'tokens', x: 3, y: 5, w: 6, h: 4 },
  { id: 'servers', x: 0, y: 7, w: 3, h: 5 },
  { id: 'git', x: 3, y: 9, w: 6, h: 3 },
  { id: 'projects', x: 9, y: 8, w: 3, h: 4 }
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
