import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.resetModules() })

describe('project persistence timing', () => {
  it('registers new roots synchronously, but debounces layout changes', async () => {
    vi.useFakeTimers()
    const save = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('window', { api: { persistence: { save } } })
    const { useWorkspaceStore } = await import('@renderer/stores/workspace-store')
    const { startPersistenceSync } = await import('../persistence-sync')
    startPersistenceSync()
    const projectId = useWorkspaceStore.getState().addProject('New project', '/project')
    expect(save).toHaveBeenCalledOnce()
    expect(save.mock.calls[0][0].projects).toEqual([{ id: projectId, name: 'New project', folderPath: '/project' }])
    useWorkspaceStore.getState().updateProject(projectId, { folderPath: '/moved' })
    expect(save).toHaveBeenCalledTimes(2)
    useWorkspaceStore.getState().updateLayout(projectId, { leftCollapsed: true })
    expect(save).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(400)
    expect(save).toHaveBeenCalledTimes(3)
    expect(save.mock.calls[2][0].projects[0].folderPath).toBe('/moved')
  }, 20_000)

  it('returns home without deleting projects or panels, then reopens the same project', async () => {
    const { useWorkspaceStore } = await import('@renderer/stores/workspace-store')
    const projectId = useWorkspaceStore.getState().addProject('Existing', '/project')
    const panels = useWorkspaceStore.getState().workspaces[projectId].panels
    useWorkspaceStore.getState().showHome()
    expect(useWorkspaceStore.getState().homeVisible).toBe(true)
    expect(useWorkspaceStore.getState().activeProjectId).toBe(projectId)
    expect(useWorkspaceStore.getState().workspaces[projectId].panels).toBe(panels)
    useWorkspaceStore.getState().touchRecentProject(projectId)
    expect(useWorkspaceStore.getState().homeVisible).toBe(false)
    expect(useWorkspaceStore.getState().projects).toHaveLength(1)
    expect(useWorkspaceStore.getState().getSnapshot()).not.toHaveProperty('homeVisible')
  })
})
