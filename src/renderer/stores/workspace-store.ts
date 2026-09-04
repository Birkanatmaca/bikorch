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
  type OrchestratorRect
} from '@shared/types'
import { AI_ACCOUNT_KINDS } from '@shared/contracts/accounts'
import type { CliUsageKind } from '@shared/contracts/usage'
import { useAiAccountsStore } from './ai-accounts-store'

const PTY_PANEL_TYPES = new Set<PanelType>([
  'terminal',
  'claude',
  'cursor',
  'gemini',
  'antigravity',
  'codex'
])

function terminatePanelSession(panelId: string, type: PanelType): void {
  if (!PTY_PANEL_TYPES.has(type) || typeof window === 'undefined' || !window.api?.pty) return
  void window.api.pty.kill({ sessionId: panelId })
}

interface WorkspaceSnapshot {
  projects: Project[]
  activeProjectId: string | null
  workspaces: Record<string, ProjectWorkspaceState>
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
  toggleSidebar: (projectId: string) => void
  selectLeftSidebar: (
    projectId: string,
    view: 'files' | 'changes' | 'accounts'
  ) => void
  clearPanelLaunchMode: (panelId: string) => void
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
    return project.id
  },

  removeProject: (projectId) => {
    const workspace = get().workspaces[projectId]
    workspace?.panels.forEach((panel) => terminatePanelSession(panel.id, panel.type))

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
    set((state) => ({
      projects: state.projects.map((p) => (p.id === projectId ? { ...p, ...updates } : p))
    }))
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

  addPanel: (type, zone, rect, launchMode, accountId, titleOverride) => {
    const { activeProjectId, workspaces } = get()
    if (!activeProjectId) return ''

    const workspace = workspaces[activeProjectId]
    if (!workspace) return ''

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
      ...(panelAccountId ? { accountId: panelAccountId } : {})
    }

    const panels = [...workspace.panels, newPanel]
    let nextLayout = normalizeLayoutForPanels(workspace.layout, panels)
    if (targetZone === 'right' && !hadRight) {
      nextLayout = {
        ...nextLayout,
        rightSize: nextLayout.rightSize >= 20 ? nextLayout.rightSize : 36
      }
    }

    if (targetZone === 'center') {
      if (rect) {
        nextLayout = {
          ...nextLayout,
          centerPanelRects: {
            ...(nextLayout.centerPanelRects ?? {}),
            [newPanel.id]: clampOrchestratorRect(rect)
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
    if (removedPanel) terminatePanelSession(removedPanel.id, removedPanel.type)

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
            centerPanelRects: restRects
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
              (kind === 'antigravity' || !panel.accountId || panel.accountId === accountId)
          )
          .map((panel) => panel.id)
      )
      if (removedIds.size === 0) {
        nextWorkspaces[projectId] = workspace
        continue
      }

      changed = true
      for (const panel of workspace.panels) {
        if (removedIds.has(panel.id)) terminatePanelSession(panel.id, panel.type)
      }
      const centerPanelRects = Object.fromEntries(
        Object.entries(workspace.layout.centerPanelRects ?? {}).filter(
          ([panelId]) => !removedIds.has(panelId)
        )
      )
      nextWorkspaces[projectId] = {
        ...workspace,
        panels: workspace.panels.filter((panel) => !removedIds.has(panel.id)),
        layout: { ...workspace.layout, centerPanelRects }
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
          .filter(
            (panel) =>
              panel.type === kind && panel.accountId && panel.accountId !== keepAccountId
          )
          .map((panel) => panel.id)
      )
      if (removedIds.size === 0) {
        nextWorkspaces[projectId] = workspace
        continue
      }

      changed = true
      for (const panel of workspace.panels) {
        if (removedIds.has(panel.id)) terminatePanelSession(panel.id, panel.type)
      }
      const centerPanelRects = Object.fromEntries(
        Object.entries(workspace.layout.centerPanelRects ?? {}).filter(
          ([panelId]) => !removedIds.has(panelId)
        )
      )
      nextWorkspaces[projectId] = {
        ...workspace,
        panels: workspace.panels.filter((panel) => !removedIds.has(panel.id)),
        layout: { ...workspace.layout, centerPanelRects }
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

    if (zone === 'center' && current?.zone !== 'center') {
      const existingIds = workspace.panels
        .filter((p) => p.zone === 'center')
        .map((p) => p.id)
      centerPanelRects = layoutAfterAddCenterPanel(existingIds, centerPanelRects, panelId)
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
    if (zone === 'right' && !hadRight && (nextLayout.rightSize ?? 0) < 20) {
      nextLayout = { ...nextLayout, rightSize: 36 }
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
      if (key === 'centerPanelSizes' || key === 'centerPanelRects') {
        return JSON.stringify(workspace.layout[key] ?? {}) === JSON.stringify(nextLayout[key] ?? {})
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
    const accountsLeftSize = 24
    const nextLeftSize =
      view === 'accounts'
        ? Math.max(workspace.layout.leftSize ?? 14, accountsLeftSize)
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
            ...(view === 'accounts' && nextLeftSize !== workspace.layout.leftSize
              ? { leftSize: nextLeftSize }
              : {})
          }
        }
      }
    })
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
  }
}))
