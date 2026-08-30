import type { PersistedEditorState, PersistedSnapshot } from '@shared/contracts/persistence'
import { useEditorStore } from '@renderer/stores/editor-store'
import { selectGitBundle, selectGitChanges, useGitStore } from '@renderer/stores/git-store'
import { useWorkspaceStore } from '@renderer/stores/workspace-store'
import { useAiAccountsStore } from '@renderer/stores/ai-accounts-store'

const SAVE_DEBOUNCE_MS = 400

let saveTimer: ReturnType<typeof setTimeout> | null = null
let isHydrating = false
let syncStarted = false

export function buildPersistedSnapshot(): PersistedSnapshot {
  const workspace = useWorkspaceStore.getState().getSnapshot()
  const editor = useEditorStore.getState().getPersistedState()
  const accounts = useAiAccountsStore.getState().getSnapshot()

  return {
    projects: workspace.projects,
    activeProjectId: workspace.activeProjectId,
    workspaces: workspace.workspaces,
    editor,
    accounts: accounts.accounts,
    activeAccountByKind: accounts.activeAccountByKind
  }
}

export async function hydrateFromDisk(): Promise<void> {
  const snapshot = await window.api.persistence.load()
  isHydrating = true

  useWorkspaceStore.getState().hydrate({
    projects: snapshot.projects,
    activeProjectId: snapshot.activeProjectId,
    workspaces: snapshot.workspaces
  })

  useEditorStore.getState().hydrate(snapshot.editor)
  useAiAccountsStore.getState().hydrate({
    accounts: snapshot.accounts,
    activeAccountByKind: snapshot.activeAccountByKind
  })
  isHydrating = false

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

  if (saveTimer) {
    clearTimeout(saveTimer)
  }

  saveTimer = setTimeout(() => {
    saveTimer = null
    void window.api.persistence.save(buildPersistedSnapshot())
  }, SAVE_DEBOUNCE_MS)
}

export function startPersistenceSync(): void {
  if (syncStarted) return
  syncStarted = true

  useWorkspaceStore.subscribe((state, prevState) => {
    if (state.workspaces === prevState.workspaces && state.projects === prevState.projects) {
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
      state.activeAccountByKind === prevState.activeAccountByKind
    ) {
      return
    }
    scheduleSave()
  })
}

export async function flushPersistence(): Promise<void> {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }

  await window.api.persistence.save(buildPersistedSnapshot())
}
