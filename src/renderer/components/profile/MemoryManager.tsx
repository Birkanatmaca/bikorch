import { useEffect, useMemo, useState } from 'react'
import { ChevronRight, Trash2, X } from 'lucide-react'
import type { DeveloperMemory } from '@shared/contracts/developer-intelligence'
import { useDeveloperIntelligenceStore } from '@renderer/stores/developer-intelligence-store'
import { useWorkspaceStore } from '@renderer/stores/workspace-store'
import { buttonStyles } from '@renderer/components/ui/Button'
import { formatDateTime } from './profile-format'
import { MemoryBrain } from './MemoryBrain'
import { SkillList } from './SkillList'

export function MemoryManager({ onOpenProfile }: { active: boolean; onOpenProfile: () => void }): React.JSX.Element {
  const memories = useDeveloperIntelligenceStore((state) => state.memories)
  const memoriesLoaded = useDeveloperIntelligenceStore((state) => state.memoriesLoaded)
  const loadMemories = useDeveloperIntelligenceStore((state) => state.loadMemories)
  const deleteMemory = useDeveloperIntelligenceStore((state) => state.deleteMemory)
  const analyzing = useDeveloperIntelligenceStore((state) => state.analysisLoading)
  const analyzeMemories = useDeveloperIntelligenceStore((state) => state.analyzeMemories)
  const projects = useWorkspaceStore((state) => state.projects)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  useEffect(() => {
    if (!memoriesLoaded) void loadMemories()
  }, [memoriesLoaded, loadMemories])

  const projectNames = useMemo(() => new Map(projects.map((project) => [project.id, project.name])), [projects])
  const selected = memories.find((memory) => memory.id === selectedId) ?? null

  const runAnalysis = async (): Promise<void> => {
    await analyzeMemories(
      projects.map((project) => ({ id: project.id, name: project.name, folderPath: project.folderPath }))
    )
  }

  return (
    <>
      <div className="intelligence-intro">
        <strong>Intelligence</strong>
        <p>Your memory, skills, and developer profile live here, on this computer.</p>
      </div>
      <section className="profile-brain-shell">
        <MemoryBrain
          memories={memories}
          selectedId={selectedId}
          learning={false}
          onSelectMemory={setSelectedId}
        />
        {selected && (
          <MemoryDetail
            memory={selected}
            projectName={selected.projectId ? projectNames.get(selected.projectId) : undefined}
            onClose={() => setSelectedId(null)}
            onDelete={() => {
              if (window.confirm('Delete this memory?')) {
                void deleteMemory(selected.id)
                setSelectedId(null)
              }
            }}
          />
        )}
        {memories.length > 0 && (
          <div className="profile-brain-actions">
            <button type="button" className={buttonStyles({ variant: 'secondary', size: 'sm' })} disabled={analyzing} onClick={() => void runAnalysis()}>
              {analyzing ? 'Discovering…' : 'Discover locally'}
            </button>
          </div>
        )}
      </section>
      <SkillList />
      <button type="button" className="intelligence-profile-link" onClick={onOpenProfile}>
        <span><strong>Developer Profile</strong><small>Insights, prompts, and sessions</small></span>
        <ChevronRight className="h-4 w-4" aria-hidden />
      </button>
    </>
  )
}

function MemoryDetail({
  memory,
  projectName,
  onClose,
  onDelete
}: {
  memory: DeveloperMemory
  projectName: string | undefined
  onClose: () => void
  onDelete: () => void
}): React.JSX.Element {
  const scope = memory.scope === 'project' ? projectName ?? 'Project' : 'Global'
  return (
    <div className="profile-brain-detail">
      <div className="profile-brain-detail-top">
        <span className="profile-prompt-tag">{memory.category}</span>
        <span>{scope}</span>
        <span>Formed {formatDateTime(memory.firstSeenAt)}</span>
        <button type="button" onClick={onClose} aria-label="Close selection"><X aria-hidden="true" /></button>
      </div>
      <p>{memory.content}</p>
      <div className="profile-brain-detail-actions">
        <button type="button" className="ml-auto" onClick={onDelete} aria-label="Delete memory"><Trash2 aria-hidden="true" /></button>
      </div>
    </div>
  )
}
