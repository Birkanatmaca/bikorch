import { useMemo } from 'react'
import type { DeveloperMemory } from '@shared/contracts/developer-intelligence'
import { cn } from '@renderer/lib/utils'

const CATEGORY_COLORS: Record<string, string> = {
  'About me': '#f2c14e',
  'Coding style': '#b494ff',
  Tooling: '#3ed6c5',
  Workflow: '#5ee0a0',
  Languages: '#5eb0ff',
  Architecture: '#ff7ad9',
  Communication: '#ff8f5a',
  Other: '#9aa6bd'
}
const FALLBACK_COLORS = ['#f2c14e', '#b494ff', '#3ed6c5', '#5ee0a0', '#5eb0ff', '#ff7ad9', '#ff8f5a', '#f07178']

export interface MemorySpherePoint {
  memory: DeveloperMemory
  /** Unit position inside a star field. */
  x: number
  y: number
  z: number
  color: string
}

export interface MemoryStarLink {
  a: number
  /** -1 means the center node. */
  b: number
  kind: 'core' | 'kin'
}

export function memoryCategoryColor(category: string): string {
  const known = CATEGORY_COLORS[category]
  if (known) return known
  let hash = 0
  for (const char of category) hash = (hash * 33 + char.charCodeAt(0)) >>> 0
  return FALLBACK_COLORS[hash % FALLBACK_COLORS.length] ?? FALLBACK_COLORS[0]
}

function mixHash(value: string, salt: number): number {
  let hash = (2166136261 ^ salt) >>> 0
  for (const char of value) {
    hash = (hash ^ char.charCodeAt(0)) >>> 0
    hash = Math.imul(hash, 16777619) >>> 0
  }
  hash = (hash ^ (hash >>> 16)) >>> 0
  hash = Math.imul(hash, 0x7feb352d) >>> 0
  hash = (hash ^ (hash >>> 15)) >>> 0
  hash = Math.imul(hash, 0x846ca68b) >>> 0
  hash = (hash ^ (hash >>> 16)) >>> 0
  return hash / 4294967296
}

function brightCountFor(total: number): number {
  return Math.min(total, Math.max(6, Math.round(Math.sqrt(total) * 2.4)))
}

function nudgeCluster(points: MemorySpherePoint[], count: number): void {
  const minDistance = 0.12
  for (let pass = 0; pass < 8; pass += 1) {
    for (let index = 0; index < count; index += 1) {
      const point = points[index]
      if (!point) continue
      let pushX = 0
      let pushY = 0
      for (let otherIndex = 0; otherIndex < count; otherIndex += 1) {
        if (otherIndex === index) continue
        const other = points[otherIndex]
        if (!other) continue
        const dx = point.x - other.x
        const dy = point.y - other.y
        const distance = Math.hypot(dx, dy) || 0.001
        if (distance >= minDistance) continue
        const push = (minDistance - distance) / distance
        pushX += dx * push
        pushY += dy * push
      }
      point.x += pushX * 0.35
      point.y += pushY * 0.35
    }
  }
}

/** Every memory is drawn, scattered across the field. There is no ring and no cap. */
export function layoutMemorySphere(memories: DeveloperMemory[]): {
  points: MemorySpherePoint[]
  hiddenCount: number
} {
  const ranked = [...memories].sort(
    (a, b) => Number(b.enabled) - Number(a.enabled) || b.lastSeenAt - a.lastSeenAt || a.id.localeCompare(b.id)
  )
  const brightCount = brightCountFor(ranked.length)
  const outer = Math.max(1, Math.sqrt(ranked.length / 48))
  const points: MemorySpherePoint[] = ranked.map((memory, index) => {
    const bright = index < brightCount
    const angle = mixHash(memory.id, 3) * Math.PI * 2
    const shell = bright
      ? 0.08 + mixHash(memory.id, 11) * 0.28
      : 0.16 + mixHash(memory.id, 11) * outer
    return {
      memory,
      x: Math.cos(angle) * shell,
      y: Math.sin(angle) * shell * (bright ? 0.86 : 0.78),
      z: 0,
      color: memoryCategoryColor(memory.category)
    }
  })
  nudgeCluster(points, brightCount)
  return { points, hiddenCount: 0 }
}

/** Same-category memories link to each other. Every memory also links to the center. */
export function linkMemoryStars(points: MemorySpherePoint[]): MemoryStarLink[] {
  const links: MemoryStarLink[] = points.map((_, index) => ({ a: index, b: -1, kind: 'core' }))
  const seen = new Set<string>()
  points.forEach((point, index) => {
    const nearest = points
      .map((other, otherIndex) => ({
        otherIndex,
        distance: otherIndex === index || other.memory.category !== point.memory.category
          ? Number.POSITIVE_INFINITY
          : Math.hypot(point.x - other.x, point.y - other.y, point.z - other.z)
      }))
      .sort((left, right) => left.distance - right.distance)
      .slice(0, 2)
    for (const neighbor of nearest) {
      if (!Number.isFinite(neighbor.distance)) continue
      const key = index < neighbor.otherIndex
        ? `${index}:${neighbor.otherIndex}`
        : `${neighbor.otherIndex}:${index}`
      if (seen.has(key)) continue
      seen.add(key)
      links.push({
        a: Math.min(index, neighbor.otherIndex),
        b: Math.max(index, neighbor.otherIndex),
        kind: 'kin'
      })
    }
  })
  return links
}

interface ProjectedPoint {
  x: number
  y: number
  depth: number
}

export function projectMemoryPoint(
  point: Pick<MemorySpherePoint, 'x' | 'y'>,
  _angle: number,
  radius: number
): ProjectedPoint {
  return { x: point.x * radius, y: point.y * radius, depth: 1 }
}

const CHART_RADIUS = 136

function parseHex(hex: string): [number, number, number] {
  const value = hex.replace('#', '')
  const normalized = value.length === 3
    ? value.split('').map((char) => char + char).join('')
    : value
  return [
    Number.parseInt(normalized.slice(0, 2), 16),
    Number.parseInt(normalized.slice(2, 4), 16),
    Number.parseInt(normalized.slice(4, 6), 16)
  ]
}

/** Closer nodes keep their own color. Far nodes fade into the field. */
function colorAtDistance(hex: string, nearness: number): string {
  const amount = 0.2 + nearness * 0.8
  const [red, green, blue] = parseHex(hex)
  const mix = (channel: number): number => Math.round(16 + (channel - 16) * amount)
  return `rgb(${mix(red)} ${mix(green)} ${mix(blue)})`
}

function shorten(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  trimStart: number,
  trimEnd: number
): { x1: number; y1: number; x2: number; y2: number } {
  const dx = x2 - x1
  const dy = y2 - y1
  const length = Math.hypot(dx, dy) || 1
  return {
    x1: x1 + (dx / length) * trimStart,
    y1: y1 + (dy / length) * trimStart,
    x2: x2 - (dx / length) * trimEnd,
    y2: y2 - (dy / length) * trimEnd
  }
}

export function MemoryBrain({
  memories,
  selectedId,
  learning = false,
  onSelectMemory
}: {
  memories: DeveloperMemory[]
  selectedId: string | null
  learning?: boolean
  onSelectMemory: (id: string) => void
}): React.JSX.Element {
  const { points } = useMemo(() => layoutMemorySphere(memories), [memories])
  const brightCount = brightCountFor(points.length)
  const links = useMemo(() => linkMemoryStars(points), [points])
  const placed = useMemo(() => points.map((point) => projectMemoryPoint(point, 0, CHART_RADIUS)), [points])
  const maxDistance = useMemo(
    () => Math.max(1, ...placed.map((point) => Math.hypot(point.x, point.y))),
    [placed]
  )
  const viewBox = useMemo(() => {
    const pad = 46
    const xs = [0, ...placed.map((point) => point.x)]
    const ys = [0, ...placed.map((point) => point.y)]
    const minX = Math.min(...xs) - pad
    const maxX = Math.max(...xs) + pad
    const minY = Math.min(...ys) - pad
    const maxY = Math.max(...ys) + pad
    return `${minX} ${minY} ${Math.max(1, maxX - minX)} ${Math.max(1, maxY - minY)}`
  }, [placed])

  return (
    <div className="memory-chart-scene">
      <div className="memory-chart-frame" role="group" aria-label="Memory">
        <svg className="memory-chart" viewBox={viewBox} preserveAspectRatio="xMidYMid meet">
          {points.length > 0 && (
            <g className={cn('memory-core', learning && 'is-learning')} aria-hidden="true">
              <circle className="memory-core-glow" r="42" />
              <circle className="memory-core-haze" r="18" />
            </g>
          )}
          {links.filter((link) => link.kind === 'core' && link.a < Math.min(5, brightCount)).map((link) => {
            const from = placed[link.a]
            if (!from) return null
            const line = shorten(0, 0, from.x, from.y, 14, 6)
            return (
              <line
                key={`core-${link.a}`}
                className="memory-spoke"
                x1={line.x1}
                y1={line.y1}
                x2={line.x2}
                y2={line.y2}
              />
            )
          })}
          {links.filter((link) => link.kind === 'kin' && link.a < brightCount && link.b < brightCount).map((link) => {
            const from = placed[link.a]
            const to = placed[link.b]
            if (!from || !to) return null
            const line = shorten(from.x, from.y, to.x, to.y, 6, 6)
            return (
              <line
                key={`kin-${link.a}-${link.b}`}
                className="memory-kin"
                x1={line.x1}
                y1={line.y1}
                x2={line.x2}
                y2={line.y2}
              />
            )
          })}
          {points.map((point, index) => {
            const place = placed[index]
            if (!place) return null
            const selected = selectedId === point.memory.id
            const nearness = 1 - Math.hypot(place.x, place.y) / maxDistance
            const radius = 1.05 + nearness * 2.5
            const fill = colorAtDistance(point.color, nearness)
            return (
              <g
                key={point.memory.id}
                role="button"
                tabIndex={0}
                className={cn('memory-node', !point.memory.enabled && 'is-disabled', selected && 'is-selected')}
                transform={`translate(${place.x} ${place.y})`}
                opacity={selected ? 1 : 0.34 + nearness * 0.66}
                onClick={() => onSelectMemory(point.memory.id)}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter' && event.key !== ' ') return
                  event.preventDefault()
                  onSelectMemory(point.memory.id)
                }}
                aria-label={`${point.memory.category}: ${point.memory.content}`}
                aria-pressed={selected}
              >
                <title>{point.memory.content}</title>
                <circle className="memory-hit" r="8" />
                {nearness > 0.55 ? <circle className="memory-node-glow" r={radius * 2.4} fill={point.color} /> : null}
                <circle
                  className="memory-node-speck"
                  r={selected ? radius + 1.1 : radius}
                  fill={fill}
                />
              </g>
            )
          })}
          {points.length > 0 && (
            <g className="memory-core" aria-hidden="true">
              <circle className="memory-core-mid" r="9" />
              <circle className="memory-core-body" r="5.5" />
            </g>
          )}
        </svg>
      </div>
    </div>
  )
}
