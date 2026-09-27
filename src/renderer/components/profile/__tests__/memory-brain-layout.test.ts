import { describe, expect, it } from 'vitest'
import type { DeveloperMemory } from '@shared/contracts/developer-intelligence'
import { layoutMemorySphere, linkMemoryStars, memoryCategoryColor, projectMemoryPoint } from '../MemoryBrain'

function memory(id: string, category: string, enabled = true): DeveloperMemory {
  return {
    id,
    scope: 'global',
    category,
    content: id,
    confidence: 1,
    evidenceCount: 1,
    firstSeenAt: 1,
    lastSeenAt: Number(id.replace(/\D/g, '')) || 1,
    source: 'user',
    enabled
  }
}

describe('memory brain sphere', () => {
  it('keeps every memory on the field with no display cap', () => {
    const memories = Array.from({ length: 60 }, (_, index) => memory(`m${index}`, index % 2 === 0 ? 'About me' : 'Tooling'))
    const layout = layoutMemorySphere(memories)
    expect(layout.points).toHaveLength(60)
    expect(layout.hiddenCount).toBe(0)
    for (const point of layout.points) {
      expect(point.z).toBe(0)
      expect(Number.isFinite(point.x)).toBe(true)
      expect(Number.isFinite(point.y)).toBe(true)
    }
    const radii = layout.points.map((point) => Math.hypot(point.x, point.y))
    expect(Math.max(...radii) - Math.min(...radii)).toBeGreaterThan(0.45)
    expect(Math.min(...radii)).toBeGreaterThan(0.04)
    const links = linkMemoryStars(layout.points)
    const coreLinks = links.filter((link) => link.kind === 'core')
    const kinLinks = links.filter((link) => link.kind === 'kin')
    expect(coreLinks).toHaveLength(layout.points.length)
    expect(kinLinks.length).toBeGreaterThan(0)
    expect(kinLinks.every((link) => layout.points[link.a]?.memory.category === layout.points[link.b]?.memory.category)).toBe(true)
  })

  it('gives each category its own color and lays the field flat', () => {
    expect(memoryCategoryColor('About me')).not.toBe(memoryCategoryColor('Tooling'))
    const points = layoutMemorySphere(
      Array.from({ length: 8 }, (_, index) => memory(`s${index}`, index % 2 === 0 ? 'Languages' : 'Workflow'))
    ).points
    const projected = points.map((point) => projectMemoryPoint(point, 0.4, 120))
    const span = Math.max(...projected.map((point) => point.x)) - Math.min(...projected.map((point) => point.x))
    expect(span).toBeGreaterThan(40)
    expect(projected.every((point) => point.depth === 1)).toBe(true)
    expect(projectMemoryPoint(points[0]!, 1.2, 120)).toEqual(projectMemoryPoint(points[0]!, 0, 120))
  })
})
