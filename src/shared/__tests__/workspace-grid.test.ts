import { describe, expect, it } from 'vitest'
import {
  buildEqualGrid,
  buildLayoutGrid,
  collectGridIds,
  columnCountForTiles,
  insertPanelInGrid,
  leafCount,
  removePanelFromGrid,
  splitGridPanel,
  swapGridPanels,
  syncGridWithPanelIds,
  updateGridSizes
} from '../workspace-grid'
import { parseCanvasMode, type WorkspaceGridNode } from '../types'

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
})

describe('layout presets', () => {
  it('splits four panels into equal columns', () => {
    const grid = buildLayoutGrid(['a', 'b', 'c', 'd'], 'cols-4')
    expect(idsOf(grid)).toEqual(['a', 'b', 'c', 'd'])
    expect(leafCount(grid!)).toBe(4)
    if (grid?.type !== 'split') throw new Error('expected split')
    expect(grid.direction).toBe('vertical')
    expect(grid.sizes[0]).toBeCloseTo(50)
    expect(grid.sizes[1]).toBeCloseTo(50)
  })

  it('stacks four panels into equal rows', () => {
    const grid = buildLayoutGrid(['a', 'b', 'c', 'd'], 'rows-4')
    expect(idsOf(grid)).toEqual(['a', 'b', 'c', 'd'])
    if (grid?.type !== 'split') throw new Error('expected split')
    expect(grid.direction).toBe('horizontal')
    expect(leafCount(grid)).toBe(4)
  })

  it('builds a 2×2 quadrant grid', () => {
    const grid = buildLayoutGrid(['a', 'b', 'c', 'd'], 'grid-2x2')
    expect(idsOf(grid)).toEqual(['a', 'b', 'c', 'd'])
    if (grid?.type !== 'split') throw new Error('expected split')
    expect(grid.direction).toBe('horizontal')
    expect(grid.children[0].type).toBe('split')
    expect(grid.children[1].type).toBe('split')
    if (grid.children[0].type !== 'split' || grid.children[1].type !== 'split') return
    expect(grid.children[0].direction).toBe('vertical')
    expect(grid.children[1].direction).toBe('vertical')
  })

  it('keeps two panels as a single pair when asking for four columns', () => {
    const grid = buildLayoutGrid(['a', 'b'], 'cols-4')
    expect(idsOf(grid)).toEqual(['a', 'b'])
    if (grid?.type !== 'split') throw new Error('expected split')
    expect(grid.direction).toBe('vertical')
  })

  it('does not tile free mode', () => {
    expect(buildLayoutGrid(['a', 'b'], 'free')).toBeNull()
  })

  it('parses known canvas modes and falls back to free', () => {
    expect(parseCanvasMode('cols-4')).toBe('cols-4')
    expect(parseCanvasMode('rows-4')).toBe('rows-4')
    expect(parseCanvasMode('nope')).toBe('free')
    expect(parseCanvasMode(undefined)).toBe('free')
  })
})
