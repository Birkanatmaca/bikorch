import { useEditorStore } from '@renderer/stores/editor-store'
import { useIsolationStore } from '@renderer/stores/isolation-store'
import { useResourceStore } from '@renderer/stores/resource-store'
import { useWorkspaceStore } from '@renderer/stores/workspace-store'
import { applyRendererResourceProfile } from '@renderer/lib/resource-limits'

export function startResourcePolicies(): () => void {
  void useResourceStore.getState().hydrate()

  const unsubWorkspace = useWorkspaceStore.subscribe((state, prev) => {
    if (!state.activeProjectId || state.activeProjectId === prev.activeProjectId) return
    const keep = useResourceStore.getState().profile
    useEditorStore.getState().evictInactiveDiffs(state.activeProjectId, keep)
    useIsolationStore.getState().evictInactive(state.activeProjectId, keep)
  })

  const unsubProfile = useResourceStore.subscribe((state, prev) => {
    if (state.profile === prev.profile) return
    applyRendererResourceProfile(state.profile)
    const activeId = useWorkspaceStore.getState().activeProjectId
    if (!activeId) return
    useEditorStore.getState().evictInactiveDiffs(activeId, state.profile)
    useIsolationStore.getState().evictInactive(activeId, state.profile)
  })

  return () => {
    unsubWorkspace()
    unsubProfile()
  }
}
