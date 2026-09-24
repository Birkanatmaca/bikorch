import { useMemo } from 'react'
import { BrainCircuit, Sparkles } from 'lucide-react'
import { MEMORY_CATEGORIES, type DeveloperMemory } from '@shared/contracts/developer-intelligence'
import { cn } from '@renderer/lib/utils'

interface BrainNode {
  memory: DeveloperMemory
  x: number
  y: number
}

interface BrainCluster {
  category: string
  x: number
  y: number
  nodes: BrainNode[]
  hiddenCount: number
}

export function layoutMemoryBrain(memories: DeveloperMemory[]): BrainCluster[] {
  const categories = [
    ...MEMORY_CATEGORIES.filter((category) => memories.some((memory) => memory.category === category)),
    ...new Set(memories.map((memory) => memory.category).filter((category) => !MEMORY_CATEGORIES.some((known) => known === category)))
  ]
  return categories.map((category, index) => {
    const angle = -Math.PI / 2 + (index * Math.PI * 2) / categories.length
    const x = 50 + 28 * Math.cos(angle)
    const y = 50 + 27 * Math.sin(angle)
    const items = memories
      .filter((memory) => memory.category === category)
      .sort((a, b) => Number(b.enabled) - Number(a.enabled) || b.lastSeenAt - a.lastSeenAt)
    const visible = items.slice(0, 3)
    const nodes = visible.map((memory, nodeIndex) => {
      const offset = visible.length === 1 ? 0 : (nodeIndex - (visible.length - 1) / 2) * 0.36
      const theta = angle + offset
      return { memory, x: 50 + 40 * Math.cos(theta), y: 50 + 38 * Math.sin(theta) }
    })
    return { category, x, y, nodes, hiddenCount: items.length - visible.length }
  })
}

export function MemoryBrain({
  memories,
  selectedId,
  selectedCategory,
  onSelectMemory,
  onSelectCategory
}: {
  memories: DeveloperMemory[]
  selectedId: string | null
  selectedCategory: string | null
  onSelectMemory: (id: string) => void
  onSelectCategory: (category: string | null) => void
}): React.JSX.Element {
  const clusters = useMemo(() => layoutMemoryBrain(memories), [memories])
  const selectedCluster = clusters.find((cluster) => cluster.nodes.some((node) => node.memory.id === selectedId))
  return (
    <div className="profile-brain-map" role="group" aria-label="Developer memory mind map">
      <div className="profile-brain-grid" aria-hidden="true" />
      <svg className="profile-brain-links" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        {clusters.map((cluster) => (
          <g key={cluster.category}>
            <path
              d={`M 50 50 Q ${(50 + cluster.x) / 2 + (cluster.y - 50) * 0.12} ${(50 + cluster.y) / 2} ${cluster.x} ${cluster.y}`}
              className={cn('profile-brain-link', (selectedCategory === cluster.category || selectedCluster === cluster) && 'is-active')}
            />
            {cluster.nodes.map((node) => (
              <path
                key={node.memory.id}
                d={`M ${cluster.x} ${cluster.y} L ${node.x} ${node.y}`}
                className={cn('profile-brain-link profile-brain-link-leaf', selectedId === node.memory.id && 'is-active')}
              />
            ))}
          </g>
        ))}
      </svg>
      <div className="profile-brain-core" style={{ left: '50%', top: '50%' }}>
        <BrainCircuit aria-hidden="true" />
        <strong>YOU</strong>
        <span>{memories.filter((memory) => memory.enabled).length} aktif anı</span>
      </div>
      {clusters.map((cluster) => (
        <div key={cluster.category}>
          <button
            type="button"
            className={cn('profile-brain-category', selectedCategory === cluster.category && 'is-selected')}
            style={{ left: `${cluster.x}%`, top: `${cluster.y}%` }}
            onClick={() => onSelectCategory(selectedCategory === cluster.category ? null : cluster.category)}
            aria-label={`${cluster.category}, ${cluster.nodes.length + cluster.hiddenCount} anı`}
            aria-pressed={selectedCategory === cluster.category}
            title={cluster.category}
          >
            <span>{cluster.category}</span>
            {cluster.hiddenCount > 0 && <small>+{cluster.hiddenCount}</small>}
          </button>
          {cluster.nodes.map((node) => (
            <button
              type="button"
              key={node.memory.id}
              className={cn('profile-brain-leaf', node.memory.source === 'ai' && 'is-ai', !node.memory.enabled && 'is-disabled', selectedId === node.memory.id && 'is-selected')}
              style={{ left: `${node.x}%`, top: `${node.y}%` }}
              onClick={() => onSelectMemory(node.memory.id)}
              aria-label={`${node.memory.category}: ${node.memory.content}`}
              aria-pressed={selectedId === node.memory.id}
              title={node.memory.content}
            >
              {node.memory.source === 'ai' ? <Sparkles aria-hidden="true" /> : <span />}
            </button>
          ))}
        </div>
      ))}
      {clusters.length === 0 && (
        <div className="profile-brain-empty">Anılar eklendikçe bağlantılar burada büyür.</div>
      )}
    </div>
  )
}
