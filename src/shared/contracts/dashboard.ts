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

export const HOME_WIDGETS = ['claude', 'sessions', 'system', 'servers', 'tokens', 'git', 'projects'] as const

export type HomeWidgetId = (typeof HOME_WIDGETS)[number]

export const HOME_WIDGET_COPY: Record<HomeWidgetId, { title: string; description: string }> = {
  claude: { title: 'Claude limits', description: 'Accounts, plan and how much of each limit is used.' },
  sessions: { title: 'Live sessions', description: 'Every open Claude and terminal session across projects.' },
  system: { title: 'This Mac', description: 'CPU, memory, heat and the processes using the most.' },
  servers: { title: 'Servers', description: 'Health of the servers you saved.' },
  tokens: { title: 'Prompts & tokens', description: 'Daily Claude prompts and tokens from your sessions.' },
  git: { title: 'Commit map', description: 'Your commits across projects over the last year.' },
  projects: { title: 'Projects', description: 'Open a project or start a new one.' }
}

export interface HomeWidgetLayout {
  id: HomeWidgetId
  /** Grid columns the widget spans, 1 to 3. */
  span: 1 | 2 | 3
}

export const DEFAULT_HOME_LAYOUT: HomeWidgetLayout[] = [
  { id: 'claude', span: 1 },
  { id: 'sessions', span: 2 },
  { id: 'tokens', span: 2 },
  { id: 'system', span: 1 },
  { id: 'git', span: 2 },
  { id: 'servers', span: 1 },
  { id: 'projects', span: 3 }
]

export function parseHomeLayout(value: unknown): HomeWidgetLayout[] {
  if (!Array.isArray(value)) return DEFAULT_HOME_LAYOUT
  const seen = new Set<string>()
  const layout: HomeWidgetLayout[] = []
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue
    const { id, span } = entry as Record<string, unknown>
    if (typeof id !== 'string' || !(HOME_WIDGETS as readonly string[]).includes(id) || seen.has(id)) continue
    seen.add(id)
    layout.push({ id: id as HomeWidgetId, span: span === 1 || span === 2 || span === 3 ? span : 1 })
  }
  return layout
}
