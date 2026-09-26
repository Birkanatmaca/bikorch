import type { PersistedSnapshot } from '@shared/contracts/persistence'
import { useEditorStore } from '@renderer/stores/editor-store'
import { selectGitBundle, selectGitChanges, useGitStore } from '@renderer/stores/git-store'
import { useWorkspaceStore } from '@renderer/stores/workspace-store'
import { useAiAccountsStore } from '@renderer/stores/ai-accounts-store'
import { useTasksStore } from '@renderer/stores/tasks-store'
import { useUsageStore } from '@renderer/stores/usage-store'
import { useSubscriptionStore } from '@renderer/stores/subscription-store'
import { AI_ACCOUNTS_REFRESH_EVENT } from './app-events'
import { trackProjectPersistence } from './project-filesystem'

const SAVE_DEBOUNCE_MS = 400
const MAX_SAVE_WAIT_MS = 2_000

let saveTimer: ReturnType<typeof setTimeout> | null = null
let firstSaveScheduledAt: number | null = null
let isHydrating = false
let syncStarted = false

export function buildPersistedSnapshot(): PersistedSnapshot {
  const workspace = useWorkspaceStore.getState().getSnapshot()
  const editor = useEditorStore.getState().getPersistedState()
  const accounts = useAiAccountsStore.getState().getSnapshot()
  const tasks = useTasksStore.getState().getSnapshot()
  const usage = useUsageStore.getState().getSnapshot()
  const subscriptions = useSubscriptionStore.getState().getSnapshot()

  return {
    projects: workspace.projects,
    activeProjectId: workspace.activeProjectId,
    workspaces: workspace.workspaces,
    editor,
    accounts: accounts.accounts,
    activeAccountByKind: accounts.activeAccountByKind,
    suppressedSystemAuthKinds: accounts.suppressedSystemAuthKinds,
    tasksByProject: tasks.tasksByProject,
    usage,
    subscriptions
  }
}

export async function hydrateFromDisk(signal?: AbortSignal): Promise<void> {
  const profilesPromise = window.api.authProfiles.list().catch(() => null)
  const snapshot = await window.api.persistence.load()
  if (signal?.aborted) return
  isHydrating = true
  try {
    useWorkspaceStore.getState().hydrate({
      projects: snapshot.projects,
      activeProjectId: snapshot.activeProjectId,
      workspaces: snapshot.workspaces
    })

    useEditorStore.getState().hydrate(snapshot.editor)
    useAiAccountsStore.getState().hydrate({
      accounts: snapshot.accounts,
      activeAccountByKind: snapshot.activeAccountByKind,
      suppressedSystemAuthKinds: snapshot.suppressedSystemAuthKinds
    })
    useTasksStore.getState().hydrate({ tasksByProject: snapshot.tasksByProject ?? {} })
    useUsageStore.getState().hydrate(snapshot.usage)
    useSubscriptionStore.getState().hydrate(snapshot.subscriptions)
  } finally {
    isHydrating = false
  }

  // Legacy account verification can involve a remote service; never hold up workspace loading.
  void profilesPromise.then((profiles) => {
    if (!profiles) return
    useAiAccountsStore.getState().syncAuthProfiles(profiles)
    window.dispatchEvent(new Event(AI_ACCOUNTS_REFRESH_EVENT))
  }).catch(() => undefined)

  // Restore diff in background — don't block app startup
  void restorePersistedEditorSession()
}

async function restorePersistedEditorSession(): Promise<void> {
  const { activeProjectId, projects } = useWorkspaceStore.getState()
  if (!activeProjectId) return

  const project = projects.find((p) => p.id === activeProjectId)
  if (!project?.folderPath) return

  await useGitStore.getState().refresh(activeProjectId, project.folderPath)

  const activeDiff = useEditorStore.getState().activeDiffByProject[activeProjectId]
  if (!activeDiff) return

  if (activeDiff.mode === 'file' && activeDiff.absolutePath) {
    await useEditorStore
      .getState()
      .openFile(activeProjectId, project.folderPath, activeDiff.absolutePath)
    return
  }

  const gitState = useGitStore.getState()
  const gitChanges = selectGitChanges(gitState.stateByProject, activeProjectId)
  const repoRoot =
    selectGitBundle(gitState.stateByProject, activeProjectId).selectedRoot ?? project.folderPath

  if (!activeDiff.status) {
    if (activeDiff.absolutePath) {
      await useEditorStore
        .getState()
        .openFile(activeProjectId, project.folderPath, activeDiff.absolutePath)
    }
    return
  }

  const change = gitChanges.find((c) => c.path === activeDiff.filePath) ?? {
    path: activeDiff.filePath,
    status: activeDiff.status,
    staged: false
  }

  await useEditorStore.getState().openDiff(activeProjectId, repoRoot, change, gitChanges)
}

function scheduleSave(): void {
  if (isHydrating) return
  if (firstSaveScheduledAt === null) firstSaveScheduledAt = Date.now()

  if (saveTimer) {
    clearTimeout(saveTimer)
  }

  saveTimer = setTimeout(() => {
    saveTimer = null
    firstSaveScheduledAt = null
    void flushPersistence().catch((error) => {
      console.error('Failed to save workspace snapshot:', error)
    })
  }, Math.max(0, Math.min(SAVE_DEBOUNCE_MS, MAX_SAVE_WAIT_MS - (Date.now() - firstSaveScheduledAt))))
}

export function startPersistenceSync(): void {
  if (syncStarted) return
  syncStarted = true

  useWorkspaceStore.subscribe((state, prevState) => {
    if (isHydrating) return
    // Register new/changed roots before any mounted explorer or editor can read
    // them. Layout-only saves can still be debounced.
    if (state.projects !== prevState.projects) {
      void flushPersistence().catch((error) => {
        console.error('Failed to register project:', error)
      })
      return
    }
    if (state.workspaces === prevState.workspaces && state.activeProjectId === prevState.activeProjectId) {
      return
    }
    scheduleSave()
  })

  useEditorStore.subscribe((state, prevState) => {
    if (
      state.selectedFileByProject === prevState.selectedFileByProject &&
      state.activeDiffByProject === prevState.activeDiffByProject
    ) {
      return
    }
    scheduleSave()
  })

  useAiAccountsStore.subscribe((state, prevState) => {
    if (
      state.accounts === prevState.accounts &&
      state.activeAccountByKind === prevState.activeAccountByKind &&
      state.suppressSystemImportByKind === prevState.suppressSystemImportByKind
    ) {
      return
    }
    scheduleSave()
  })

  useTasksStore.subscribe((state, prevState) => {
    if (state.tasksByProject === prevState.tasksByProject) return
    scheduleSave()
  })

  useUsageStore.subscribe((state, prevState) => {
    if (
      state.providers === prevState.providers &&
      state.checkedAtByAccountId === prevState.checkedAtByAccountId
    ) {
      return
    }
    scheduleSave()
  })

  useSubscriptionStore.subscribe((state, prevState) => {
    if (state.subscriptions === prevState.subscriptions) return
    scheduleSave()
  })
}

export async function flushPersistence(): Promise<void> {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  firstSaveScheduledAt = null

  await trackProjectPersistence(window.api.persistence.save(buildPersistedSnapshot()))
}
