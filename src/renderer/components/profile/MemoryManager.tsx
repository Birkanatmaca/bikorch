import { useEffect, useMemo, useState } from 'react'
import { ChevronRight, Sparkles, Trash2, X } from 'lucide-react'
import type { DeveloperMemory } from '@shared/contracts/developer-intelligence'
import { useDeveloperIntelligenceStore } from '@renderer/stores/developer-intelligence-store'
import { useWorkspaceStore } from '@renderer/stores/workspace-store'
import { useSecretaryStore } from '@renderer/stores/secretary-store'
import { buttonStyles } from '@renderer/components/ui/Button'
import { Toggle } from './ProfilePrimitives'
import { formatDateTime } from './profile-format'
import { MemoryBrain } from './MemoryBrain'
import { SkillList } from './SkillList'
import { DailyLearnCard } from './DailyLearnCard'

export function MemoryManager({ active, onOpenProfile }: { active: boolean; onOpenProfile: () => void }): React.JSX.Element {
  const memories = useDeveloperIntelligenceStore((state) => state.memories)
  const memoriesLoaded = useDeveloperIntelligenceStore((state) => state.memoriesLoaded)
  const loadMemories = useDeveloperIntelligenceStore((state) => state.loadMemories)
  const deleteMemory = useDeveloperIntelligenceStore((state) => state.deleteMemory)
  const analyzing = useDeveloperIntelligenceStore((state) => state.analysisLoading)
  const analyzeMemories = useDeveloperIntelligenceStore((state) => state.analyzeMemories)
  const settings = useDeveloperIntelligenceStore((state) => state.settings)
  const updateSettings = useDeveloperIntelligenceStore((state) => state.updateSettings)
  const projects = useWorkspaceStore((state) => state.projects)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [learning, setLearning] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)
  const secretarySettings = useSecretaryStore((state) => state.settings)
  const secretaryLoaded = useSecretaryStore((state) => state.loaded)
  const loadSecretary = useSecretaryStore((state) => state.load)

  useEffect(() => {
    if (!memoriesLoaded) void loadMemories()
  }, [memoriesLoaded, loadMemories])

  useEffect(() => {
    if (!secretaryLoaded) void loadSecretary()
  }, [secretaryLoaded, loadSecretary])

  const projectNames = useMemo(() => new Map(projects.map((project) => [project.id, project.name])), [projects])
  const selected = memories.find((memory) => memory.id === selectedId) ?? null
  const canLearn = secretarySettings.configured && settings.savePromptHistory && settings.analyzePromptsWithAi

  const runAnalysis = async (): Promise<void> => {
    await analyzeMemories(
      projects.map((project) => ({ id: project.id, name: project.name, folderPath: project.folderPath }))
    )
  }

  const learnWithAi = async (): Promise<void> => {
    setLearning(true)
    setFeedback(null)
    try {
      await window.api.developerIntelligence.learnMemoriesWithAi()
      await Promise.all([loadMemories(), useSecretaryStore.getState().load()])
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'AI learning failed.')
    } finally {
      setLearning(false)
    }
  }

  return (
    <>
      <div className="intelligence-intro">
        <strong>Intelligence</strong>
        <p>Your memory, skills, and developer profile live here. Use them with Manager when you choose to.</p>
      </div>
      <section className="profile-brain-shell">
        <MemoryBrain
          memories={memories}
          selectedId={selectedId}
          learning={learning}
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
        <div className="profile-brain-controls">
          <Toggle
            checked={settings.includeMemoryInPrompts}
            onChange={(value) => void updateSettings({ includeMemoryInPrompts: value })}
            label="Share memory with Manager"
          />
        </div>
        {memories.length > 0 && (
          <div className="profile-brain-actions">
            <button type="button" className={buttonStyles({ variant: 'secondary', size: 'sm' })} disabled={analyzing || learning} onClick={() => void runAnalysis()}>
              {analyzing ? 'Discovering…' : 'Discover locally'}
            </button>
            <button type="button" className={buttonStyles({ variant: 'secondary', size: 'sm' })} disabled={learning || analyzing || !canLearn} onClick={() => void learnWithAi()}>
              <Sparkles className="h-3 w-3" aria-hidden="true" />{learning ? 'Learning…' : 'Learn with AI'}
            </button>
          </div>
        )}
        {feedback && <p className="profile-brain-feedback" role="status">{feedback}</p>}
      </section>
      <SkillList />
      <button type="button" className="intelligence-profile-link" onClick={onOpenProfile}>
        <span><strong>Developer Profile</strong><small>Insights, prompts, and sessions</small></span>
        <ChevronRight className="h-4 w-4" aria-hidden />
      </button>
      <DailyLearnCard active={active} />
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
