import { describe, expect, it } from 'vitest'
import { DEFAULT_LAYOUT } from '@shared/types'
import { useWorkspaceStore } from '../workspace-store'

function setTwoProjects(): void {
  useWorkspaceStore.setState({
    projects: [
      { id: 'a', name: 'A', folderPath: null, createdAt: 0 },
      { id: 'b', name: 'B', folderPath: null, createdAt: 0 }
    ] as never,
    activeProjectId: 'a',
    workspaces: {
      a: {
        projectId: 'a',
        layout: { ...DEFAULT_LAYOUT },
        panels: [{ id: 'device', type: 'ios-preview', title: 'iOS Device', zone: 'right' }]
      },
      b: { projectId: 'b', layout: { ...DEFAULT_LAYOUT }, panels: [] }
    }
  })
}

const iosPanels = (projectId: string) =>
  useWorkspaceStore.getState().workspaces[projectId]?.panels.filter((panel) => panel.type === 'ios-preview') ?? []

describe('the iOS device across project tabs', () => {
  it('follows you to another tab, docked on the right', () => {
    setTwoProjects()
    useWorkspaceStore.getState().setActiveProject('b')
    expect(iosPanels('b')).toHaveLength(1)
    expect(iosPanels('b')[0].zone).toBe('right')
  })

  it('closes in every tab at once', () => {
    setTwoProjects()
    useWorkspaceStore.getState().setActiveProject('b')
    useWorkspaceStore.getState().removePanel(iosPanels('b')[0].id)
    expect(iosPanels('a')).toHaveLength(0)
    expect(iosPanels('b')).toHaveLength(0)
  })
})
