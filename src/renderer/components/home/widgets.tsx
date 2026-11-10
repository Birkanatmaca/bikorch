import { useEffect, useMemo, useState } from 'react'
import {
  ArrowUpRight,
  BatteryCharging,
  BatteryMedium,
  Flame,
  Folder,
  FolderOpen,
  FolderPlus,
  GitCommitHorizontal,
  RefreshCw,
  Server,
  Thermometer
} from 'lucide-react'
import type { ClaudeActivity, GitActivity, SystemMetrics } from '@shared/contracts/dashboard'
import type { CliUsageWindow } from '@shared/contracts/usage'
import { PANEL_TYPE_LABELS } from '@shared/types'
import { useAiAccountsStore } from '@renderer/stores/ai-accounts-store'
import { useUsageStore } from '@renderer/stores/usage-store'
import { useTerminalStore } from '@renderer/stores/terminal-store'
import { useWorkspaceStore } from '@renderer/stores/workspace-store'
import { useServerStore } from '@renderer/stores/server-store'
import { useServerHealthStore, watchServerHealth } from '@renderer/stores/server-health-store'
import { useActivityAttentionStore } from '@renderer/stores/activity-attention-store'
import { checkAllAccountUsage } from '@renderer/lib/usage-sync'
import { focusWorkspacePanel, OPEN_SERVERS_EVENT } from '@renderer/lib/app-events'
import { isDocumentHidden, onDocumentVisibility } from '@renderer/lib/visibility'
import { SESSION_SIGNAL_ORDER, formatElapsed, isPtyPanelType, sessionSignal, type SessionSignal } from '@renderer/lib/project-activity'
import { useNow } from '@renderer/hooks/use-session-signals'
import { SignalIcon } from '@renderer/components/ui/SessionBadge'
import { useOpenProject } from '@renderer/hooks/use-open-project'
import { getCliLogo } from '@renderer/lib/cli-logos'
import { cn } from '@renderer/lib/utils'
import { HealthDot, ServerHealthTiles } from '@renderer/components/servers/ServerHealthView'
import { ContributionMap, Ring, StackedBars, compactNumber, dayKey, formatBytes, streaks } from './charts'
import { SystemCare } from './SystemCare'

/** Calls `load` now and every `intervalMs` while the window is visible. */
export function usePolled<T>(load: () => Promise<T>, intervalMs: number): { data: T | null; refresh: () => void; loading: boolean } {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(false)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let alive = true
    const run = (): void => {
      if (isDocumentHidden()) return
      setLoading(true)
      load()
        .then((value) => { if (alive) setData(value) })
        .catch(() => undefined)
        .finally(() => { if (alive) setLoading(false) })
    }
    run()
    const timer = window.setInterval(run, intervalMs)
    const stop = onDocumentVisibility((hidden) => { if (!hidden) run() })
    return () => {
      alive = false
      window.clearInterval(timer)
      stop()
    }
    // `load` is a stable module function for each widget.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intervalMs, tick])
  return { data, loading, refresh: () => setTick((value) => value + 1) }
}

function resetIn(window: CliUsageWindow | undefined): string {
  if (!window?.resetsAt) return window?.resetLabel ?? ''
  const ms = window.resetsAt * 1000 - Date.now()
  if (ms <= 0) return 'resets now'
  const hours = Math.floor(ms / 3_600_000)
  const minutes = Math.round((ms % 3_600_000) / 60_000)
  if (hours >= 24) return `resets in ${Math.floor(hours / 24)}d ${hours % 24}h`
  return hours > 0 ? `resets in ${hours}h ${minutes}m` : `resets in ${minutes}m`
}

export function WidgetEmpty({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <p className="home-empty">{children}</p>
}

/* Claude limits ----------------------------------------------------------- */

export function ClaudeLimitsWidget(): React.JSX.Element {
  const accounts = useAiAccountsStore((state) => state.accounts)
  const providers = useUsageStore((state) => state.providers)
  const [refreshing, setRefreshing] = useState(false)
  const claude = accounts.filter((account) => account.kind === 'claude')
  if (claude.length === 0) {
    return <WidgetEmpty>Sign in to Claude from a project's CLI accounts to see your limits here.</WidgetEmpty>
  }
  return (
    <div className="home-claude">
      {claude.map((account) => {
        const usage = providers.find((provider) => provider.accountId === account.id)
        const session = usage?.primary
        const weekly = usage?.secondary
        return (
          <div key={account.id} className="home-claude-account">
            <div className="home-claude-head">
              <img src={getCliLogo('claude') ?? undefined} alt="" />
              <span>
                <strong>{account.name || usage?.accountName || 'Claude'}</strong>
                <small>{[usage?.planType ?? account.plan, account.email || usage?.accountEmail].filter((part, index, list) => part && part !== (account.name || usage?.accountName) && list.indexOf(part) === index).join(' · ') || 'Claude Code'}</small>
              </span>
            </div>
            {account.apiKeyId ? (
              <p className="home-muted">API key account: billed per token, no plan limits.</p>
            ) : session || weekly ? (
              <div className="home-claude-limits">
                {session && <Ring value={session.usedPercent} label={`${Math.round(session.usedPercent)}%`} sublabel="5-hour" size={84} />}
                <div className="home-claude-bars">
                  {weekly && (
                    <div className="home-limit">
                      <span>Weekly <b>{Math.round(weekly.usedPercent)}%</b></span>
                      <span className="home-limit-track"><i style={{ width: `${Math.min(100, weekly.usedPercent)}%` }} /></span>
                      <small>{resetIn(weekly)}</small>
                    </div>
                  )}
                  {session && <small className="home-muted">Session {resetIn(session)}</small>}
                </div>
              </div>
            ) : (
              <p className="home-muted">{usage?.detail || 'Waiting for the first usage check.'}</p>
            )}
          </div>
        )
      })}
      <button
        type="button"
        className="home-link-button"
        disabled={refreshing}
        onClick={() => {
          setRefreshing(true)
          void checkAllAccountUsage().finally(() => setRefreshing(false))
        }}
      >
        <RefreshCw className={cn('h-3 w-3', refreshing && 'animate-spin')} aria-hidden /> {refreshing ? 'Checking…' : 'Check now'}
      </button>
    </div>
  )
}

/* Live sessions ----------------------------------------------------------- */

type SessionTone = SessionSignal

const SESSION_ROW_LABEL: Record<SessionSignal, string> = {
  asking: 'Needs your answer',
  error: 'Error',
  working: 'Working',
  done: 'Done · not seen yet',
  idle: 'Ready',
  off: 'Stopped'
}

export function SessionsWidget(): React.JSX.Element {
  const projects = useWorkspaceStore((state) => state.projects)
  const workspaces = useWorkspaceStore((state) => state.workspaces)
  const setActiveProject = useWorkspaceStore((state) => state.setActiveProject)
  const sessions = useTerminalStore((state) => state.sessions)
  const asking = useTerminalStore((state) => state.asking)
  const busySince = useTerminalStore((state) => state.busySince)
  const attention = useActivityAttentionStore((state) => state.attentionByProject)
  const now = useNow(30_000)

  const rows = useMemo(() => {
    const list: Array<{ projectId: string; project: string; panelId: string; title: string; type: string; tone: SessionTone; label: string }> = []
    for (const project of projects) {
      const unseen = new Map((attention[project.id] ?? []).map((item) => [item.panelId, item.outcome]))
      for (const panel of workspaces[project.id]?.panels ?? []) {
        if (!isPtyPanelType(panel.type)) continue
        const tone = sessionSignal({ status: sessions[panel.id], asking: asking[panel.id], unseen: unseen.get(panel.id) })
        const since = busySince[panel.id]
        const label = tone === 'working' && since ? `Working · ${formatElapsed(since, now)}` : SESSION_ROW_LABEL[tone]
        list.push({ projectId: project.id, project: project.name, panelId: panel.id, title: panel.title, type: panel.type, tone, label })
      }
    }
    return list.sort((a, b) => SESSION_SIGNAL_ORDER.indexOf(a.tone) - SESSION_SIGNAL_ORDER.indexOf(b.tone))
  }, [asking, attention, busySince, now, projects, sessions, workspaces])

  const counts = rows.reduce<Record<SessionTone, number>>(
    (sum, row) => ({ ...sum, [row.tone]: sum[row.tone] + 1 }),
    { asking: 0, error: 0, working: 0, done: 0, idle: 0, off: 0 }
  )

  if (rows.length === 0) return <WidgetEmpty>No open sessions. Open a project and start Claude; its progress shows up here.</WidgetEmpty>
  return (
    <div className="home-sessions">
      <div className="home-session-counts">
        {counts.asking > 0 && <span className="tone-asking"><b>{counts.asking}</b> need you</span>}
        <span className="tone-working"><b>{counts.working}</b> working</span>
        <span className="tone-done"><b>{counts.done}</b> done</span>
        {counts.error > 0 && <span className="tone-error"><b>{counts.error}</b> errors</span>}
        <span className="tone-idle"><b>{counts.idle}</b> ready</span>
      </div>
      <ul className="home-session-list">
        {rows.slice(0, 12).map((row) => (
          <li key={row.panelId}>
            <button
              type="button"
              className={cn('home-session', `tone-${row.tone}`)}
              onClick={() => {
                setActiveProject(row.projectId)
                // Focusing the panel marks it seen.
                window.setTimeout(() => focusWorkspacePanel(row.panelId), 60)
              }}
            >
              {row.tone === 'idle' || row.tone === 'off'
                ? <span className="home-session-pulse" aria-hidden />
                : <SignalIcon signal={row.tone} className="home-session-signal" />}
              <span className="home-session-text">
                <strong>{row.title || PANEL_TYPE_LABELS[row.type as keyof typeof PANEL_TYPE_LABELS]}</strong>
                <small>{row.project}</small>
              </span>
              <span className="home-session-status">{row.label}</span>
              <ArrowUpRight className="h-3.5 w-3.5 home-session-go" aria-hidden />
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

/* This Mac ---------------------------------------------------------------- */

const THERMAL_COPY: Record<NonNullable<SystemMetrics['thermal']>, string> = {
  nominal: 'Cool',
  fair: 'Warm',
  serious: 'Hot · throttling',
  critical: 'Critical heat'
}

export function SystemWidget(): React.JSX.Element {
  const { data, refresh } = usePolled(() => window.api.dashboard.system(), 5_000)
  if (!data) return <WidgetEmpty>Reading this Mac…</WidgetEmpty>
  const memory = (data.memory.usedBytes / data.memory.totalBytes) * 100
  const disk = data.disk ? ((data.disk.totalBytes - data.disk.freeBytes) / data.disk.totalBytes) * 100 : null
  // Helpers like mdworker_shared run as several processes; show them as one.
  const grouped = Object.values(
    data.topProcesses.reduce<Record<string, { name: string; cpuPercent: number; memoryBytes: number; count: number }>>((groups, process) => {
      const group = (groups[process.name] ??= { name: process.name, cpuPercent: 0, memoryBytes: 0, count: 0 })
      group.cpuPercent += process.cpuPercent
      group.memoryBytes += process.memoryBytes
      group.count += 1
      return groups
    }, {})
  ).sort((a, b) => b.cpuPercent - a.cpuPercent).slice(0, 5)
  const topCpu = Math.max(1, ...grouped.map((process) => process.cpuPercent))
  return (
    <div className="home-system">
      <div className="home-system-rings">
        <Ring value={data.cpuPercent} label={`${data.cpuPercent}%`} sublabel="CPU" tone="teal" />
        <Ring value={memory} label={`${Math.round(memory)}%`} sublabel="Memory" tone="violet" />
        {disk !== null && <Ring value={disk} label={formatBytes(data.disk!.freeBytes)} sublabel="free" tone="sky" />}
      </div>
      <div className="home-system-facts">
        {data.thermal && (
          <span className={cn('home-chip', `thermal-${data.thermal}`)}>
            <Thermometer className="h-3 w-3" aria-hidden /> {THERMAL_COPY[data.thermal]}
          </span>
        )}
        {data.swapUsedBytes !== null && (
          <span className={cn('home-chip', data.swapUsedBytes > 2 * 1024 ** 3 && 'is-warn')} title="Swap grows when memory runs short">
            Swap {formatBytes(data.swapUsedBytes)}
          </span>
        )}
        {data.battery && (
          <span className="home-chip">
            {data.battery.charging ? <BatteryCharging className="h-3 w-3" aria-hidden /> : <BatteryMedium className="h-3 w-3" aria-hidden />}
            {data.battery.percent}%
          </span>
        )}
        <span className="home-chip">Load {data.load1.toFixed(1)} / {data.cpus}</span>
      </div>
      <SystemCare onCleaned={refresh} />
      <div className="home-procs">
        <span className="home-procs-title"><Flame className="h-3 w-3" aria-hidden /> Heaviest right now</span>
        {grouped.map((process) => (
          <div key={process.name} className="home-proc" title={`${process.count} process${process.count === 1 ? '' : 'es'} · ${formatBytes(process.memoryBytes)}`}>
            <span className="home-proc-name">{process.name}{process.count > 1 ? ` ×${process.count}` : ''}</span>
            <span className="home-proc-bar"><i style={{ width: `${(process.cpuPercent / topCpu) * 100}%` }} /></span>
            <span className="home-proc-value">{process.cpuPercent.toFixed(0)}%</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/* Servers ----------------------------------------------------------------- */

export function ServersWidget(): React.JSX.Element {
  const servers = useServerStore((state) => state.servers)
  const projects = useWorkspaceStore((state) => state.projects)
  const activeProjectId = useWorkspaceStore((state) => state.activeProjectId)
  const setActiveProject = useWorkspaceStore((state) => state.setActiveProject)
  const healthById = useServerHealthStore((state) => state.healthById)
  const checkingIds = useServerHealthStore((state) => state.checkingIds)
  const historyById = useServerHealthStore((state) => state.historyById)
  useEffect(() => watchServerHealth(), [])
  if (servers.length === 0) {
    return (
      <WidgetEmpty>
        No servers yet. Add them in a project's Servers panel on the right.
        <button
          type="button"
          className="home-link-button"
          disabled={projects.length === 0}
          onClick={() => {
            // The Servers dock lives in a project workspace.
            const target = activeProjectId ?? projects[0]?.id
            if (target) setActiveProject(target)
            window.setTimeout(() => window.dispatchEvent(new Event(OPEN_SERVERS_EVENT)), 60)
          }}
        >
          <Server className="h-3 w-3" aria-hidden /> Open Servers
        </button>
      </WidgetEmpty>
    )
  }
  const states = servers.map((server) => healthById[server.id]?.state)
  const count = (state: string): number => states.filter((value) => value === state).length
  const latencies = servers.map((server) => healthById[server.id]?.latencyMs).filter((value): value is number => typeof value === 'number')
  const averageLatency = latencies.length > 0 ? Math.round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length) : null
  return (
    <div className="home-servers">
      <div className="home-servers-summary">
        <span className="tone-healthy"><b>{count('healthy') + count('reachable')}</b> online</span>
        {count('warning') > 0 && <span className="tone-warning"><b>{count('warning')}</b> need attention</span>}
        {count('down') > 0 && <span className="tone-down"><b>{count('down')}</b> down</span>}
        {averageLatency !== null && <span className="home-servers-latency">avg {averageLatency} ms</span>}
        <button
          type="button"
          className="home-servers-refresh"
          onClick={() => void useServerHealthStore.getState().checkAll()}
          aria-label="Check all servers now"
          title="Check all servers now"
        >
          <RefreshCw className={cn('h-3 w-3', Object.values(checkingIds).some(Boolean) && 'animate-spin')} aria-hidden />
        </button>
      </div>
      {servers.map((server) => (
        <div key={server.id} className="home-server">
          <div className="home-server-head">
            <HealthDot health={healthById[server.id]} checking={checkingIds[server.id]} />
            <strong>{server.name}</strong>
            <small>{healthById[server.id]?.metrics?.hostname ?? server.host}</small>
          </div>
          <ServerHealthTiles health={healthById[server.id]} history={historyById[server.id]} />
        </div>
      ))}
    </div>
  )
}

/* Prompts and tokens ------------------------------------------------------ */

const loadActivity = (): Promise<ClaudeActivity> => window.api.dashboard.claudeActivity()

export function TokensWidget({ activity }: { activity: ClaudeActivity | null }): React.JSX.Element {
  const [range, setRange] = useState<14 | 30 | 90>(30)
  const byDate = useMemo(() => new Map((activity?.days ?? []).map((day) => [day.date, day])), [activity])
  const data = useMemo(() => {
    const list = []
    for (let index = range - 1; index >= 0; index -= 1) {
      const date = new Date()
      date.setDate(date.getDate() - index)
      const key = dayKey(date)
      const day = byDate.get(key)
      list.push({
        key,
        label: date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
        values: [day?.outputTokens ?? 0, (day?.inputTokens ?? 0) + (day?.cacheWriteTokens ?? 0)]
      })
    }
    return list
  }, [byDate, range])
  if (!activity) return <WidgetEmpty>Reading your Claude sessions…</WidgetEmpty>
  const inRange = activity.days.filter((day) => data.some((item) => item.key === day.date))
  const sum = (pick: (day: ClaudeActivity['days'][number]) => number): number => inRange.reduce((total, day) => total + pick(day), 0)
  const prompts = sum((day) => day.prompts)
  const output = sum((day) => day.outputTokens)
  const fresh = sum((day) => day.inputTokens + day.cacheWriteTokens)
  const cached = sum((day) => day.cacheReadTokens)
  const today = byDate.get(dayKey(new Date()))
  return (
    <div className="home-tokens">
      <div className="home-tokens-top">
        <div className="home-kpis">
          <div><small>Prompts</small><strong>{compactNumber(prompts)}</strong></div>
          <div><small>Output tokens</small><strong>{compactNumber(output)}</strong></div>
          <div><small>Input + cache write</small><strong>{compactNumber(fresh)}</strong></div>
          <div><small>Read from cache</small><strong>{compactNumber(cached)}</strong></div>
        </div>
        <div className="home-segment" role="group" aria-label="Range">
          {([14, 30, 90] as const).map((value) => (
            <button key={value} type="button" className={cn(range === value && 'is-on')} onClick={() => setRange(value)}>{value}d</button>
          ))}
        </div>
      </div>
      <StackedBars
        data={data}
        series={[{ name: 'Output', className: 'series-a' }, { name: 'Input', className: 'series-b' }]}
      />
      <div className="home-tokens-foot">
        <span>Today: <b>{today?.prompts ?? 0}</b> prompts · <b>{compactNumber(today?.outputTokens ?? 0)}</b> output tokens</span>
        <span className="home-models">
          {activity.models.slice(0, 3).map((model) => (
            <span key={model.model} className="home-chip">{model.model.replace(/^claude-/, '')} · {compactNumber(model.outputTokens)}</span>
          ))}
        </span>
      </div>
    </div>
  )
}

export function useClaudeActivity(): ClaudeActivity | null {
  return usePolled(loadActivity, 5 * 60_000).data
}

/* Commit map -------------------------------------------------------------- */

const loadGit = (): Promise<GitActivity> => window.api.dashboard.gitActivity()

export function useGitActivity(): GitActivity | null {
  return usePolled(loadGit, 10 * 60_000).data
}

export function GitWidget({ git, activity }: { git: GitActivity | null; activity: ClaudeActivity | null }): React.JSX.Element {
  const [source, setSource] = useState<'commits' | 'prompts'>('commits')
  const promptDays = useMemo(
    () => Object.fromEntries((activity?.days ?? []).map((day) => [day.date, day.prompts])),
    [activity]
  )
  const days = source === 'commits' ? git?.days ?? {} : promptDays
  const run = streaks(days)
  const total = Object.values(days).reduce((a, b) => a + b, 0)
  return (
    <div className="home-git">
      <div className="home-tokens-top">
        <div className="home-kpis">
          <div><small>{source === 'commits' ? 'Commits this year' : 'Prompts this year'}</small><strong>{compactNumber(total)}</strong></div>
          <div><small>Current streak</small><strong>{run.current}<em>d</em></strong></div>
          <div><small>Longest streak</small><strong>{run.longest}<em>d</em></strong></div>
        </div>
        <div className="home-segment" role="group" aria-label="Map source">
          <button type="button" className={cn(source === 'commits' && 'is-on')} onClick={() => setSource('commits')}>
            <GitCommitHorizontal className="h-3 w-3" aria-hidden /> Commits
          </button>
          <button type="button" className={cn(source === 'prompts' && 'is-on')} onClick={() => setSource('prompts')}>Prompts</button>
        </div>
      </div>
      <ContributionMap days={days} unit={source === 'commits' ? 'commit' : 'prompt'} />
      {source === 'commits' && git && git.projects.length > 0 && (
        <div className="home-models">
          {git.projects.slice(0, 6).map((project) => (
            <span key={project.name} className="home-chip">{project.name} · {project.commits}</span>
          ))}
        </div>
      )}
    </div>
  )
}

/* Projects ---------------------------------------------------------------- */

export function ProjectsWidget(): React.JSX.Element {
  const { openFolderPicker } = useOpenProject()
  const projects = useWorkspaceStore((state) => state.projects)
  const workspaces = useWorkspaceStore((state) => state.workspaces)
  const sessions = useTerminalStore((state) => state.sessions)
  const setActiveProject = useWorkspaceStore((state) => state.setActiveProject)
  return (
    <div className="home-projects">
      <button type="button" className="home-project is-action" onClick={() => void openFolderPicker()}>
        <FolderOpen className="h-4 w-4" aria-hidden />
        <span><strong>Open project</strong><small>Choose a folder</small></span>
      </button>
      <button type="button" className="home-project is-action" onClick={() => void openFolderPicker({ forceNew: true })}>
        <FolderPlus className="h-4 w-4" aria-hidden />
        <span><strong>New project</strong><small>Start fresh</small></span>
      </button>
      {projects.map((project) => {
        const working = (workspaces[project.id]?.panels ?? []).filter((panel) => sessions[panel.id] === 'busy').length
        return (
          <button key={project.id} type="button" className={cn('home-project', working > 0 && 'is-working')} onClick={() => setActiveProject(project.id)} title={project.folderPath ?? project.name}>
            <Folder className="h-4 w-4" aria-hidden />
            <span><strong>{project.name}</strong><small>{working > 0 ? `${working} working` : project.folderPath?.replace(/^\/Users\/[^/]+/, '~')}</small></span>
          </button>
        )
      })}
    </div>
  )
}
