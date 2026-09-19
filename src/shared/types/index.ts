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
  | 'timer'
  | 'browser'
  | 'mobile-preview'
  | 'ios-preview'
  | 'android-preview'

export interface PanelDefinition {
  id: string
  type: PanelType
  title: string
  zone: PanelZone
  launchMode?: 'normal' | 'login'
  accountId?: string
  /** Optional model selected for this CLI panel only. */
  cliModel?: string
  /** Isolated git worktree for this agent on a local `bikorch/<kind>-<id>` branch. */
  worktreePath?: string
  /** Configured isolation. Isolated is the default. Shared uses the main project tree. */
  workspaceIsolation?: 'isolated' | 'shared'
  /** Resolver sessions run in the integration worktree instead of an agent worktree. */
  panelRole?: 'agent' | 'resolver'
  cwdOverride?: string
  agentRunId?: string
}

export type PanelZone = 'left' | 'center' | 'right' | 'bottom'

export type LeftSidebarView =
  | 'files'
  | 'changes'
  | 'accounts'
  | 'tasks'
  | 'profile'
  | 'automation'
  | 'music'
  | 'timer'

export const LEFT_SIDEBAR_VIEWS: readonly LeftSidebarView[] = [
  'files',
  'changes',
  'accounts',
  'tasks',
  'profile',
  'automation',
  'music',
  'timer'
] as const

/** Wide sidebar views render a full-width panel instead of the narrow file/changes rail. */
export const WIDE_LEFT_SIDEBAR_VIEWS: readonly LeftSidebarView[] = ['accounts', 'profile', 'automation']

export function isLeftSidebarView(value: unknown): value is LeftSidebarView {
  return typeof value === 'string' && (LEFT_SIDEBAR_VIEWS as readonly string[]).includes(value)
}

export function isFloatingWidget(type: PanelType | undefined): boolean {
  return type === 'player' || type === 'timer'
}

export function isCanvasDevicePanel(type: PanelType | undefined): type is 'ios-preview' | 'android-preview' {
  return type === 'ios-preview' || type === 'android-preview'
}

export function floatsOnCanvas(type: PanelType | undefined): boolean {
  return isFloatingWidget(type) || isCanvasDevicePanel(type)
}

export function isMobilePreviewPanel(type: PanelType | undefined): type is 'mobile-preview' | 'ios-preview' | 'android-preview' {
  return type === 'mobile-preview' || type === 'ios-preview' || type === 'android-preview'
}

export function isWebChatPanel(type: PanelType | undefined): type is 'chatgpt' | 'claude-chat' {
  return type === 'chatgpt' || type === 'claude-chat'
}

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

/** Free-form floating windows vs tiled presets. */
export type WorkspaceCanvasMode =
  | 'free'
  | 'tiled'
  | 'grid-2x2'
  | 'cols-2'
  | 'cols-3'
  | 'cols-4'
  | 'rows-2'
  | 'rows-3'
  | 'rows-4'

export const WORKSPACE_CANVAS_MODES: readonly WorkspaceCanvasMode[] = [
  'free',
  'tiled',
  'grid-2x2',
  'cols-2',
  'cols-3',
  'cols-4',
  'rows-2',
  'rows-3',
  'rows-4'
] as const

export function parseCanvasMode(value: unknown): WorkspaceCanvasMode {
  if (typeof value === 'string' && (WORKSPACE_CANVAS_MODES as readonly string[]).includes(value)) {
    return value as WorkspaceCanvasMode
  }
  return 'free'
}

export const WORKSPACE_CANVAS_MODE_LABELS: Record<WorkspaceCanvasMode, string> = {
  free: 'Free',
  tiled: 'Auto',
  'grid-2x2': '2×2',
  'cols-2': '2',
  'cols-3': '3',
  'cols-4': '4',
  'rows-2': '2',
  'rows-3': '3',
  'rows-4': '4'
}

export const WORKSPACE_CANVAS_MODE_TITLES: Record<WorkspaceCanvasMode, string> = {
  free: 'Freeform windows',
  tiled: 'Auto tile',
  'grid-2x2': 'Quadrants',
  'cols-2': 'Two columns',
  'cols-3': 'Three columns',
  'cols-4': 'Four columns',
  'rows-2': 'Two rows',
  'rows-3': 'Three rows',
  'rows-4': 'Four rows'
}

export const WORKSPACE_CANVAS_LAYOUT_GROUPS: ReadonlyArray<{
  label: string
  modes: WorkspaceCanvasMode[]
}> = [
  { label: 'Canvas', modes: ['free', 'tiled'] },
  { label: 'Grid', modes: ['grid-2x2'] },
  { label: 'Columns', modes: ['cols-2', 'cols-3', 'cols-4'] },
  { label: 'Rows', modes: ['rows-2', 'rows-3', 'rows-4'] }
]

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
  leftSidebarView?: LeftSidebarView
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
  player: 'Player',
  timer: 'Timer',
  browser: 'Browser',
  'mobile-preview': 'Mobile Preview',
  'ios-preview': 'iOS Preview',
  'android-preview': 'Android Preview'
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

/** Usable on-screen floor. Large canvases convert these to a smaller %. */
export const ORCHESTRATOR_MIN_PX = { w: 240, h: 140 } as const
export const PLAYER_MIN_PX = { w: 200, h: 160 } as const
export const TIMER_MIN_PX = { w: 168, h: 120 } as const
export const DEVICE_MIN_PX = { w: 168, h: 320 } as const

/** Used when the canvas size is unknown (persist / add without a measured layout). */
const ORCH_MIN_W = 10
const ORCH_MIN_H = 12
const PLAYER_MIN_W = 10
const PLAYER_MIN_H = 12
const TIMER_MIN_W = 8
const TIMER_MIN_H = 10
const DEVICE_MIN_W = 8
const DEVICE_MIN_H = 16

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

export const DEFAULT_TIMER_RECT: OrchestratorRect = {
  x: 68,
  y: 8,
  w: 28,
  h: 28
}

export const DEFAULT_DEVICE_RECT: OrchestratorRect = {
  x: 10,
  y: 8,
  w: 22,
  h: 78
}

export const DEFAULT_CHAT_RIGHT_SIZE = 22

export const DEFAULT_CHAT_RECT: OrchestratorRect = {
  x: 72,
  y: 6,
  w: 26,
  h: 88
}

export function isFullBleedOrchestratorRect(rect: OrchestratorRect): boolean {
  return rect.x <= 2 && rect.y <= 2 && rect.w >= 94 && rect.h >= 90
}

export function minPercentFromPixels(
  minPx: number,
  canvasPx: number,
  fallbackPercent: number
): number {
  if (!Number.isFinite(fallbackPercent)) return 10
  if (!Number.isFinite(canvasPx) || canvasPx <= 0) return fallbackPercent
  const percent = (minPx / canvasPx) * 100
  if (!Number.isFinite(percent)) return fallbackPercent
  return Math.min(80, Math.max(2, percent))
}

export type OrchestratorLimitKind = 'panel' | 'player' | 'timer' | 'device'

export function limitKindForPanel(type: PanelType | undefined): OrchestratorLimitKind {
  if (type === 'player') return 'player'
  if (type === 'timer') return 'timer'
  if (isCanvasDevicePanel(type)) return 'device'
  return 'panel'
}

export function orchestratorMinLimits(
  kind: OrchestratorLimitKind = 'panel',
  canvas?: { w: number; h: number } | null
): { minW: number; minH: number } {
  if (kind === 'timer') {
    return {
      minW: minPercentFromPixels(TIMER_MIN_PX.w, canvas?.w ?? 0, TIMER_MIN_W),
      minH: minPercentFromPixels(TIMER_MIN_PX.h, canvas?.h ?? 0, TIMER_MIN_H)
    }
  }
  if (kind === 'player') {
    return {
      minW: minPercentFromPixels(PLAYER_MIN_PX.w, canvas?.w ?? 0, PLAYER_MIN_W),
      minH: minPercentFromPixels(PLAYER_MIN_PX.h, canvas?.h ?? 0, PLAYER_MIN_H)
    }
  }
  if (kind === 'device') {
    return {
      minW: minPercentFromPixels(DEVICE_MIN_PX.w, canvas?.w ?? 0, DEVICE_MIN_W),
      minH: minPercentFromPixels(DEVICE_MIN_PX.h, canvas?.h ?? 0, DEVICE_MIN_H)
    }
  }
  return {
    minW: minPercentFromPixels(ORCHESTRATOR_MIN_PX.w, canvas?.w ?? 0, ORCH_MIN_W),
    minH: minPercentFromPixels(ORCHESTRATOR_MIN_PX.h, canvas?.h ?? 0, ORCH_MIN_H)
  }
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

export function placeTimerRect(): OrchestratorRect {
  return clampOrchestratorRect({ ...DEFAULT_TIMER_RECT }, { minW: TIMER_MIN_W, minH: TIMER_MIN_H })
}

export function placeChatRect(): OrchestratorRect {
  return clampOrchestratorRect({ ...DEFAULT_CHAT_RECT })
}

export function placeDeviceRect(type?: PanelType): OrchestratorRect {
  const rect = { ...DEFAULT_DEVICE_RECT }
  if (type === 'android-preview') rect.x = 36
  return clampOrchestratorRect(rect, { minW: DEVICE_MIN_W, minH: DEVICE_MIN_H })
}

export function floatingWidgetRect(type: PanelType): OrchestratorRect {
  if (type === 'timer') return placeTimerRect()
  if (isCanvasDevicePanel(type)) return placeDeviceRect(type)
  return placePlayerRect()
}

export function floatingWidgetLimits(
  type: PanelType | undefined,
  canvas?: { w: number; h: number } | null
): { minW: number; minH: number } | undefined {
  if (!floatsOnCanvas(type)) return undefined
  return orchestratorMinLimits(limitKindForPanel(type), canvas)
}

export function panelMinLimits(
  type: PanelType | undefined,
  canvas?: { w: number; h: number } | null
): { minW: number; minH: number } {
  return orchestratorMinLimits(limitKindForPanel(type), canvas)
}

/** Minimum gap between free-form panels (percent of canvas). */
const ORCH_GAP = 1.5

const NEXT_PANEL_SIZES: ReadonlyArray<{ w: number; h: number }> = [
  { w: 48, h: 56 },
  { w: 42, h: 50 },
  { w: 36, h: 44 },
  { w: 30, h: 38 },
  { w: 26, h: 32 },
  { w: ORCH_MIN_W, h: ORCH_MIN_H }
]

export function orchestratorRectsOverlap(
  a: OrchestratorRect,
  b: OrchestratorRect,
  gap = ORCH_GAP
): boolean {
  return !(
    a.x + a.w + gap <= b.x ||
    b.x + b.w + gap <= a.x ||
    a.y + a.h + gap <= b.y ||
    b.y + b.h + gap <= a.y
  )
}

function rectFitsFree(
  candidate: OrchestratorRect,
  existingRects: OrchestratorRect[],
  size: { w: number; h: number }
): boolean {
  if (candidate.w + 0.05 < size.w || candidate.h + 0.05 < size.h) return false
  return existingRects.every((rect) => !orchestratorRectsOverlap(candidate, rect))
}

function candidateOrigins(
  existingRects: OrchestratorRect[],
  size: { w: number; h: number }
): Array<{ x: number; y: number }> {
  const origins: Array<{ x: number; y: number }> = [{ x: 2, y: 2 }]

  for (const rect of existingRects) {
    origins.push(
      { x: rect.x + rect.w + ORCH_GAP, y: rect.y },
      { x: rect.x, y: rect.y + rect.h + ORCH_GAP },
      { x: Math.max(0, rect.x - size.w - ORCH_GAP), y: rect.y },
      { x: rect.x, y: Math.max(0, rect.y - size.h - ORCH_GAP) },
      { x: rect.x + rect.w + ORCH_GAP, y: rect.y + rect.h + ORCH_GAP }
    )
  }

  const step = 4
  for (let y = 2; y <= 100 - size.h; y += step) {
    for (let x = 2; x <= 100 - size.w; x += step) {
      origins.push({ x, y })
    }
  }

  return origins
}

function findNonOverlappingRect(
  existingRects: OrchestratorRect[],
  size: { w: number; h: number }
): OrchestratorRect | null {
  for (const origin of candidateOrigins(existingRects, size)) {
    const candidate = clampOrchestratorRect(
      { x: origin.x, y: origin.y, w: size.w, h: size.h },
      { minW: ORCH_MIN_W, minH: ORCH_MIN_H }
    )
    if (rectFitsFree(candidate, existingRects, size)) return candidate
  }
  return null
}

function splitFirstBeside(
  first: OrchestratorRect
): { next: OrchestratorRect; shrinkFirst: OrchestratorRect } | null {
  const usable = first.w - ORCH_GAP
  if (usable < ORCH_MIN_W * 2) return null

  const leftW = Math.max(ORCH_MIN_W, usable * 0.5)
  const rightW = Math.max(ORCH_MIN_W, usable - leftW)
  const shrinkFirst = clampOrchestratorRect(
    { x: first.x, y: first.y, w: leftW, h: first.h },
    { minW: ORCH_MIN_W, minH: ORCH_MIN_H }
  )
  const next = clampOrchestratorRect(
    {
      x: shrinkFirst.x + shrinkFirst.w + ORCH_GAP,
      y: first.y,
      w: rightW,
      h: first.h
    },
    { minW: ORCH_MIN_W, minH: ORCH_MIN_H }
  )

  if (orchestratorRectsOverlap(shrinkFirst, next)) return null
  if (next.x + next.w > 100.05) return null
  return { next, shrinkFirst }
}

/** Place the next free-form panel without stacking on existing ones. */
export function allocateOrchestratorRect(
  existingRects: OrchestratorRect[]
): { next: OrchestratorRect; shrinkFirst?: OrchestratorRect } {
  if (existingRects.length === 0) {
    return { next: { ...DEFAULT_ORCHESTRATOR_RECT } }
  }

  // Prefer a usable panel size; avoid parking a tiny window when a split works.
  for (const size of NEXT_PANEL_SIZES.slice(0, -1)) {
    const found = findNonOverlappingRect(existingRects, size)
    if (found) return { next: found }
  }

  if (existingRects.length === 1) {
    const split = splitFirstBeside(existingRects[0])
    if (split) return split
  }

  const compact = findNonOverlappingRect(existingRects, {
    w: ORCH_MIN_W,
    h: ORCH_MIN_H
  })
  if (compact) return { next: compact }

  // Canvas is packed: park a minimum panel in the far corner instead of
  // cascading over the previous window.
  return {
    next: clampOrchestratorRect(
      { x: 100 - ORCH_MIN_W, y: 100 - ORCH_MIN_H, w: ORCH_MIN_W, h: ORCH_MIN_H },
      { minW: ORCH_MIN_W, minH: ORCH_MIN_H }
    )
  }
}

export function layoutAfterAddCenterPanel(
  existingIds: string[],
  existingRects: Record<string, OrchestratorRect>,
  newId: string
): Record<string, OrchestratorRect> {
  const placedIds = existingIds.filter((id) => Boolean(existingRects[id]))
  const rects = placedIds.map((id) => existingRects[id])
  const { next, shrinkFirst } = allocateOrchestratorRect(rects)

  const result = { ...existingRects, [newId]: next }
  if (shrinkFirst && placedIds[0]) {
    result[placedIds[0]] = shrinkFirst
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
