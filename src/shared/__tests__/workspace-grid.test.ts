import { describe, expect, it } from 'vitest'
import {
  buildEqualGrid,
  collectGridIds,
  columnCountForTiles,
  insertPanelInGrid,
  leafCount,
  removePanelFromGrid,
  splitGridPanel,
  swapGridPanels,
  syncGridWithPanelIds,
  tiledCenterPanelIds,
  updateGridSizes
} from '../workspace-grid'
import type { WorkspaceGridNode } from '../types'

function idsOf(node: WorkspaceGridNode | null): string[] {
  return collectGridIds(node)
}

describe('tiled workspace grid', () => {
  it('picks compact column counts', () => {
    expect(columnCountForTiles(1)).toBe(1)
    expect(columnCountForTiles(2)).toBe(2)
    expect(columnCountForTiles(3)).toBe(3)
    expect(columnCountForTiles(4)).toBe(2)
    expect(columnCountForTiles(6)).toBe(3)
    expect(columnCountForTiles(9)).toBe(3)
  })

  it('builds an equal 2x2 grid', () => {
    const grid = buildEqualGrid(['a', 'b', 'c', 'd'])
    expect(idsOf(grid)).toEqual(['a', 'b', 'c', 'd'])
    expect(grid?.type).toBe('split')
    if (grid?.type !== 'split') return
    expect(grid.direction).toBe('horizontal')
    expect(grid.sizes[0]).toBeCloseTo(50)
    expect(grid.sizes[1]).toBeCloseTo(50)
    expect(leafCount(grid)).toBe(4)
  })

  it('builds three equal columns', () => {
    const grid = buildEqualGrid(['a', 'b', 'c'])
    expect(idsOf(grid)).toEqual(['a', 'b', 'c'])
    if (grid?.type !== 'split') throw new Error('expected split')
    expect(grid.direction).toBe('vertical')
    expect(grid.sizes[0]).toBeCloseTo(200 / 3)
    expect(grid.sizes[1]).toBeCloseTo(100 / 3)
  })

  it('splits a leaf to the right and left', () => {
    const start: WorkspaceGridNode = { type: 'leaf', panelId: 'a' }
    const right = splitGridPanel(start, 'a', 'right', 'b')
    expect(idsOf(right)).toEqual(['a', 'b'])
    if (right.type !== 'split') throw new Error('expected split')
    expect(right.direction).toBe('vertical')

    const left = splitGridPanel(start, 'a', 'left', 'b')
    expect(idsOf(left)).toEqual(['b', 'a'])
  })

  it('splits up and down', () => {
    const start: WorkspaceGridNode = { type: 'leaf', panelId: 'a' }
    const down = splitGridPanel(start, 'a', 'down', 'b')
    if (down.type !== 'split') throw new Error('expected split')
    expect(down.direction).toBe('horizontal')
    expect(idsOf(down)).toEqual(['a', 'b'])

    const up = splitGridPanel(start, 'a', 'up', 'b')
    expect(idsOf(up)).toEqual(['b', 'a'])
  })

  it('removes a leaf and collapses the parent split', () => {
    const grid = buildEqualGrid(['a', 'b'])
    const next = removePanelFromGrid(grid, 'a')
    expect(idsOf(next)).toEqual(['b'])
    expect(next?.type).toBe('leaf')
  })

  it('swaps two leaves', () => {
    const grid = buildEqualGrid(['a', 'b', 'c'])
    const swapped = swapGridPanels(grid!, 'a', 'c')
    expect(idsOf(swapped)).toEqual(['c', 'b', 'a'])
  })

  it('inserts a panel against the last leaf', () => {
    const grid = insertPanelInGrid({ type: 'leaf', panelId: 'a' }, 'b')
    expect(idsOf(grid)).toEqual(['a', 'b'])
  })

  it('syncs missing and extra panel ids', () => {
    const grid = buildEqualGrid(['a', 'b'])
    const next = syncGridWithPanelIds(grid, ['b', 'c'])
    expect(idsOf(next).sort()).toEqual(['b', 'c'])
  })

  it('updates split sizes by path', () => {
    const grid = buildEqualGrid(['a', 'b'])
    const next = updateGridSizes(grid!, [], [40, 60])
    if (next.type !== 'split') throw new Error('expected split')
    expect(next.sizes).toEqual([40, 60])
  })

  it('keeps player and timer widgets out of the tiled grid', () => {
    expect(
      tiledCenterPanelIds([
        { id: 'term', type: 'terminal', title: 'Terminal', zone: 'center' },
        { id: 'player', type: 'player', title: 'Player', zone: 'center' },
        { id: 'timer', type: 'timer', title: 'Timer', zone: 'center' },
        { id: 'files', type: 'file-explorer', title: 'Files', zone: 'left' }
      ])
    ).toEqual(['term'])
  })
})
