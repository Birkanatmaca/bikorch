import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity,
  Check,
  Cpu,
  FolderKanban,
  GitBranch,
  GripVertical,
  LayoutGrid,
  Plus,
  RotateCcw,
  Server,
  Sparkles,
  TerminalSquare,
  X,
  type LucideIcon
} from 'lucide-react'
import {
  DEFAULT_HOME_LAYOUT,
  HOME_WIDGETS,
  HOME_WIDGET_COPY,
  parseHomeLayout,
  type HomeWidgetId,
  type HomeWidgetLayout
} from '@shared/contracts/dashboard'
import { useAiAccountsStore } from '@renderer/stores/ai-accounts-store'
import { useTerminalStore } from '@renderer/stores/terminal-store'
import { cn } from '@renderer/lib/utils'
import { compactNumber, dayKey, streaks } from './charts'
import {
  ClaudeLimitsWidget,
  GitWidget,
  ProjectsWidget,
  ServersWidget,
  SessionsWidget,
  SystemWidget,
  TokensWidget,
  useClaudeActivity,
  useGitActivity
} from './widgets'

const LAYOUT_KEY = 'bikorch.home.layout'

const WIDGET_ICON: Record<HomeWidgetId, LucideIcon> = {
  claude: Sparkles,
  sessions: TerminalSquare,
  system: Cpu,
  servers: Server,
  tokens: Activity,
  git: GitBranch,
  projects: FolderKanban
}

const WIDGET_TONE: Record<HomeWidgetId, string> = {
  claude: 'tone-coral',
  sessions: 'tone-green',
  system: 'tone-teal',
  servers: 'tone-sky',
  tokens: 'tone-violet',
  git: 'tone-green',
  projects: 'tone-amber'
}

function readLayout(): HomeWidgetLayout[] {
  try {
    const raw = window.localStorage.getItem(LAYOUT_KEY)
    return raw ? parseHomeLayout(JSON.parse(raw)) : DEFAULT_HOME_LAYOUT
  } catch {
    return DEFAULT_HOME_LAYOUT
  }
}

function writeLayout(layout: HomeWidgetLayout[]): void {
  try {
    window.localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout))
  } catch {
    // The dashboard still works; the layout just is not remembered.
  }
}

/** "birkan.atmaca@x.com" or "Birkan Atmaca" → "Birkan". */
function firstName(value: string | undefined): string | null {
  const word = value?.split(/[\s@._-]/).find(Boolean)
  return word ? word.charAt(0).toUpperCase() + word.slice(1) : null
}

function greeting(): string {
  const hour = new Date().getHours()
  if (hour < 5) return 'Working late'
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

/** The first screen: everything about your work at a glance, arranged your way. */
export function HomeDashboard(): React.JSX.Element {
  const [layout, setLayoutState] = useState<HomeWidgetLayout[]>(readLayout)
  const [editing, setEditing] = useState(false)
  const [dragId, setDragId] = useState<HomeWidgetId | null>(null)
  const [overId, setOverId] = useState<HomeWidgetId | null>(null)
  const activity = useClaudeActivity()
  const git = useGitActivity()
  const accounts = useAiAccountsStore((state) => state.accounts)
  const sessions = useTerminalStore((state) => state.sessions)
  const scrollRef = useRef<HTMLDivElement>(null)

  const setLayout = (next: HomeWidgetLayout[]): void => {
    setLayoutState(next)
    writeLayout(next)
  }

  useEffect(() => {
    if (!editing) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setEditing(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editing])

  const hidden = HOME_WIDGETS.filter((id) => !layout.some((item) => item.id === id))
  const name = firstName(accounts.find((account) => account.kind === 'claude')?.name)
  const today = activity?.days.find((day) => day.date === dayKey(new Date()))
  const working = Object.values(sessions).filter((status) => status === 'busy' || status === 'starting').length
  const weekCommits = useMemo(() => {
    if (!git) return 0
    let total = 0
    for (let index = 0; index < 7; index += 1) {
      const date = new Date()
      date.setDate(date.getDate() - index)
      total += git.days[dayKey(date)] ?? 0
    }
    return total
  }, [git])
  const promptStreak = useMemo(
    () => streaks(Object.fromEntries((activity?.days ?? []).map((day) => [day.date, day.prompts]))).current,
    [activity]
  )

  const move = (id: HomeWidgetId, target: HomeWidgetId): void => {
    if (id === target) return
    const next = layout.filter((item) => item.id !== id)
    const index = next.findIndex((item) => item.id === target)
    const moved = layout.find((item) => item.id === id)
    if (!moved || index < 0) return
    next.splice(index, 0, moved)
    setLayout(next)
  }

  const renderWidget = (id: HomeWidgetId): React.JSX.Element => {
    switch (id) {
      case 'claude': return <ClaudeLimitsWidget />
      case 'sessions': return <SessionsWidget />
      case 'system': return <SystemWidget />
      case 'servers': return <ServersWidget />
      case 'tokens': return <TokensWidget activity={activity} />
      case 'git': return <GitWidget git={git} activity={activity} />
      case 'projects': return <ProjectsWidget />
    }
  }

  return (
    <div ref={scrollRef} className={cn('home-dashboard', editing && 'is-editing')}>
      <div className="home-aurora" aria-hidden />
      <div className="home-inner">
        <header className="home-hero">
          <div className="home-hero-text">
            <span className="home-eyebrow">
              {new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
            </span>
            <h1>
              {greeting()}
              {name ? <>, <span className="home-gradient-text">{name}</span></> : null}
            </h1>
            <p>
              {working > 0
                ? `${working} session${working === 1 ? ' is' : 's are'} working right now.`
                : 'Everything is quiet. Pick up where you left off.'}
            </p>
          </div>
          <div className="home-hero-actions">
            {editing && (
              <button type="button" className="home-ghost" onClick={() => setLayout(DEFAULT_HOME_LAYOUT)}>
                <RotateCcw className="h-3.5 w-3.5" aria-hidden /> Reset
              </button>
            )}
            <button type="button" className={cn('home-ghost', editing && 'is-on')} onClick={() => setEditing(!editing)}>
              {editing ? <Check className="h-3.5 w-3.5" aria-hidden /> : <LayoutGrid className="h-3.5 w-3.5" aria-hidden />}
              {editing ? 'Done' : 'Customize'}
            </button>
          </div>
        </header>

        <section className="home-stats" aria-label="Today">
          <div className="home-stat tone-violet">
            <small>Prompts today</small>
            <strong>{today?.prompts ?? 0}</strong>
          </div>
          <div className="home-stat tone-coral">
            <small>Output tokens today</small>
            <strong>{compactNumber(today?.outputTokens ?? 0)}</strong>
          </div>
          <div className="home-stat tone-green">
            <small>Commits this week</small>
            <strong>{weekCommits}</strong>
          </div>
          <div className="home-stat tone-amber">
            <small>Prompt streak</small>
            <strong>{promptStreak}<em>days</em></strong>
          </div>
        </section>

        {editing && hidden.length > 0 && (
          <div className="home-add-row">
            <span>Add a widget</span>
            {hidden.map((id) => {
              const Icon = WIDGET_ICON[id]
              return (
                <button key={id} type="button" className="home-add-chip" onClick={() => setLayout([...layout, { id, span: id === 'projects' ? 3 : 1 }])}>
                  <Plus className="h-3 w-3" aria-hidden />
                  <Icon className="h-3 w-3" aria-hidden />
                  {HOME_WIDGET_COPY[id].title}
                </button>
              )
            })}
          </div>
        )}

        <div className="home-grid">
          {layout.map(({ id, span }) => {
            const Icon = WIDGET_ICON[id]
            return (
              <article
                key={id}
                className={cn('home-widget', WIDGET_TONE[id], `span-${span}`, dragId === id && 'is-dragging', overId === id && dragId !== id && 'is-drop')}
                draggable={editing}
                onDragStart={(event) => {
                  setDragId(id)
                  event.dataTransfer.effectAllowed = 'move'
                }}
                onDragOver={(event) => {
                  if (!dragId) return
                  event.preventDefault()
                  setOverId(id)
                }}
                onDrop={(event) => {
                  event.preventDefault()
                  if (dragId) move(dragId, id)
                  setDragId(null)
                  setOverId(null)
                }}
                onDragEnd={() => {
                  setDragId(null)
                  setOverId(null)
                }}
              >
                <header className="home-widget-head">
                  {editing && <GripVertical className="home-grip h-3.5 w-3.5" aria-hidden />}
                  <span className="home-widget-icon"><Icon className="h-3.5 w-3.5" aria-hidden /></span>
                  <h2 title={HOME_WIDGET_COPY[id].description}>{HOME_WIDGET_COPY[id].title}</h2>
                  {editing && (
                    <span className="home-widget-tools">
                      <span className="home-segment is-small" role="group" aria-label="Width">
                        {([1, 2, 3] as const).map((value) => (
                          <button
                            key={value}
                            type="button"
                            className={cn(span === value && 'is-on')}
                            onClick={() => setLayout(layout.map((item) => (item.id === id ? { ...item, span: value } : item)))}
                            aria-label={`${value} column${value === 1 ? '' : 's'} wide`}
                          >
                            {value === 1 ? 'S' : value === 2 ? 'M' : 'L'}
                          </button>
                        ))}
                      </span>
                      <button type="button" className="home-icon-button" aria-label={`Hide ${HOME_WIDGET_COPY[id].title}`} onClick={() => setLayout(layout.filter((item) => item.id !== id))}>
                        <X className="h-3.5 w-3.5" aria-hidden />
                      </button>
                    </span>
                  )}
                </header>
                <div className="home-widget-body">{renderWidget(id)}</div>
              </article>
            )
          })}
        </div>
        {layout.length === 0 && (
          <p className="home-empty">All widgets are hidden. Use Customize to add them back.</p>
        )}
      </div>
    </div>
  )
}
