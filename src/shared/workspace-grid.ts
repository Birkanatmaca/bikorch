import {
  type GridSplitDirection,
  type PanelDefinition,
  type TiledSplitSide,
  type WorkspaceCanvasMode,
  type WorkspaceGridNode,
  type WorkspaceLayout,
  parseCanvasMode
} from './types'

export function isTiledWorkspace(layout: WorkspaceLayout): boolean {
  return parseCanvasMode(layout.canvasMode) !== 'free'
}

export function tiledCenterPanelIds(panels: PanelDefinition[]): string[] {
  return panels
    .filter((panel) => panel.zone === 'center' && panel.type !== 'player')
    .map((panel) => panel.id)
}

export function collectGridIds(node: WorkspaceGridNode | null | undefined): string[] {
  if (!node) return []
  if (node.type === 'leaf') return [node.panelId]
  return [...collectGridIds(node.children[0]), ...collectGridIds(node.children[1])]
}

export function leafCount(node: WorkspaceGridNode): number {
  if (node.type === 'leaf') return 1
  return leafCount(node.children[0]) + leafCount(node.children[1])
}

export function columnCountForTiles(count: number): number {
  if (count <= 1) return 1
  if (count === 2) return 2
  if (count === 3) return 3
  if (count <= 4) return 2
  if (count <= 9) return 3
  return Math.ceil(Math.sqrt(count))
}

function joinNodes(nodes: WorkspaceGridNode[], direction: GridSplitDirection): WorkspaceGridNode {
  if (nodes.length === 1) return nodes[0]
  const mid = Math.ceil(nodes.length / 2)
  const left = joinNodes(nodes.slice(0, mid), direction)
  const right = joinNodes(nodes.slice(mid), direction)
  const leftWeight = leafCount(left)
  const rightWeight = leafCount(right)
  const total = leftWeight + rightWeight
  return {
    type: 'split',
    direction,
    sizes: [(leftWeight / total) * 100, (rightWeight / total) * 100],
    children: [left, right]
  }
}

export function buildEqualGrid(panelIds: string[]): WorkspaceGridNode | null {
  if (panelIds.length === 0) return null
  if (panelIds.length === 1) return { type: 'leaf', panelId: panelIds[0] }
  return buildWrappedGrid(panelIds, columnCountForTiles(panelIds.length))
}

export function buildWrappedGrid(panelIds: string[], columns: number): WorkspaceGridNode | null {
  if (panelIds.length === 0) return null
  if (panelIds.length === 1) return { type: 'leaf', panelId: panelIds[0] }
  const cols = Math.max(1, Math.min(Math.floor(columns) || 1, panelIds.length))
  const rows: WorkspaceGridNode[][] = []
  for (let index = 0; index < panelIds.length; index += cols) {
    const slice = panelIds.slice(index, index + cols)
    rows.push(slice.map((panelId) => ({ type: 'leaf', panelId })))
  }
  const rowNodes = rows.map((row) => joinNodes(row, 'vertical'))
  return joinNodes(rowNodes, 'horizontal')
}

export function buildRowGrid(panelIds: string[], maxRows: number): WorkspaceGridNode | null {
  if (panelIds.length === 0) return null
  const rows = Math.max(1, Math.min(Math.floor(maxRows) || 1, panelIds.length))
  const columns = Math.ceil(panelIds.length / rows)
  return buildWrappedGrid(panelIds, columns)
}

export function buildLayoutGrid(
  panelIds: string[],
  mode: WorkspaceCanvasMode
): WorkspaceGridNode | null {
  const parsed = parseCanvasMode(mode)
  if (parsed === 'free') return null
  if (parsed === 'tiled') return buildEqualGrid(panelIds)
  if (parsed === 'grid-2x2' || parsed === 'cols-2') return buildWrappedGrid(panelIds, 2)
  if (parsed === 'cols-3') return buildWrappedGrid(panelIds, 3)
  if (parsed === 'cols-4') return buildWrappedGrid(panelIds, 4)
  if (parsed === 'rows-2') return buildRowGrid(panelIds, 2)
  if (parsed === 'rows-3') return buildRowGrid(panelIds, 3)
  return buildRowGrid(panelIds, 4)
}

export function removePanelFromGrid(
  node: WorkspaceGridNode | null,
  panelId: string
): WorkspaceGridNode | null {
  if (!node) return null
  if (node.type === 'leaf') return node.panelId === panelId ? null : node

  const left = removePanelFromGrid(node.children[0], panelId)
  const right = removePanelFromGrid(node.children[1], panelId)
  if (!left) return right
  if (!right) return left
  return { ...node, children: [left, right] }
}

function lastLeafId(node: WorkspaceGridNode): string {
  if (node.type === 'leaf') return node.panelId
  return lastLeafId(node.children[1])
}

function sideToSplit(side: TiledSplitSide): {
  direction: GridSplitDirection
  newFirst: boolean
} {
  if (side === 'left') return { direction: 'vertical', newFirst: true }
  if (side === 'right') return { direction: 'vertical', newFirst: false }
  if (side === 'up') return { direction: 'horizontal', newFirst: true }
  return { direction: 'horizontal', newFirst: false }
}

function replaceLeaf(
  node: WorkspaceGridNode,
  panelId: string,
  next: WorkspaceGridNode
): WorkspaceGridNode {
  if (node.type === 'leaf') return node.panelId === panelId ? next : node
  return {
    ...node,
    children: [
      replaceLeaf(node.children[0], panelId, next),
      replaceLeaf(node.children[1], panelId, next)
    ]
  }
}

export function splitGridPanel(
  node: WorkspaceGridNode,
  panelId: string,
  side: TiledSplitSide,
  newPanelId: string
): WorkspaceGridNode {
  const { direction, newFirst } = sideToSplit(side)
  const existing: WorkspaceGridNode = { type: 'leaf', panelId }
  const added: WorkspaceGridNode = { type: 'leaf', panelId: newPanelId }
  const split: WorkspaceGridNode = {
    type: 'split',
    direction,
    sizes: [50, 50],
    children: newFirst ? [added, existing] : [existing, added]
  }
  return replaceLeaf(node, panelId, split)
}

export function insertPanelInGrid(
  node: WorkspaceGridNode | null,
  newPanelId: string,
  side: TiledSplitSide = 'right'
): WorkspaceGridNode {
  if (!node) return { type: 'leaf', panelId: newPanelId }
  return splitGridPanel(node, lastLeafId(node), side, newPanelId)
}

export function swapGridPanels(
  node: WorkspaceGridNode,
  firstId: string,
  secondId: string
): WorkspaceGridNode {
  if (firstId === secondId) return node
  const remap = (current: WorkspaceGridNode): WorkspaceGridNode => {
    if (current.type === 'leaf') {
      if (current.panelId === firstId) return { type: 'leaf', panelId: secondId }
      if (current.panelId === secondId) return { type: 'leaf', panelId: firstId }
      return current
    }
    return {
      ...current,
      children: [remap(current.children[0]), remap(current.children[1])]
    }
  }
  return remap(node)
}

export function updateGridSizes(
  node: WorkspaceGridNode,
  path: number[],
  sizes: [number, number]
): WorkspaceGridNode {
  if (node.type === 'leaf' || path.length === 0) {
    if (node.type === 'split' && path.length === 0) {
      return { ...node, sizes }
    }
    return node
  }
  const [head, ...rest] = path
  const index = head === 1 ? 1 : 0
  const nextChild = updateGridSizes(node.children[index], rest, sizes)
  const children: [WorkspaceGridNode, WorkspaceGridNode] =
    index === 0 ? [nextChild, node.children[1]] : [node.children[0], nextChild]
  return { ...node, children }
}

export function syncGridWithPanelIds(
  node: WorkspaceGridNode | null,
  panelIds: string[]
): WorkspaceGridNode | null {
  if (panelIds.length === 0) return null
  if (!node) return buildEqualGrid(panelIds)

  let next: WorkspaceGridNode | null = node
  for (const id of collectGridIds(next)) {
    if (!panelIds.includes(id)) next = removePanelFromGrid(next, id)
  }
  const have = new Set(collectGridIds(next))
  for (const id of panelIds) {
    if (have.has(id)) continue
    next = insertPanelInGrid(next, id)
    have.add(id)
  }
  return next
}
