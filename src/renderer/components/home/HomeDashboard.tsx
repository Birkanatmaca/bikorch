import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity,
  CalendarDays,
  Cpu,
  FolderKanban,
  GitBranch,
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
  HOME_GRID,
  HOME_WIDGETS,
  HOME_WIDGET_COPY,
  clampHomeRect,
  findHomeSpot,
  parseHomeLayout,
  type ClaudeActivity,
  type GitActivity,
  type HomeWidgetId,
  type HomeWidgetRect
} from '@shared/contracts/dashboard'
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

const LAYOUT_KEY = 'bikorch.home.canvas'

const WIDGET_ICON: Record<HomeWidgetId, LucideIcon> = {
  today: CalendarDays,
  claude: Sparkles,
  sessions: TerminalSquare,
  system: Cpu,
  servers: Server,
  tokens: Activity,
  git: GitBranch,
  projects: FolderKanban
}

const WIDGET_TONE: Record<HomeWidgetId, string> = {
  today: 'tone-violet',
  claude: 'tone-coral',
  sessions: 'tone-green',
  system: 'tone-teal',
  servers: 'tone-sky',
  tokens: 'tone-violet',
  git: 'tone-green',
  projects: 'tone-amber'
}

/** Default size when a hidden widget is added back. */
const ADD_SIZE: Record<HomeWidgetId, { w: number; h: number }> = {
  today: { w: 12, h: 2 },
  claude: { w: 3, h: 5 },
  sessions: { w: 6, h: 3 },
  system: { w: 3, h: 6 },
  servers: { w: 3, h: 4 },
  tokens: { w: 6, h: 4 },
  git: { w: 6, h: 3 },
  projects: { w: 3, h: 4 }
}

function readLayout(): HomeWidgetRect[] {
  try {
    const raw = window.localStorage.getItem(LAYOUT_KEY)
    return raw ? parseHomeLayout(JSON.parse(raw)) : DEFAULT_HOME_LAYOUT
  } catch {
    return DEFAULT_HOME_LAYOUT
  }
}

function writeLayout(layout: HomeWidgetRect[]): void {
  try {
    window.localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout))
  } catch {
    // The canvas still works; the arrangement just is not remembered.
  }
}

function TodayWidget({ activity, git }: { activity: ClaudeActivity | null; git: GitActivity | null }): React.JSX.Element {
  const sessions = useTerminalStore((state) => state.sessions)
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
  return (
    <div className="home-today">
      <div className="home-stat tone-violet"><small>Prompts today</small><strong>{today?.prompts ?? 0}</strong></div>
      <div className="home-stat tone-coral"><small>Output tokens today</small><strong>{compactNumber(today?.outputTokens ?? 0)}</strong></div>
      <div className="home-stat tone-green"><small>Commits this week</small><strong>{weekCommits}</strong></div>
      <div className="home-stat tone-amber"><small>Prompt streak</small><strong>{promptStreak}<em>days</em></strong></div>
      <div className="home-stat tone-teal"><small>Working now</small><strong>{working}<em>sessions</em></strong></div>
    </div>
  )
}

/** Below this, a 12×12 canvas gets too cramped to read; widgets stack and scroll. */
const CANVAS_MIN = { width: 980, height: 560 }

type Layout = 'canvas' | 'stack'

type Gesture = { id: HomeWidgetId; kind: 'move' | 'resize'; startX: number; startY: number; origin: HomeWidgetRect }

/**
 * Home is a one-screen canvas of widgets on a 12×12 grid. Drag a widget by its
 * header, resize it from the corner, hide it with ×; the arrangement is saved.
 */
export function HomeDashboard(): React.JSX.Element {
  const [layout, setLayoutState] = useState<HomeWidgetRect[]>(readLayout)
  const [gesture, setGesture] = useState<Gesture | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const canvasRef = useRef<HTMLDivElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const [mode, setMode] = useState<Layout>('canvas')

  useEffect(() => {
    const node = rootRef.current
    if (!node) return
    const measure = (): void => {
      const { width, height } = node.getBoundingClientRect()
      setMode(width >= CANVAS_MIN.width && height >= CANVAS_MIN.height ? 'canvas' : 'stack')
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])
  const activity = useClaudeActivity()
  const git = useGitActivity()

  const setLayout = (next: HomeWidgetRect[]): void => {
    setLayoutState(next)
    writeLayout(next)
  }

  // Pointer moves update the layout live; the result is saved on release.
  useEffect(() => {
    if (!gesture) return
    const onMove = (event: PointerEvent): void => {
      const box = canvasRef.current?.getBoundingClientRect()
      if (!box) return
      const dx = Math.round((event.clientX - gesture.startX) / (box.width / HOME_GRID.columns))
      const dy = Math.round((event.clientY - gesture.startY) / (box.height / HOME_GRID.rows))
      const { origin } = gesture
      const next = gesture.kind === 'move'
        ? clampHomeRect({ ...origin, x: origin.x + dx, y: origin.y + dy })
        : clampHomeRect({
          ...origin,
          w: Math.min(HOME_GRID.columns - origin.x, origin.w + dx),
          h: Math.min(HOME_GRID.rows - origin.y, origin.h + dy)
        })
      setLayoutState((current) => current.map((rect) => (rect.id === gesture.id ? next : rect)))
    }
    const onUp = (): void => {
      setGesture(null)
      setLayoutState((current) => {
        writeLayout(current)
        return current
      })
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [gesture])

  const begin = (event: React.PointerEvent, id: HomeWidgetId, kind: Gesture['kind']): void => {
    if (event.button !== 0) return
    if (kind === 'move' && (event.target as HTMLElement).closest('button, input, select, a')) return
    event.preventDefault()
    const origin = layout.find((rect) => rect.id === id)
    if (!origin) return
    // The touched widget comes to the front.
    setLayoutState([...layout.filter((rect) => rect.id !== id), origin])
    setGesture({ id, kind, startX: event.clientX, startY: event.clientY, origin })
  }

  const hidden = HOME_WIDGETS.filter((id) => !layout.some((rect) => rect.id === id))

  const renderWidget = (id: HomeWidgetId): React.JSX.Element => {
    switch (id) {
      case 'today': return <TodayWidget activity={activity} git={git} />
      case 'claude': return <ClaudeLimitsWidget />
      case 'sessions': return <SessionsWidget />
      case 'system': return <SystemWidget />
      case 'servers': return <ServersWidget />
      case 'tokens': return <TokensWidget activity={activity} />
      case 'git': return <GitWidget git={git} activity={activity} />
      case 'projects': return <ProjectsWidget />
    }
  }

  const renderCard = (rect: HomeWidgetRect, onCanvas: boolean): React.JSX.Element => {
    const Icon = WIDGET_ICON[rect.id]
    const active = gesture?.id === rect.id
    return (
      <article
        key={rect.id}
        className={cn('home-widget', WIDGET_TONE[rect.id], active && 'is-active', onCanvas ? 'is-placed' : `is-stacked stack-${rect.id}`)}
        style={onCanvas ? {
          left: `${(rect.x / HOME_GRID.columns) * 100}%`,
          top: `${(rect.y / HOME_GRID.rows) * 100}%`,
          width: `${(rect.w / HOME_GRID.columns) * 100}%`,
          height: `${(rect.h / HOME_GRID.rows) * 100}%`
        } : undefined}
      >
        <div className="home-widget-card">
          <header
            className="home-widget-head"
            onPointerDown={onCanvas ? (event) => begin(event, rect.id, 'move') : undefined}
            title={onCanvas ? 'Drag to move' : undefined}
          >
            <span className="home-widget-icon"><Icon className="h-3.5 w-3.5" aria-hidden /></span>
            <h2 title={HOME_WIDGET_COPY[rect.id].description}>{HOME_WIDGET_COPY[rect.id].title}</h2>
            <button
              type="button"
              className="home-icon-button home-widget-hide"
              aria-label={`Hide ${HOME_WIDGET_COPY[rect.id].title}`}
              title="Hide"
              onClick={() => setLayout(layout.filter((item) => item.id !== rect.id))}
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          </header>
          <div className="home-widget-body">{renderWidget(rect.id)}</div>
          {onCanvas && (
            <span className="home-resize" onPointerDown={(event) => begin(event, rect.id, 'resize')} title="Drag to resize" aria-hidden />
          )}
        </div>
      </article>
    )
  }

  // Stacked order follows the canvas: top to bottom, then left to right.
  const stacked = [...layout].sort((a, b) => a.y - b.y || a.x - b.x)

  return (
    <div ref={rootRef} className={cn('home-dashboard', gesture && 'is-arranging', `is-${mode}`)}>
      <div className="home-aurora" aria-hidden />
      {mode === 'stack' && (
        <div className="home-stack">{stacked.map((rect) => renderCard(rect, false))}</div>
      )}
      <div ref={canvasRef} className="home-canvas" hidden={mode !== 'canvas'}>
        {gesture && <div className="home-canvas-grid" aria-hidden />}
        {mode === 'canvas' && layout.map((rect) => renderCard(rect, true))}
        {layout.length === 0 && <p className="home-empty home-canvas-empty">Every widget is hidden. Add them back with the + button.</p>}
      </div>

      <div className="home-dock">
        {addOpen && hidden.length > 0 && (
          <div className="home-dock-menu" role="menu">
            {hidden.map((id) => {
              const Icon = WIDGET_ICON[id]
              return (
                <button
                  key={id}
                  type="button"
                  role="menuitem"
                  className="home-add-chip"
                  onClick={() => {
                    const size = ADD_SIZE[id]
                    const spot = findHomeSpot(layout, size.w, size.h)
                    setLayout([...layout, clampHomeRect({ id, ...size, ...spot })])
                    if (hidden.length === 1) setAddOpen(false)
                  }}
                >
                  <Icon className="h-3 w-3" aria-hidden />
                  {HOME_WIDGET_COPY[id].title}
                </button>
              )
            })}
          </div>
        )}
        <button
          type="button"
          className={cn('home-dock-button', addOpen && 'is-on')}
          disabled={hidden.length === 0}
          onClick={() => setAddOpen(!addOpen)}
          title={hidden.length === 0 ? 'All widgets are on Home' : 'Add a widget'}
          aria-label="Add a widget"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden />
          {hidden.length > 0 && <span>{hidden.length}</span>}
        </button>
        <button
          type="button"
          className="home-dock-button"
          onClick={() => {
            setLayout(DEFAULT_HOME_LAYOUT)
            setAddOpen(false)
          }}
          title="Reset the layout"
          aria-label="Reset the layout"
        >
          <RotateCcw className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
    </div>
  )
}
