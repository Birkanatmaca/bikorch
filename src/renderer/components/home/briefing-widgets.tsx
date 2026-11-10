import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, Copy, ExternalLink, Plus, RefreshCw, ShieldAlert, Sparkles } from 'lucide-react'
import type { Briefing, BriefingKind, BriefingMode, NewsItem } from '@shared/contracts/dashboard'
import { TASK_STATUS_LABELS, type ProjectTask, type TaskPriority } from '@shared/contracts/tasks'
import { useTasksStore } from '@renderer/stores/tasks-store'
import { useWorkspaceStore } from '@renderer/stores/workspace-store'
import { isDocumentHidden, onDocumentVisibility } from '@renderer/lib/visibility'
import { cn } from '@renderer/lib/utils'
import { WidgetEmpty } from './widgets'

/* Shared --------------------------------------------------------------------- */

function formatAgo(at: number | null): string {
  if (!at) return ''
  const minutes = Math.floor((Date.now() - at) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

/** Re-checks a stale briefing every half hour while Home is visible. */
const AUTO_CHECK_MS = 30 * 60 * 1000

/**
 * Shows the stored briefing at once, then lets the main process decide
 * whether Claude needs to run. A run takes a minute or two.
 */
function useBriefing<K extends BriefingKind>(kind: K): {
  briefing: Briefing<K> | null
  running: boolean
  refresh: () => void
} {
  const [briefing, setBriefing] = useState<Briefing<K> | null>(null)
  const [running, setRunning] = useState(false)
  const alive = useRef(true)

  const load = useCallback((mode: BriefingMode) => {
    if (!window.api?.dashboard?.briefing) return
    if (mode !== 'cached') setRunning(true)
    window.api.dashboard.briefing(kind, mode)
      .then((next) => { if (alive.current) setBriefing(next) })
      .catch(() => undefined)
      .finally(() => { if (alive.current && mode !== 'cached') setRunning(false) })
  }, [kind])

  useEffect(() => {
    alive.current = true
    load('cached')
    if (!isDocumentHidden()) load('auto')
    const timer = window.setInterval(() => { if (!isDocumentHidden()) load('auto') }, AUTO_CHECK_MS)
    const stop = onDocumentVisibility((hidden) => { if (!hidden) load('auto') })
    return () => {
      alive.current = false
      window.clearInterval(timer)
      stop()
    }
  }, [load])

  return { briefing, running, refresh: () => load('force') }
}

function BriefingBar({
  briefing,
  running,
  refresh,
  label,
  children
}: {
  briefing: Briefing | null
  running: boolean
  refresh: () => void
  label: string
  children?: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="home-brief-bar">
      {children}
      <span className="home-brief-meta">
        {running ? 'Claude is searching…' : briefing?.generatedAt ? `Updated ${formatAgo(briefing.generatedAt)}` : ''}
      </span>
      <button
        type="button"
        className="home-icon-button"
        onClick={refresh}
        disabled={running}
        aria-label={label}
        title={label}
      >
        <RefreshCw className={cn('h-3.5 w-3.5', running && 'animate-spin')} aria-hidden />
      </button>
    </div>
  )
}

function BriefingState({ briefing, running, what }: { briefing: Briefing | null; running: boolean; what: string }): React.JSX.Element | null {
  if (briefing && briefing.items.length > 0) {
    return briefing.error ? <p className="home-brief-error">{briefing.error} Showing the last results.</p> : null
  }
  if (running || !briefing) {
    return (
      <div className="home-brief-loading" role="status">
        <Sparkles className="h-4 w-4" aria-hidden />
        <span>Claude is looking for {what}. This takes a minute or two the first time.</span>
      </div>
    )
  }
  if (briefing.status === 'no-claude') return <WidgetEmpty>Install Claude Code to see {what} here.</WidgetEmpty>
  return <WidgetEmpty>{briefing.error ?? `No ${what} yet. Use refresh to ask Claude.`}</WidgetEmpty>
}

/* Tasks ---------------------------------------------------------------------- */

const PRIORITY_RANK: Record<TaskPriority, number> = { high: 0, medium: 1, low: 2 }
const STATUS_RANK: Record<ProjectTask['status'], number> = { 'in-progress': 0, todo: 1, wait: 2, done: 3 }

type TaskFilter = 'open' | 'doing' | 'high'

export function TasksWidget(): React.JSX.Element {
  const tasksByProject = useTasksStore((state) => state.tasksByProject)
  const addTask = useTasksStore((state) => state.addTask)
  const setTaskStatus = useTasksStore((state) => state.setTaskStatus)
  const projects = useWorkspaceStore((state) => state.projects)
  const activeProjectId = useWorkspaceStore((state) => state.activeProjectId)
  const setActiveProject = useWorkspaceStore((state) => state.setActiveProject)
  const [filter, setFilter] = useState<TaskFilter>('open')
  const [draft, setDraft] = useState('')
  const [target, setTarget] = useState<string | null>(null)
  const [justDone, setJustDone] = useState<string | null>(null)

  const projectName = useMemo(() => new Map(projects.map((project) => [project.id, project.name])), [projects])
  const all = useMemo(
    () => Object.entries(tasksByProject).flatMap(([projectId, tasks]) =>
      projectName.has(projectId) ? tasks.map((task) => ({ task, projectId })) : []),
    [tasksByProject, projectName]
  )
  const weekAgo = Date.now() - 7 * 86_400_000
  const open = all.filter(({ task }) => task.status !== 'done')
  const doing = open.filter(({ task }) => task.status === 'in-progress').length
  const doneThisWeek = all.filter(({ task }) => task.status === 'done' && (task.completedAt ?? 0) >= weekAgo).length
  const shown = open
    .filter(({ task }) => filter === 'open' || (filter === 'doing' ? task.status === 'in-progress' : task.priority === 'high'))
    .sort((a, b) =>
      STATUS_RANK[a.task.status] - STATUS_RANK[b.task.status] ||
      PRIORITY_RANK[a.task.priority] - PRIORITY_RANK[b.task.priority] ||
      a.task.createdAt - b.task.createdAt)

  const addTo = target && projectName.has(target) ? target : activeProjectId && projectName.has(activeProjectId) ? activeProjectId : projects[0]?.id ?? null

  if (projects.length === 0) return <WidgetEmpty>Open a project to start keeping tasks.</WidgetEmpty>

  return (
    <div className="home-tasks">
      <div className="home-task-counts">
        <span><b>{open.length}</b> open</span>
        <span className="tone-doing"><b>{doing}</b> doing</span>
        <span className="tone-done"><b>{doneThisWeek}</b> done this week</span>
      </div>
      <form
        className="home-task-add"
        onSubmit={(event) => {
          event.preventDefault()
          if (!addTo || !draft.trim()) return
          if (addTask(addTo, draft)) setDraft('')
        }}
      >
        <input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Add a task…" aria-label="New task" maxLength={500} />
        {projects.length > 1 && (
          <select value={addTo ?? ''} onChange={(event) => setTarget(event.target.value)} aria-label="Project for the new task">
            {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
          </select>
        )}
        <button type="submit" className="home-icon-button" aria-label="Add task" disabled={!draft.trim()}>
          <Plus className="h-3.5 w-3.5" aria-hidden />
        </button>
      </form>
      <div className="home-segment is-small" role="tablist" aria-label="Filter tasks">
        {(['open', 'doing', 'high'] as const).map((value) => (
          <button key={value} type="button" role="tab" aria-selected={filter === value} className={cn(filter === value && 'is-on')} onClick={() => setFilter(value)}>
            {value === 'open' ? 'All open' : value === 'doing' ? 'Doing' : 'High priority'}
          </button>
        ))}
      </div>
      {shown.length === 0 ? (
        <p className="home-muted">{open.length === 0 ? 'Nothing open. Nice.' : 'No tasks match this filter.'}</p>
      ) : (
        <ul className="home-task-list">
          {shown.map(({ task, projectId }) => (
            <li key={task.id} className={cn('home-task', `is-${task.status}`, justDone === task.id && 'is-leaving')}>
              <button
                type="button"
                className="home-task-check"
                aria-label={`Mark "${task.title}" done`}
                title="Mark done"
                onClick={() => {
                  setJustDone(task.id)
                  window.setTimeout(() => {
                    setTaskStatus(projectId, task.id, 'done')
                    setJustDone(null)
                  }, 220)
                }}
              >
                <Check className="h-3 w-3" aria-hidden />
              </button>
              <span className={cn('home-task-priority', `is-${task.priority}`)} title={`${task.priority} priority`} aria-label={`${task.priority} priority`} />
              <span className="home-task-title" title={task.title}>{task.title}</span>
              {task.status !== 'todo' && <span className="home-task-status">{TASK_STATUS_LABELS[task.status]}</span>}
              <button type="button" className="home-task-project" onClick={() => setActiveProject(projectId)} title="Open this project">
                {projectName.get(projectId)}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/* Dev notes ------------------------------------------------------------------ */

function CopyButton({ text }: { text: string }): React.JSX.Element {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      className="home-tip-copy"
      aria-label="Copy"
      title="Copy"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setCopied(true)
          window.setTimeout(() => setCopied(false), 1200)
        })
      }}
    >
      {copied ? <Check className="h-3 w-3" aria-hidden /> : <Copy className="h-3 w-3" aria-hidden />}
    </button>
  )
}

export function TipsWidget(): React.JSX.Element {
  const { briefing, running, refresh } = useBriefing('tips')
  return (
    <div className="home-brief">
      <BriefingBar briefing={briefing} running={running} refresh={refresh} label="Ask Claude for new notes" />
      <BriefingState briefing={briefing} running={running} what="notes for you" />
      {briefing && briefing.items.length > 0 && (
        <ul className="home-tip-list">
          {briefing.items.map((tip) => (
            <li key={tip.title} className="home-tip">
              <span className="home-brief-tag">{tip.category}</span>
              <strong>{tip.title}</strong>
              <p>{tip.body}</p>
              {tip.snippet && (
                <div className="home-tip-snippet">
                  <code>{tip.snippet}</code>
                  <CopyButton text={tip.snippet} />
                </div>
              )}
              {tip.url && (
                <a className="home-brief-link" href={tip.url} target="_blank" rel="noreferrer noopener">
                  Read more <ExternalLink className="h-3 w-3" aria-hidden />
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/* News ----------------------------------------------------------------------- */

type NewsFilter = 'all' | NewsItem['category']

const SEVERITY_LABEL: Record<NonNullable<NewsItem['severity']>, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low'
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

export function NewsWidget(): React.JSX.Element {
  const { briefing, running, refresh } = useBriefing('news')
  const [filter, setFilter] = useState<NewsFilter>('all')
  const items = briefing?.items ?? []
  const shown = items.filter((item) => filter === 'all' || item.category === filter)
  const securityCount = items.filter((item) => item.category === 'security').length
  return (
    <div className="home-brief">
      <BriefingBar briefing={briefing} running={running} refresh={refresh} label="Ask Claude for fresh news">
        {items.length > 0 && (
          <div className="home-segment is-small" role="tablist" aria-label="Filter news">
            {(['all', 'software', 'security'] as const).map((value) => (
              <button key={value} type="button" role="tab" aria-selected={filter === value} className={cn(filter === value && 'is-on')} onClick={() => setFilter(value)}>
                {value === 'all' ? `All ${items.length}` : value === 'software' ? `Software ${items.length - securityCount}` : `Security ${securityCount}`}
              </button>
            ))}
          </div>
        )}
      </BriefingBar>
      <BriefingState briefing={briefing} running={running} what="today's software and security news" />
      {shown.length > 0 && (
        <ol className="home-news-list">
          {shown.map((item) => (
            <li key={item.url} className={cn('home-news', `is-${item.category}`)}>
              <div className="home-news-tags">
                <span className={cn('home-brief-tag', item.category === 'security' && 'is-security')}>
                  {item.category === 'security' ? <ShieldAlert className="h-2.5 w-2.5" aria-hidden /> : null}
                  {item.category === 'security' ? 'Security' : 'Software'}
                </span>
                {item.severity && <span className={cn('home-news-severity', `is-${item.severity}`)}>{SEVERITY_LABEL[item.severity]}</span>}
                {item.region === 'tr' && <span className="home-brief-tag">TR</span>}
                <span className="home-news-source">
                  {item.source}{item.publishedAt ? ` · ${item.publishedAt}` : ''}
                </span>
              </div>
              <a className="home-news-title" href={item.url} target="_blank" rel="noreferrer noopener" title={item.url}>
                {item.title}
                <ExternalLink className="h-3 w-3" aria-hidden />
              </a>
              {item.summary && <p className="home-news-summary">{item.summary}</p>}
              {item.analysis && (
                <p className="home-news-analysis">
                  <Sparkles className="h-3 w-3" aria-hidden />
                  <span>{item.analysis}</span>
                </p>
              )}
              <span className="home-news-host">{hostOf(item.url)}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
