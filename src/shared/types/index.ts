export type PanelType =
  | 'terminal'
  | 'claude'
  | 'cursor'
  | 'gemini'
  | 'antigravity'
  | 'codex'
  | 'chatgpt'
  | 'claude-chat'
  | 'file-explorer'
  | 'git-changes'
  | 'diff'
  | 'logs'
  | 'tasks'
  | 'player'

export interface PanelDefinition {
  id: string
  type: PanelType
  title: string
  zone: PanelZone
  launchMode?: 'normal' | 'login'
  accountId?: string
  /** Isolated git worktree for this agent on a local `bikorch/<kind>-<id>` branch. */
  worktreePath?: string
  /** Isolated (own worktree) is the default. Shared uses the main project tree. */
  workspaceIsolation?: 'isolated' | 'shared'
}

export type PanelZone = 'left' | 'center' | 'right' | 'bottom'

export interface Project {
  id: string
  name: string
  folderPath: string | null
}

export type OrchestratorDirection = 'horizontal' | 'vertical'

export interface OrchestratorRect {
  x: number
  y: number
  w: number
  h: number
}

/** Free-form floating windows vs equal-cell tiled workspace. */
export type WorkspaceCanvasMode = 'free' | 'tiled'

/** Vertical = left | right. Horizontal = top / bottom. */
export type GridSplitDirection = 'vertical' | 'horizontal'

export type TiledSplitSide = 'left' | 'right' | 'up' | 'down'

export interface WorkspaceGridLeaf {
  type: 'leaf'
  panelId: string
}

export interface WorkspaceGridSplit {
  type: 'split'
  direction: GridSplitDirection
  sizes: [number, number]
  children: [WorkspaceGridNode, WorkspaceGridNode]
}

export type WorkspaceGridNode = WorkspaceGridLeaf | WorkspaceGridSplit

export interface WorkspaceLayout {
  leftSize: number
  centerSize: number
  rightSize: number
  bottomSize: number
  mainVerticalSize: number
  leftCollapsed?: boolean
  leftSidebarView?: 'files' | 'changes' | 'accounts' | 'tasks' | 'profile' | 'music'
  orchestratorDirection?: OrchestratorDirection
  centerPanelSizes?: Record<string, number>
  /** Free-form terminal windows in the center canvas, percentages 0–100 */
  centerPanelRects?: Record<string, OrchestratorRect>
  /** Independent tiled workspace. Free-form rects are kept when this is on. */
  canvasMode?: WorkspaceCanvasMode
  centerGrid?: WorkspaceGridNode | null
}

export interface ProjectWorkspaceState {
  projectId: string
  panels: PanelDefinition[]
  layout: WorkspaceLayout
}

export interface CliSession {
  id: string
  projectId: string
  type: string
  title: string
  cwd: string
  status: 'starting' | 'running' | 'waiting' | 'busy' | 'stopped' | 'error'
}

export const PANEL_TYPE_LABELS: Record<PanelType, string> = {
  terminal: 'Generic Terminal',
  claude: 'Claude Code',
  cursor: 'Cursor CLI',
  gemini: 'Gemini CLI',
  antigravity: 'Antigravity CLI',
  codex: 'Codex CLI',
  chatgpt: 'ChatGPT',
  'claude-chat': 'Claude Chat',
  'file-explorer': 'File Explorer',
  'git-changes': 'Git Changes',
  diff: 'Code Review',
  logs: 'Logs',
  tasks: 'Tasks',
  player: 'Player'
}

export const DEFAULT_LAYOUT: WorkspaceLayout = {
  leftSize: 14,
  centerSize: 86,
  rightSize: 0,
  bottomSize: 0,
  mainVerticalSize: 100,
  leftCollapsed: false,
  leftSidebarView: 'files',
  canvasMode: 'free',
  centerGrid: null
}

export const WORKSPACE_SCALE_DEFAULT = 100
export const WORKSPACE_SCALE_MIN = 50
export const WORKSPACE_SCALE_MAX = 200
export const WORKSPACE_SCALE_STEP = 10

export function clampWorkspaceScale(value: number): number {
  if (!Number.isFinite(value)) return WORKSPACE_SCALE_DEFAULT
  const snapped = Math.round(value / WORKSPACE_SCALE_STEP) * WORKSPACE_SCALE_STEP
  return Math.min(WORKSPACE_SCALE_MAX, Math.max(WORKSPACE_SCALE_MIN, snapped))
}

const DEFAULT_BOTTOM_PANEL_SIZE = 28
const DEFAULT_MAIN_VERTICAL_SIZE = 72

export function createDefaultPanels(): PanelDefinition[] {
  return [
    { id: 'file-explorer-default', type: 'file-explorer', title: 'Files', zone: 'left' }
  ]
}

const LEGACY_PANEL_IDS = new Set(['git-changes-default', 'terminal-default'])
/** Strip legacy default panels and ensure the Files sidebar exists. */
export function sanitizeWorkspacePanels(panels: PanelDefinition[]): PanelDefinition[] {
  // Tasks are owned by the left sidebar. Remove stale workspace definitions
  // from older layouts without touching the persisted task records.
  const filtered = panels.filter(
    (panel) => !LEGACY_PANEL_IDS.has(panel.id) && panel.type !== 'tasks'
  )
  const hasFileExplorer = filtered.some((p) => p.type === 'file-explorer' && p.zone === 'left')
  if (!hasFileExplorer) return createDefaultPanels()
  return filtered.map((panel) => {
    if (panel.type !== 'diff') return panel
    if (
      panel.title === 'Diff Viewer' ||
      panel.title.startsWith('Diff Viewer ') ||
      panel.title === 'Diff' ||
      panel.title.startsWith('Diff ')
    ) {
      return {
        ...panel,
        title: panel.title.replace(/^Diff Viewer/, 'Code Review').replace(/^Diff/, 'Code Review')
      }
    }
    return panel.title === 'Code Review' || panel.title.startsWith('Code Review')
      ? panel
      : { ...panel, title: 'Code Review' }
  })
}

export function rebalanceCenterPanelSizes(panelIds: string[]): Record<string, number> {
  if (panelIds.length === 0) return {}
  const equal = 100 / panelIds.length
  const sizes: Record<string, number> = {}
  let assigned = 0

  for (let i = 0; i < panelIds.length; i++) {
    const id = panelIds[i]
    if (i === panelIds.length - 1) {
      sizes[id] = 100 - assigned
    } else {
      sizes[id] = equal
      assigned += equal
    }
  }

  return sizes
}

const ORCH_MIN_W = 22
const ORCH_MIN_H = 24
const PLAYER_MIN_W = 22
const PLAYER_MIN_H = 22

/** First terminal sits inset on the notebook grid (12×10 cells). */
export const DEFAULT_ORCHESTRATOR_RECT: OrchestratorRect = {
  x: 8.333,
  y: 10,
  w: 66.667,
  h: 70
}

export const DEFAULT_PLAYER_RECT: OrchestratorRect = {
  x: 66,
  y: 58,
  w: 32,
  h: 34
}

export function isFullBleedOrchestratorRect(rect: OrchestratorRect): boolean {
  return rect.x <= 2 && rect.y <= 2 && rect.w >= 94 && rect.h >= 90
}

export function clampOrchestratorRect(
  rect: OrchestratorRect,
  limits?: { minW?: number; minH?: number }
): OrchestratorRect {
  const minW = limits?.minW ?? ORCH_MIN_W
  const minH = limits?.minH ?? ORCH_MIN_H
  const w = Math.min(100, Math.max(minW, rect.w))
  const h = Math.min(100, Math.max(minH, rect.h))
  const x = Math.min(100 - w, Math.max(0, rect.x))
  const y = Math.min(100 - h, Math.max(0, rect.y))
  return { x, y, w, h }
}

export function placePlayerRect(): OrchestratorRect {
  return clampOrchestratorRect({ ...DEFAULT_PLAYER_RECT }, { minW: PLAYER_MIN_W, minH: PLAYER_MIN_H })
}

export function allocateOrchestratorRect(
  existingRects: OrchestratorRect[]
): { next: OrchestratorRect; shrinkFirst?: OrchestratorRect } {
  if (existingRects.length === 0) {
    return { next: { ...DEFAULT_ORCHESTRATOR_RECT } }
  }

  const first = existingRects[0]
  if (existingRects.length === 1) {
    const rightEdge = first.x + first.w
    const spaceOnRight = 100 - rightEdge
    if (spaceOnRight >= 26) {
      return {
        next: clampOrchestratorRect({
          x: rightEdge + 2,
          y: first.y,
          w: Math.max(24, spaceOnRight - 2),
          h: first.h
        })
      }
    }
    return {
      next: clampOrchestratorRect({
        x: 12,
        y: 14,
        w: 48,
        h: 56
      })
    }
  }

  const n = existingRects.length
  return {
    next: clampOrchestratorRect({
      x: 8 + ((n * 5) % 28),
      y: 10 + ((n * 6) % 24),
      w: 46,
      h: 54
    })
  }
}

export function layoutAfterAddCenterPanel(
  existingIds: string[],
  existingRects: Record<string, OrchestratorRect>,
  newId: string
): Record<string, OrchestratorRect> {
  const rects = existingIds
    .map((id) => existingRects[id])
    .filter((rect): rect is OrchestratorRect => Boolean(rect))
  const { next, shrinkFirst } = allocateOrchestratorRect(rects)

  const result = { ...existingRects, [newId]: next }
  if (shrinkFirst && existingIds[0]) {
    result[existingIds[0]] = shrinkFirst
  }
  return result
}

/** Ensure bottom split sizes when a bottom panel exists. */
export function normalizeLayoutForPanels(
  layout: WorkspaceLayout,
  panels: PanelDefinition[]
): WorkspaceLayout {
  const hasBottom = panels.some((p) => p.zone === 'bottom')
  if (!hasBottom) return layout
  if (layout.bottomSize > 0 && layout.mainVerticalSize > 0 && layout.mainVerticalSize < 100) {
    return layout
  }
  return {
    ...layout,
    bottomSize: layout.bottomSize > 0 ? layout.bottomSize : DEFAULT_BOTTOM_PANEL_SIZE,
    mainVerticalSize:
      layout.mainVerticalSize > 0 && layout.mainVerticalSize < 100
        ? layout.mainVerticalSize
        : DEFAULT_MAIN_VERTICAL_SIZE
  }
}
