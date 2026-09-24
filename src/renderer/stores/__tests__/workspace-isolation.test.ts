import { describe, expect, it } from 'vitest'
import { DEFAULT_LAYOUT } from '@shared/types'
import { useWorkspaceStore } from '../workspace-store'

describe('Secretary workspace isolation', () => {
  it('does not let a Secretary panel switch to the shared project tree', () => {
    useWorkspaceStore.setState({
      workspaces: {
        project: {
          projectId: 'project',
          layout: { ...DEFAULT_LAYOUT },
          panels: [
            {
              id: 'secretary-panel',
              type: 'cursor',
              title: 'Secretary',
              zone: 'center',
              panelRole: 'secretary',
              workspaceIsolation: 'isolated'
            },
            {
              id: 'regular-panel',
              type: 'cursor',
              title: 'Regular CLI',
              zone: 'center',
              panelRole: 'agent',
              workspaceIsolation: 'isolated'
            }
          ]
        }
      }
    })

    useWorkspaceStore.getState().setPanelIsolation('secretary-panel', 'shared')
    expect(useWorkspaceStore.getState().workspaces.project.panels[0].workspaceIsolation).toBe('isolated')

    useWorkspaceStore.getState().setPanelIsolation('regular-panel', 'shared')
    expect(useWorkspaceStore.getState().workspaces.project.panels[1].workspaceIsolation).toBe('shared')
  })
})
