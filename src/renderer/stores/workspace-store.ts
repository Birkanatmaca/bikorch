import { create } from 'zustand'
import { v4 as uuidv4 } from 'uuid'
import {
  type PanelDefinition,
  type PanelType,
  type PanelZone,
  type Project,
  type ProjectWorkspaceState,
  type WorkspaceLayout,
  PANEL_TYPE_LABELS,
  DEFAULT_LAYOUT,
  createDefaultPanels,
  sanitizeWorkspacePanels,
  normalizeLayoutForPanels,
  layoutAfterAddCenterPanel,
  clampOrchestratorRect,
  isFloatingWidget,
  isWebChatPanel,
  floatingWidgetRect,
  floatingWidgetLimits,
  placeChatRect,
  DEFAULT_CHAT_RIGHT_SIZE,
  clampWorkspaceScale,
  type LeftSidebarView,
  WORKSPACE_SCALE_DEFAULT,
  WORKSPACE_SCALE_STEP,
  type OrchestratorRect,
  type TiledSplitSide,
  type WorkspaceCanvasMode,
  type WorkspaceGridNode
} from '@shared/types'
import {
  insertPanelInGrid,
  isTiledWorkspace,
  removePanelFromGrid,
  splitGridPanel,
  swapGridPanels,
  tiledCenterPanelIds,
  updateGridSizes,
  buildEqualGrid
} from '@shared/workspace-grid'
import { AI_ACCOUNT_KINDS } from '@shared/contracts/accounts'
import type { CliUsageKind } from '@shared/contracts/usage'
import type { WorkspaceIsolation } from '@shared/contracts/git'
import { useAiAccountsStore } from './ai-accounts-store'
import { endAgentSession, finalizeAgentSession, recordDeveloperEvent } from '@renderer/lib/developer-events'

const PTY_PANEL_TYPES = new Set<PanelType>([
  'terminal',
  'claude',
  'cursor',
  'gemini',
  'antigravity',
  'codex'
])

const AGENT_WORKTREE_TYPES = new Set<PanelType>([
  'claude',
  'cursor',
  'gemini',
  'antigravity',
  'codex'
])

function pruneCenterGrid(
  node: WorkspaceGridNode | null | undefined,
  removedIds: Set<string>
): WorkspaceGridNode | null {
  let next = node ?? null
  for (const id of removedIds) next = removePanelFromGrid(next, id)
  return next
}

function releasePanelIsolation(panel: PanelDefinition, projectRoot: string | null | undefined): void {
  if (PTY_PANEL_TYPES.has(panel.type) && typeof window !== 'undefined' && window.api?.pty) {
    void (async () => {
      if (AGENT_WORKTREE_TYPES.has(panel.type)) {
        await finalizeAgentSession(panel.id, null, 'closed')
      } else {
        endAgentSession(panel.id, null, 'closed')
      }
      await window.api.pty.kill({ sessionId: panel.id })
      if (
        panel.worktreePath &&
        projectRoot &&
        AGENT_WORKTREE_TYPES.has(panel.type) &&
        window.api.git?.removeWorktree
      ) {
        await window.api.git.removeWorktree({ projectRoot, worktreePath: panel.worktreePath })
      }
    })()
    return
  }
  endAgentSession(panel.id, null, 'closed')
}

function noteProjectOpened(project: Project): void {
  if (!project.folderPath) return
  recordDeveloperEvent({
    type: 'project.opened',
    projectId: project.id,
    payload: { name: project.name, folderPath: project.folderPath }
  })
}

interface WorkspaceSnapshot {
  projects: Project[]
  activeProjectId: string | null
  workspaces: Record<string, ProjectWorkspaceState>
}

const WORKSPACE_SCALE_STORAGE_KEY = 'bikorch.workspaceScale'

function readStoredWorkspaceScale(): number {
  if (typeof window === 'undefined') return WORKSPACE_SCALE_DEFAULT
  try {
    return clampWorkspaceScale(Number(window.localStorage.getItem(WORKSPACE_SCALE_STORAGE_KEY)))
  } catch {
    return WORKSPACE_SCALE_DEFAULT
  }
}

function persistWorkspaceScale(scale: number): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(WORKSPACE_SCALE_STORAGE_KEY, String(scale))
  } catch {
    // Ignore quota / private-mode failures.
  }
}

interface WorkspaceStore extends WorkspaceSnapshot {
  isHydrated: boolean

  hydrate: (snapshot: WorkspaceSnapshot) => void
  getSnapshot: () => WorkspaceSnapshot

  addProject: (name?: string, folderPath?: string | null) => string
  removeProject: (projectId: string) => void
  setActiveProject: (projectId: string) => void
  updateProject: (projectId: string, updates: Partial<Pick<Project, 'name' | 'folderPath'>>) => void
  reorderProjects: (fromIndex: number, toIndex: number) => void
  touchRecentProject: (projectId: string) => void
  ensureProjectWorkspace: (projectId: string, openSidebar?: boolean) => void

  getActiveWorkspace: () => ProjectWorkspaceState | null
  openPlayerPanel: () => string
  openTimerPanel: () => string
  addPanel: (
    type: PanelType,
    zone?: PanelZone,
    rect?: OrchestratorRect,
    launchMode?: 'normal' | 'login',
    accountId?: string,
    titleOverride?: string
  ) => string
  renamePanel: (panelId: string, title: string) => void
  removePanel: (panelId: string) => void
  removePanelsForAccount: (kind: CliUsageKind, accountId: string) => void
  closeOtherAccountCliPanels: (kind: CliUsageKind, keepAccountId: string) => void
  movePanel: (panelId: string, zone: PanelZone) => void
  updateLayout: (projectId: string, layout: Partial<WorkspaceLayout>) => void
  updateCenterPanelRect: (panelId: string, rect: OrchestratorRect) => void
  setCanvasMode: (mode: WorkspaceCanvasMode) => void
  swapTiledPanels: (firstId: string, secondId: string) => void
  splitTiledPanel: (panelId: string, side: TiledSplitSide) => string
  updateTiledSplitSizes: (path: number[], sizes: [number, number]) => void
  toggleSidebar: (projectId: string) => void
  selectLeftSidebar: (
    projectId: string,
    view: LeftSidebarView
  ) => void
  clearPanelLaunchMode: (panelId: string) => void
  setPanelWorktree: (panelId: string, worktreePath: string | null) => void
  setPanelIsolation: (panelId: string, isolation: WorkspaceIsolation) => void
  workspaceScale: number
  setWorkspaceScale: (scale: number) => void
  nudgeWorkspaceScale: (deltaSteps: number) => void
}

function createProject(name: string, folderPath: string | null = null): Project {
  return {
    id: uuidv4(),
    name,
    folderPath
  }
}

function createWorkspaceState(projectId: string): ProjectWorkspaceState {
  return {
    projectId,
    panels: createDefaultPanels(),
    layout: { ...DEFAULT_LAYOUT }
  }
}

export function createFallbackWorkspace(): WorkspaceSnapshot {
  return {
    projects: [],
    activeProjectId: null,
    workspaces: {}
  }
}

function getNextPanelTitle(type: PanelType, panels: PanelDefinition[]): string {
  const baseLabel = PANEL_TYPE_LABELS[type]
  const sameTypeCount = panels.filter((p) => p.type === type).length
  if (sameTypeCount === 0) return baseLabel
  return `${baseLabel} #${sameTypeCount + 1}`
}

function getDefaultZone(type: PanelType): PanelZone {
  switch (type) {
    case 'file-explorer':
      return 'left'
    case 'terminal':
    case 'claude':
    case 'cursor':
    case 'gemini':
    case 'antigravity':
    case 'codex':
    case 'git-changes':
    case 'player':
    case 'timer':
    case 'browser':
      return 'center'
    case 'chatgpt':
    case 'claude-chat':
      return 'right'
    case 'diff':
      return 'right'
    default:
      return 'center'
  }
}

export const useWorkspaceStore = create<WorkspaceStore>((set, get) => ({
  projects: [],
  activeProjectId: null,
  workspaces: {},
  isHydrated: false,
  workspaceScale: readStoredWorkspaceScale(),

  hydrate: (snapshot) => {
    const workspaces = Object.fromEntries(
      Object.entries(snapshot.workspaces).map(([projectId, workspace]) => {
        const panels = sanitizeWorkspacePanels(workspace.panels)
        return [
          projectId,
          {
            ...workspace,
            panels,
            layout: normalizeLayoutForPanels(workspace.layout, panels)
          }
        ]
      })
    )

    for (const project of snapshot.projects) {
      if (!workspaces[project.id]) {
        workspaces[project.id] = createWorkspaceState(project.id)
      }
    }

    set({
      projects: snapshot.projects,
      activeProjectId: snapshot.activeProjectId,
      workspaces,
      isHydrated: true
    })
  },

  getSnapshot: () => {
    const { projects, activeProjectId, workspaces } = get()
    return { projects, activeProjectId, workspaces }
  },

  addProject: (name, folderPath = null) => {
    const project = createProject(name ?? `Project ${get().projects.length + 1}`, folderPath)
    set((state) => ({
      projects: [...state.projects, project],
      activeProjectId: project.id,
      workspaces: {
        ...state.workspaces,
        [project.id]: createWorkspaceState(project.id)
      }
    }))
    noteProjectOpened(project)
    return project.id
  },

  removeProject: (projectId) => {
    const workspace = get().workspaces[projectId]
    const projectRoot = get().projects.find((project) => project.id === projectId)?.folderPath
    workspace?.panels.forEach((panel) => releasePanelIsolation(panel, projectRoot))

    set((state) => {
      const projects = state.projects.filter((p) => p.id !== projectId)
      const { [projectId]: _, ...workspaces } = state.workspaces
      const activeProjectId =
        state.activeProjectId === projectId ? projects[0]?.id ?? null : state.activeProjectId
      return { projects, workspaces, activeProjectId }
    })
  },

  setActiveProject: (projectId) => {
    set({ activeProjectId: projectId })
    get().ensureProjectWorkspace(projectId)
  },

  updateProject: (projectId, updates) => {
    const previous = get().projects.find((p) => p.id === projectId)
    set((state) => ({
      projects: state.projects.map((p) => (p.id === projectId ? { ...p, ...updates } : p))
    }))
    const next = get().projects.find((p) => p.id === projectId)
    if (next && updates.folderPath && updates.folderPath !== previous?.folderPath) {
      noteProjectOpened(next)
    }
  },

  reorderProjects: (fromIndex, toIndex) => {
    set((state) => {
      if (
        fromIndex === toIndex ||
        fromIndex < 0 ||
        toIndex < 0 ||
        fromIndex >= state.projects.length ||
        toIndex >= state.projects.length
      ) {
        return state
      }
      const projects = [...state.projects]
      const [moved] = projects.splice(fromIndex, 1)
      projects.splice(toIndex, 0, moved)
      return { projects }
    })
  },

  touchRecentProject: (projectId) => {
    set({ activeProjectId: projectId })
    get().ensureProjectWorkspace(projectId)
  },

  ensureProjectWorkspace: (projectId, openSidebar = false) => {
    set((state) => {
      const existing = state.workspaces[projectId]
      const base = existing ?? createWorkspaceState(projectId)
      const panels = sanitizeWorkspacePanels(base.panels)
      let layout = normalizeLayoutForPanels(base.layout, panels)
      if (openSidebar) {
        layout = { ...layout, leftCollapsed: false }
      }

      return {
        workspaces: {
          ...state.workspaces,
          [projectId]: {
            ...base,
            panels,
            layout
          }
        }
      }
    })
  },

  getActiveWorkspace: () => {
    const { activeProjectId, workspaces } = get()
    if (!activeProjectId) return null
    return workspaces[activeProjectId] ?? null
  },

  openPlayerPanel: () => {
    const { activeProjectId, workspaces } = get()
    if (!activeProjectId) return ''
    const workspace = workspaces[activeProjectId]
    if (!workspace) return ''
    const existing = workspace.panels.find((panel) => panel.type === 'player')
    if (existing) {
      window.dispatchEvent(new CustomEvent('bikorch:focus-panel', { detail: existing.id }))
      return existing.id
    }
    return get().addPanel('player', 'center')
  },

  openTimerPanel: () => {
    const { activeProjectId, workspaces } = get()
    if (!activeProjectId) return ''
    const workspace = workspaces[activeProjectId]
    if (!workspace) return ''
    const existing = workspace.panels.find((panel) => panel.type === 'timer')
    if (existing) {
      window.dispatchEvent(new CustomEvent('bikorch:focus-panel', { detail: existing.id }))
      return existing.id
    }
    return get().addPanel('timer', 'center')
  },

  addPanel: (type, zone, rect, launchMode, accountId, titleOverride) => {
    const { activeProjectId, workspaces } = get()
    if (!activeProjectId) return ''

    const workspace = workspaces[activeProjectId]
    if (!workspace) return ''

    if (type === 'tasks') {
      get().selectLeftSidebar(activeProjectId, 'tasks')
      return ''
    }

    if (isFloatingWidget(type)) {
      const existing = workspace.panels.find((panel) => panel.type === type)
      if (existing) {
        window.dispatchEvent(new CustomEvent('bikorch:focus-panel', { detail: existing.id }))
        return existing.id
      }
    }

    const targetZone = zone ?? getDefaultZone(type)
    const hadRight = workspace.panels.some((p) => p.zone === 'right')
    const accountKind = AI_ACCOUNT_KINDS.includes(type as CliUsageKind)
      ? (type as CliUsageKind)
      : null
    const accountsState = useAiAccountsStore.getState()
    const activeAccountId = accountKind
      ? accountsState.activeAccountByKind[accountKind]
      : null
    const defaultAccountId = accountKind
      ? accountsState.accounts.find(
          (account) =>
            account.id === activeAccountId &&
            account.kind === accountKind &&
            account.profileReady
        )?.id ??
        accountsState.accounts.find(
          (account) => account.kind === accountKind && account.profileReady
        )?.id
      : undefined
    const panelAccountId = accountId ?? defaultAccountId
    const newPanel: PanelDefinition = {
      id: uuidv4(),
      type,
      title: titleOverride?.trim() || getNextPanelTitle(type, workspace.panels),
      zone: targetZone,
      ...(launchMode === 'login' ? { launchMode: 'login' as const } : {}),
      ...(panelAccountId ? { accountId: panelAccountId } : {}),
      ...(AGENT_WORKTREE_TYPES.has(type) ? { workspaceIsolation: 'isolated' as const } : {})
    }

    const panels = [...workspace.panels, newPanel]
    let nextLayout = normalizeLayoutForPanels(workspace.layout, panels)
    if (targetZone === 'right' && !hadRight) {
      nextLayout = {
        ...nextLayout,
        rightSize: isWebChatPanel(type)
          ? DEFAULT_CHAT_RIGHT_SIZE
          : nextLayout.rightSize >= 20
            ? nextLayout.rightSize
            : 36
      }
    }

    if (targetZone === 'center') {
      if (isFloatingWidget(type) && !rect) {
        nextLayout = {
          ...nextLayout,
          centerPanelRects: {
            ...(nextLayout.centerPanelRects ?? {}),
            [newPanel.id]: floatingWidgetRect(type)
          }
        }
      } else if (isWebChatPanel(type) && !rect) {
        nextLayout = {
          ...nextLayout,
          centerPanelRects: {
            ...(nextLayout.centerPanelRects ?? {}),
            [newPanel.id]: placeChatRect()
          }
        }
      } else if (rect) {
        nextLayout = {
          ...nextLayout,
          centerPanelRects: {
            ...(nextLayout.centerPanelRects ?? {}),
            [newPanel.id]: clampOrchestratorRect(rect, floatingWidgetLimits(type))
          }
        }
      } else {
        const existingIds = workspace.panels
          .filter((p) => p.zone === 'center')
          .map((p) => p.id)
        nextLayout = {
          ...nextLayout,
          centerPanelRects: layoutAfterAddCenterPanel(
            existingIds,
            nextLayout.centerPanelRects ?? {},
            newPanel.id
          )
        }
      }
      if (isTiledWorkspace(nextLayout) && !isFloatingWidget(type)) {
        nextLayout = {
          ...nextLayout,
          centerGrid: insertPanelInGrid(nextLayout.centerGrid ?? null, newPanel.id)
        }
      }
    }

    set({
      workspaces: {
        ...workspaces,
        [activeProjectId]: {
          ...workspace,
          panels,
          layout: nextLayout
        }
      }
    })

    return newPanel.id
  },

  renamePanel: (panelId, title) => {
    const normalizedTitle = title.trim().slice(0, 120)
    if (!normalizedTitle) return

    const { activeProjectId, workspaces } = get()
    if (!activeProjectId) return

    const workspace = workspaces[activeProjectId]
    if (!workspace || !workspace.panels.some((panel) => panel.id === panelId)) return

    set({
      workspaces: {
        ...workspaces,
        [activeProjectId]: {
          ...workspace,
          panels: workspace.panels.map((panel) =>
            panel.id === panelId ? { ...panel, title: normalizedTitle } : panel
          )
        }
      }
    })
  },

  removePanel: (panelId) => {
    const { activeProjectId, workspaces } = get()
    if (!activeProjectId) return

    const workspace = workspaces[activeProjectId]
    if (!workspace) return

    const removedPanel = workspace.panels.find((p) => p.id === panelId)
    const projectRoot = get().projects.find((project) => project.id === activeProjectId)?.folderPath
    if (removedPanel) releasePanelIsolation(removedPanel, projectRoot)

    const nextPanels = workspace.panels.filter((p) => p.id !== panelId)
    const { [panelId]: _removed, ...restRects } = workspace.layout.centerPanelRects ?? {}

    set({
      workspaces: {
        ...workspaces,
        [activeProjectId]: {
          ...workspace,
          panels: nextPanels,
          layout: {
            ...workspace.layout,
            centerPanelRects: restRects,
            centerGrid: pruneCenterGrid(workspace.layout.centerGrid, new Set([panelId]))
          }
        }
      }
    })
  },

  removePanelsForAccount: (kind, accountId) => {
    const { workspaces } = get()
    let changed = false
    const nextWorkspaces: Record<string, ProjectWorkspaceState> = {}

    for (const [projectId, workspace] of Object.entries(workspaces)) {
      const removedIds = new Set(
        workspace.panels
          .filter(
            (panel) =>
              panel.type === kind &&
              (kind === 'antigravity' || panel.accountId === accountId ||
                (kind !== 'cursor' && !panel.accountId))
          )
          .map((panel) => panel.id)
      )
      if (removedIds.size === 0) {
        nextWorkspaces[projectId] = workspace
        continue
      }

      changed = true
      const projectRoot = get().projects.find((project) => project.id === projectId)?.folderPath
      for (const panel of workspace.panels) {
        if (removedIds.has(panel.id)) releasePanelIsolation(panel, projectRoot)
      }
      const centerPanelRects = Object.fromEntries(
        Object.entries(workspace.layout.centerPanelRects ?? {}).filter(
          ([panelId]) => !removedIds.has(panelId)
        )
      )
      nextWorkspaces[projectId] = {
        ...workspace,
        panels: workspace.panels.filter((panel) => !removedIds.has(panel.id)),
        layout: {
          ...workspace.layout,
          centerPanelRects,
          centerGrid: pruneCenterGrid(workspace.layout.centerGrid, removedIds)
        }
      }
    }

    if (changed) set({ workspaces: nextWorkspaces })
  },

  closeOtherAccountCliPanels: (kind, keepAccountId) => {
    const { workspaces } = get()
    let changed = false
    const nextWorkspaces: Record<string, ProjectWorkspaceState> = {}

    for (const [projectId, workspace] of Object.entries(workspaces)) {
      const removedIds = new Set(
        workspace.panels
          .filter((panel) => {
            if (panel.type !== kind) return false
            if (kind === 'antigravity') return true
            return Boolean(panel.accountId && panel.accountId !== keepAccountId)
          })
          .map((panel) => panel.id)
      )
      if (removedIds.size === 0) {
        nextWorkspaces[projectId] = workspace
        continue
      }

      changed = true
      const projectRoot = get().projects.find((project) => project.id === projectId)?.folderPath
      for (const panel of workspace.panels) {
        if (removedIds.has(panel.id)) releasePanelIsolation(panel, projectRoot)
      }
      const centerPanelRects = Object.fromEntries(
        Object.entries(workspace.layout.centerPanelRects ?? {}).filter(
          ([panelId]) => !removedIds.has(panelId)
        )
      )
      nextWorkspaces[projectId] = {
        ...workspace,
        panels: workspace.panels.filter((panel) => !removedIds.has(panel.id)),
        layout: {
          ...workspace.layout,
          centerPanelRects,
          centerGrid: pruneCenterGrid(workspace.layout.centerGrid, removedIds)
        }
      }
    }

    if (changed) set({ workspaces: nextWorkspaces })
  },

  movePanel: (panelId, zone) => {
    const { activeProjectId, workspaces } = get()
    if (!activeProjectId) return

    const workspace = workspaces[activeProjectId]
    if (!workspace) return

    const current = workspace.panels.find((p) => p.id === panelId)
    let centerPanelRects = workspace.layout.centerPanelRects ?? {}

    if (zone === 'center' && current && current.zone !== 'center') {
      if (isFloatingWidget(current.type)) {
        centerPanelRects = {
          ...centerPanelRects,
          [panelId]: floatingWidgetRect(current.type)
        }
      } else {
        const existingIds = workspace.panels
          .filter((p) => p.zone === 'center')
          .map((p) => p.id)
        centerPanelRects = layoutAfterAddCenterPanel(existingIds, centerPanelRects, panelId)
      }
    }

    if (zone !== 'center' && centerPanelRects[panelId]) {
      const { [panelId]: _removed, ...rest } = centerPanelRects
      centerPanelRects = rest
    }

    const nextPanels = workspace.panels.map((p) => (p.id === panelId ? { ...p, zone } : p))
    const hadRight = workspace.panels.some((p) => p.id !== panelId && p.zone === 'right')
    let nextLayout = {
      ...workspace.layout,
      centerPanelRects
    }
    if (zone === 'center' && current?.zone !== 'center' && !isFloatingWidget(current?.type) && isTiledWorkspace(nextLayout)) {
      nextLayout = {
        ...nextLayout,
        centerGrid: insertPanelInGrid(nextLayout.centerGrid ?? null, panelId)
      }
    }
    if (zone !== 'center') {
      nextLayout = {
        ...nextLayout,
        centerGrid: pruneCenterGrid(nextLayout.centerGrid, new Set([panelId]))
      }
    }
    if (zone === 'right' && !hadRight) {
      nextLayout = {
        ...nextLayout,
        rightSize: isWebChatPanel(current?.type)
          ? DEFAULT_CHAT_RIGHT_SIZE
          : (nextLayout.rightSize ?? 0) >= 20
            ? nextLayout.rightSize
            : 36
      }
    }

    set({
      workspaces: {
        ...workspaces,
        [activeProjectId]: {
          ...workspace,
          panels: nextPanels,
          layout: nextLayout
        }
      }
    })
  },

  updateLayout: (projectId, layoutPartial) => {
    const workspace = get().workspaces[projectId]
    if (!workspace) return

    const nextLayout = { ...workspace.layout, ...layoutPartial }
    const unchanged = (
      Object.keys(layoutPartial) as Array<keyof WorkspaceLayout>
    ).every((key) => {
      if (key === 'centerPanelSizes' || key === 'centerPanelRects' || key === 'centerGrid') {
        return JSON.stringify(workspace.layout[key] ?? null) === JSON.stringify(nextLayout[key] ?? null)
      }
      return workspace.layout[key] === nextLayout[key]
    })

    if (unchanged) return

    set({
      workspaces: {
        ...get().workspaces,
        [projectId]: {
          ...workspace,
          layout: nextLayout
        }
      }
    })
  },

  updateCenterPanelRect: (panelId, rect) => {
    const { activeProjectId, workspaces } = get()
    if (!activeProjectId) return
    const workspace = workspaces[activeProjectId]
    if (!workspace) return

    set({
      workspaces: {
        ...workspaces,
        [activeProjectId]: {
          ...workspace,
          layout: {
            ...workspace.layout,
            centerPanelRects: {
              ...(workspace.layout.centerPanelRects ?? {}),
              [panelId]: rect
            }
          }
        }
      }
    })
  },

  setCanvasMode: (mode) => {
    const { activeProjectId, workspaces } = get()
    if (!activeProjectId) return
    const workspace = workspaces[activeProjectId]
    if (!workspace) return
    if ((workspace.layout.canvasMode ?? 'free') === mode) return

    const ids = tiledCenterPanelIds(workspace.panels)
    const centerGrid =
      mode === 'tiled' ? buildEqualGrid(ids) : (workspace.layout.centerGrid ?? null)

    set({
      workspaces: {
        ...workspaces,
        [activeProjectId]: {
          ...workspace,
          layout: {
            ...workspace.layout,
            canvasMode: mode,
            centerGrid
          }
        }
      }
    })
  },

  swapTiledPanels: (firstId, secondId) => {
    const { activeProjectId, workspaces } = get()
    if (!activeProjectId || firstId === secondId) return
    const workspace = workspaces[activeProjectId]
    const grid = workspace?.layout.centerGrid
    if (!workspace || !grid) return

    set({
      workspaces: {
        ...workspaces,
        [activeProjectId]: {
          ...workspace,
          layout: {
            ...workspace.layout,
            centerGrid: swapGridPanels(grid, firstId, secondId)
          }
        }
      }
    })
  },

  splitTiledPanel: (panelId, side) => {
    const { activeProjectId } = get()
    if (!activeProjectId) return ''
    const newId = get().addPanel('terminal', 'center')
    if (!newId) return ''

    const workspace = get().workspaces[activeProjectId]
    if (!workspace) return newId
    const stripped = removePanelFromGrid(workspace.layout.centerGrid ?? null, newId)
    const nextGrid = stripped
      ? splitGridPanel(stripped, panelId, side, newId)
      : insertPanelInGrid(null, newId)

    set({
      workspaces: {
        ...get().workspaces,
        [activeProjectId]: {
          ...workspace,
          layout: {
            ...workspace.layout,
            centerGrid: nextGrid
          }
        }
      }
    })
    return newId
  },

  updateTiledSplitSizes: (path, sizes) => {
    const { activeProjectId, workspaces } = get()
    if (!activeProjectId) return
    const workspace = workspaces[activeProjectId]
    const grid = workspace?.layout.centerGrid
    if (!workspace || !grid) return
    const next = updateGridSizes(grid, path, sizes)
    if (JSON.stringify(next) === JSON.stringify(grid)) return

    set({
      workspaces: {
        ...workspaces,
        [activeProjectId]: {
          ...workspace,
          layout: {
            ...workspace.layout,
            centerGrid: next
          }
        }
      }
    })
  },

  toggleSidebar: (projectId) => {
    let workspace = get().workspaces[projectId]
    if (!workspace) {
      get().ensureProjectWorkspace(projectId, true)
      workspace = get().workspaces[projectId]
    }
    if (!workspace) return

    const willExpand = workspace.layout.leftCollapsed ?? false
    let panels = workspace.panels

    if (willExpand) {
      panels = sanitizeWorkspacePanels(panels)
    }

    const nextCollapsed = !willExpand
    const layout = normalizeLayoutForPanels(
      { ...workspace.layout, leftCollapsed: nextCollapsed },
      panels
    )

    set({
      workspaces: {
        ...get().workspaces,
        [projectId]: {
          ...workspace,
          panels,
          layout
        }
      }
    })
  },

  selectLeftSidebar: (projectId, view) => {
    let workspace = get().workspaces[projectId]
    if (!workspace) {
      get().ensureProjectWorkspace(projectId, true)
      workspace = get().workspaces[projectId]
    }
    if (!workspace) return

    const collapsed = workspace.layout.leftCollapsed ?? false
    const current = workspace.layout.leftSidebarView ?? 'files'

    if (!collapsed && current === view) {
      get().toggleSidebar(projectId)
      return
    }

    const panels = sanitizeWorkspacePanels(workspace.panels)
    const wideSidebarSize = 24
    const nextLeftSize =
      view === 'accounts' || view === 'profile'
        ? Math.max(workspace.layout.leftSize ?? 14, wideSidebarSize)
        : workspace.layout.leftSize
    set({
      workspaces: {
        ...get().workspaces,
        [projectId]: {
          ...workspace,
          panels,
          layout: {
            ...workspace.layout,
            leftCollapsed: false,
            leftSidebarView: view,
            ...((view === 'accounts' || view === 'profile') && nextLeftSize !== workspace.layout.leftSize
              ? { leftSize: nextLeftSize }
              : {})
          }
        }
      }
    })
  },

  setPanelWorktree: (panelId, worktreePath) => {
    const { workspaces } = get()
    let changed = false
    const nextWorkspaces: Record<string, ProjectWorkspaceState> = {}
    for (const [projectId, workspace] of Object.entries(workspaces)) {
      if (!workspace.panels.some((panel) => panel.id === panelId)) {
        nextWorkspaces[projectId] = workspace
        continue
      }
      changed = true
      nextWorkspaces[projectId] = {
        ...workspace,
        panels: workspace.panels.map((panel) => {
          if (panel.id !== panelId) return panel
          if (worktreePath) return { ...panel, worktreePath }
          const { worktreePath: _removed, ...rest } = panel
          return rest
        })
      }
    }
    if (changed) set({ workspaces: nextWorkspaces })
  },

  setPanelIsolation: (panelId, isolation) => {
    const { workspaces } = get()
    let changed = false
    const nextWorkspaces: Record<string, ProjectWorkspaceState> = {}
    for (const [projectId, workspace] of Object.entries(workspaces)) {
      if (!workspace.panels.some((panel) => panel.id === panelId)) {
        nextWorkspaces[projectId] = workspace
        continue
      }
      changed = true
      nextWorkspaces[projectId] = {
        ...workspace,
        panels: workspace.panels.map((panel) =>
          panel.id === panelId ? { ...panel, workspaceIsolation: isolation } : panel
        )
      }
    }
    if (changed) set({ workspaces: nextWorkspaces })
  },

  clearPanelLaunchMode: (panelId) => {
    const { activeProjectId, workspaces } = get()
    if (!activeProjectId) return
    const workspace = workspaces[activeProjectId]
    if (!workspace) return
    const panel = workspace.panels.find((candidate) => candidate.id === panelId)
    if (!panel?.launchMode) return

    set({
      workspaces: {
        ...workspaces,
        [activeProjectId]: {
          ...workspace,
          panels: workspace.panels.map((candidate) => {
            if (candidate.id !== panelId) return candidate
            const { launchMode: _launchMode, ...withoutLaunchMode } = candidate
            return withoutLaunchMode
          })
        }
      }
    })
  },

  setWorkspaceScale: (scale) => {
    const next = clampWorkspaceScale(scale)
    if (next === get().workspaceScale) return
    persistWorkspaceScale(next)
    set({ workspaceScale: next })
    if (typeof window !== 'undefined') {
      window.requestAnimationFrame(() => {
        window.dispatchEvent(new Event('resize'))
      })
    }
  },

  nudgeWorkspaceScale: (deltaSteps) => {
    get().setWorkspaceScale(get().workspaceScale + deltaSteps * WORKSPACE_SCALE_STEP)
  }
}))
