import { useEffect, useMemo, useRef, useState } from 'react'
import { Brain, Check, ChevronRight, Pencil, Plus, Search, Sparkles, Trash2, Wand2, X } from 'lucide-react'
import { MEMORY_CATEGORIES, type DeveloperMemory, type MemoryScope } from '@shared/contracts/developer-intelligence'
import { useDeveloperIntelligenceStore } from '@renderer/stores/developer-intelligence-store'
import { useWorkspaceStore } from '@renderer/stores/workspace-store'
import { useSecretaryStore } from '@renderer/stores/secretary-store'
import { useActiveProject } from '@renderer/hooks/use-active-project'
import { buttonStyles } from '@renderer/components/ui/Button'
import { cn } from '@renderer/lib/utils'
import { Toggle } from './ProfilePrimitives'
import { formatDateTime } from './profile-format'
import { MemoryBrain, memoryCategoryColor } from './MemoryBrain'
import { SkillList } from './SkillList'
import { DailyLearnCard } from './DailyLearnCard'

type IntelligenceTab = 'memory' | 'skills'

export function MemoryManager({ active, onOpenProfile }: { active: boolean; onOpenProfile: () => void }): React.JSX.Element {
  const memories = useDeveloperIntelligenceStore((state) => state.memories)
  const memoriesLoaded = useDeveloperIntelligenceStore((state) => state.memoriesLoaded)
  const loadMemories = useDeveloperIntelligenceStore((state) => state.loadMemories)
  const createMemory = useDeveloperIntelligenceStore((state) => state.createMemory)
  const updateMemory = useDeveloperIntelligenceStore((state) => state.updateMemory)
  const deleteMemory = useDeveloperIntelligenceStore((state) => state.deleteMemory)
  const analyzing = useDeveloperIntelligenceStore((state) => state.analysisLoading)
  const analyzeMemories = useDeveloperIntelligenceStore((state) => state.analyzeMemories)
  const settings = useDeveloperIntelligenceStore((state) => state.settings)
  const updateSettings = useDeveloperIntelligenceStore((state) => state.updateSettings)
  const skills = useDeveloperIntelligenceStore((state) => state.skills)
  const skillsLoaded = useDeveloperIntelligenceStore((state) => state.skillsLoaded)
  const loadSkills = useDeveloperIntelligenceStore((state) => state.loadSkills)
  const projects = useWorkspaceStore((state) => state.projects)
  const { projectId } = useActiveProject()
  const secretarySettings = useSecretaryStore((state) => state.settings)
  const secretaryLoaded = useSecretaryStore((state) => state.loaded)
  const loadSecretary = useSecretaryStore((state) => state.load)
  const [tab, setTab] = useState<IntelligenceTab>('memory')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [category, setCategory] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [adding, setAdding] = useState(false)
  const [learning, setLearning] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)
  const listRef = useRef<HTMLUListElement>(null)

  useEffect(() => {
    if (!memoriesLoaded) void loadMemories()
  }, [memoriesLoaded, loadMemories])

  useEffect(() => {
    if (!skillsLoaded) void loadSkills()
  }, [skillsLoaded, loadSkills])

  useEffect(() => {
    if (!secretaryLoaded) void loadSecretary()
  }, [secretaryLoaded, loadSecretary])

  useEffect(() => {
    if (!selectedId) return
    listRef.current?.querySelector(`[data-memory-id="${selectedId}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [selectedId])

  const projectNames = useMemo(() => new Map(projects.map((project) => [project.id, project.name])), [projects])
  const activeCount = memories.filter((memory) => memory.enabled).length
  const categories = useMemo(() => {
    const counts = new Map<string, number>()
    for (const memory of memories) counts.set(memory.category, (counts.get(memory.category) ?? 0) + 1)
    return [...counts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
  }, [memories])
  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    return memories
      .filter((memory) => !category || memory.category === category)
      .filter((memory) => !needle || memory.content.toLocaleLowerCase().includes(needle) || memory.category.toLocaleLowerCase().includes(needle))
      .sort((left, right) => Number(right.enabled) - Number(left.enabled) || right.lastSeenAt - left.lastSeenAt)
  }, [memories, category, query])
  const canLearn = secretarySettings.configured && settings.savePromptHistory && settings.analyzePromptsWithAi
  const learnHint = !secretarySettings.configured
    ? 'Connect Manager in Settings to learn with AI.'
    : !settings.savePromptHistory || !settings.analyzePromptsWithAi
      ? 'Turn on prompt history and AI analysis in Privacy to learn with AI.'
      : null

  const runAnalysis = async (): Promise<void> => {
    setFeedback(null)
    const result = await analyzeMemories(
      projects.map((project) => ({ id: project.id, name: project.name, folderPath: project.folderPath }))
    )
    if (result) {
      setFeedback(result.created + result.updated === 0
        ? 'Local discovery finished. Nothing new to remember yet.'
        : `Local discovery finished. ${result.created} new, ${result.updated} strengthened.`)
    }
  }

  const learnWithAi = async (): Promise<void> => {
    setLearning(true)
    setFeedback(null)
    try {
      await window.api.developerIntelligence.learnMemoriesWithAi()
      await Promise.all([loadMemories(), useSecretaryStore.getState().load()])
      setFeedback('Learning finished. Memory now reflects your recent prompts.')
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'AI learning failed.')
    } finally {
      setLearning(false)
    }
  }

  return (
    <div className="intel">
      <header className="intel-hero">
        <div className="intel-hero-top">
          <span className="intel-hero-icon"><Brain aria-hidden /></span>
          <div className="min-w-0">
            <strong>Intelligence</strong>
            <p>How {secretarySettings.name || 'Manager'} knows the way you work.</p>
          </div>
        </div>
        <div className="intel-stats">
          <div><strong>{activeCount}</strong><span>Active memories</span></div>
          <div><strong>{categories.length}</strong><span>Topics</span></div>
          <div><strong>{skills.filter((skill) => skill.enabled).length}</strong><span>Skills on</span></div>
        </div>
        <div className={cn('intel-share', settings.includeMemoryInPrompts && 'is-on')}>
          <Toggle
            checked={settings.includeMemoryInPrompts}
            onChange={(value) => void updateSettings({ includeMemoryInPrompts: value })}
            label="Share memory with Manager"
            description={settings.includeMemoryInPrompts
              ? 'Manager uses active memories when it plans and writes CLI prompts.'
              : 'Memory stays here. Manager plans without it.'}
          />
        </div>
      </header>

      <div className="intel-tabs" role="tablist" aria-label="Intelligence sections">
        <button type="button" role="tab" aria-selected={tab === 'memory'} className={cn(tab === 'memory' && 'is-active')} onClick={() => setTab('memory')}>
          Memory <span>{memories.length}</span>
        </button>
        <button type="button" role="tab" aria-selected={tab === 'skills'} className={cn(tab === 'skills' && 'is-active')} onClick={() => setTab('skills')}>
          Skills <span>{skills.length}</span>
        </button>
      </div>

      {tab === 'memory' ? (
        <section className="intel-section" role="tabpanel">
          {memories.length > 0 ? (
            <div className="intel-map">
              <MemoryBrain
                memories={memories}
                selectedId={selectedId}
                learning={learning || analyzing}
                focusCategory={category}
                onSelectMemory={(id) => setSelectedId((current) => (current === id ? null : id))}
              />
              <span className="intel-map-caption">Each point is a memory. Brighter points are newer and closer to the core.</span>
            </div>
          ) : (
            <div className="intel-empty">
              <Sparkles aria-hidden />
              <strong>No memories yet</strong>
              <p>Discover patterns from your projects, learn from your prompts, or add what Manager should know.</p>
            </div>
          )}

          <div className="intel-actions">
            <button type="button" className={buttonStyles({ variant: 'secondary', size: 'sm' })} disabled={analyzing || learning} onClick={() => void runAnalysis()}>
              <Wand2 className="h-3 w-3" aria-hidden />{analyzing ? 'Discovering…' : 'Discover locally'}
            </button>
            <button type="button" className={buttonStyles({ variant: 'secondary', size: 'sm' })} disabled={learning || analyzing || !canLearn} title={learnHint ?? undefined} onClick={() => void learnWithAi()}>
              <Sparkles className="h-3 w-3" aria-hidden />{learning ? 'Learning…' : 'Learn with AI'}
            </button>
            <button type="button" className={buttonStyles({ variant: adding ? 'ghost' : 'primary', size: 'sm' })} onClick={() => setAdding((open) => !open)}>
              {adding ? <X className="h-3 w-3" aria-hidden /> : <Plus className="h-3 w-3" aria-hidden />}{adding ? 'Close' : 'Add memory'}
            </button>
          </div>
          {learnHint && !learning ? <p className="intel-hint">{learnHint}</p> : null}
          {feedback && <p className="profile-brain-feedback" role="status">{feedback}</p>}

          {adding && (
            <AddMemoryForm
              projectId={projectId}
              projectName={projectId ? projectNames.get(projectId) : undefined}
              onCancel={() => setAdding(false)}
              onSave={async (draft) => {
                await createMemory(draft)
                setAdding(false)
                setFeedback('Memory saved.')
              }}
            />
          )}

          {memories.length > 0 && (
            <>
              <label className="intel-search">
                <Search aria-hidden />
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search memories" aria-label="Search memories" />
                {query ? <button type="button" onClick={() => setQuery('')} aria-label="Clear search"><X aria-hidden /></button> : null}
              </label>
              <div className="intel-chips" aria-label="Filter by topic">
                <button type="button" className={cn(!category && 'is-active')} onClick={() => setCategory(null)}>All <span>{memories.length}</span></button>
                {categories.map(([name, count]) => (
                  <button key={name} type="button" className={cn(category === name && 'is-active')} onClick={() => setCategory((current) => (current === name ? null : name))}>
                    <i style={{ background: memoryCategoryColor(name) }} />{name} <span>{count}</span>
                  </button>
                ))}
              </div>
              {visible.length === 0 ? (
                <p className="intel-hint">No memory matches this filter.</p>
              ) : (
                <ul className="intel-list" ref={listRef}>
                  {visible.map((memory) => (
                    <MemoryRow
                      key={memory.id}
                      memory={memory}
                      selected={selectedId === memory.id}
                      scopeLabel={memory.scope === 'project' ? projectNames.get(memory.projectId ?? '') ?? 'Project' : 'Everywhere'}
                      onSelect={() => setSelectedId((current) => (current === memory.id ? null : memory.id))}
                      onToggle={(enabled) => void updateMemory(memory.id, { enabled })}
                      onSave={(content) => updateMemory(memory.id, { content })}
                      onDelete={() => {
                        if (!window.confirm('Delete this memory?')) return
                        void deleteMemory(memory.id)
                        if (selectedId === memory.id) setSelectedId(null)
                      }}
                    />
                  ))}
                </ul>
              )}
            </>
          )}
        </section>
      ) : (
        <section className="intel-section" role="tabpanel">
          <SkillList />
        </section>
      )}

      <DailyLearnCard active={active} />
      <button type="button" className="intelligence-profile-link" onClick={onOpenProfile}>
        <span><strong>Developer Profile</strong><small>Insights, prompts, and sessions</small></span>
        <ChevronRight className="h-4 w-4" aria-hidden />
      </button>
    </div>
  )
}

function MemoryRow({
  memory,
  selected,
  scopeLabel,
  onSelect,
  onToggle,
  onSave,
  onDelete
}: {
  memory: DeveloperMemory
  selected: boolean
  scopeLabel: string
  onSelect: () => void
  onToggle: (enabled: boolean) => void
  onSave: (content: string) => Promise<void>
  onDelete: () => void
}): React.JSX.Element {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(memory.content)
  const color = memoryCategoryColor(memory.category)

  useEffect(() => {
    if (!editing) setDraft(memory.content)
  }, [editing, memory.content])

  const save = async (): Promise<void> => {
    const next = draft.trim()
    if (next && next !== memory.content) await onSave(next)
    setEditing(false)
  }

  return (
    <li
      data-memory-id={memory.id}
      className={cn('intel-memory', selected && 'is-selected', !memory.enabled && 'is-off')}
      style={{ '--memory-color': color } as React.CSSProperties}
    >
      <div className="intel-memory-meta">
        <span className="intel-memory-tag"><i />{memory.category}</span>
        <span>{scopeLabel}</span>
        <span>{memory.source === 'user' ? 'Added by you' : `Seen ${memory.evidenceCount}×`}</span>
        <Toggle checked={memory.enabled} onChange={onToggle} ariaLabel={memory.enabled ? 'Turn memory off' : 'Turn memory on'} />
      </div>
      {editing ? (
        <div className="intel-memory-edit">
          <textarea value={draft} onChange={(event) => setDraft(event.target.value)} rows={3} maxLength={600} autoFocus aria-label="Edit memory" />
          <div>
            <button type="button" className={buttonStyles({ variant: 'primary', size: 'sm' })} disabled={!draft.trim()} onClick={() => void save()}>
              <Check className="h-3 w-3" aria-hidden />Save
            </button>
            <button type="button" className={buttonStyles({ variant: 'ghost', size: 'sm' })} onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <button type="button" className="intel-memory-body" onClick={onSelect} aria-pressed={selected}>
          {memory.content}
        </button>
      )}
      {selected && !editing && (
        <div className="intel-memory-foot">
          <span>Formed {formatDateTime(memory.firstSeenAt)} · last seen {formatDateTime(memory.lastSeenAt)}</span>
          <button type="button" onClick={() => setEditing(true)} aria-label="Edit memory"><Pencil aria-hidden /></button>
          <button type="button" onClick={onDelete} aria-label="Delete memory"><Trash2 aria-hidden /></button>
        </div>
      )}
    </li>
  )
}

function AddMemoryForm({
  projectId,
  projectName,
  onCancel,
  onSave
}: {
  projectId: string | null
  projectName: string | undefined
  onCancel: () => void
  onSave: (draft: { scope: MemoryScope; projectId?: string; category: string; content: string }) => Promise<void>
}): React.JSX.Element {
  const [category, setCategory] = useState<string>(MEMORY_CATEGORIES[0])
  const [scope, setScope] = useState<MemoryScope>('global')
  const [content, setContent] = useState('')
  const [error, setError] = useState<string | null>(null)

  const submit = async (): Promise<void> => {
    const text = content.trim()
    if (text.length < 4) return
    setError(null)
    try {
      await onSave({ scope, ...(scope === 'project' && projectId ? { projectId } : {}), category, content: text })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save this memory.')
    }
  }

  return (
    <form className="intel-add" onSubmit={(event) => { event.preventDefault(); void submit() }}>
      <textarea value={content} onChange={(event) => setContent(event.target.value)} rows={3} maxLength={600} autoFocus
        placeholder="I prefer small PRs with tests next to the change." aria-label="Memory text" />
      <div className="intel-add-row">
        <select value={category} onChange={(event) => setCategory(event.target.value)} aria-label="Topic">
          {MEMORY_CATEGORIES.map((name) => <option key={name} value={name}>{name}</option>)}
        </select>
        <select value={scope} onChange={(event) => setScope(event.target.value as MemoryScope)} aria-label="Where it applies">
          <option value="global">Everywhere</option>
          {projectId ? <option value="project">Only {projectName ?? 'this project'}</option> : null}
        </select>
      </div>
      {error ? <p className="profile-brain-feedback" role="alert">{error}</p> : null}
      <div className="intel-add-row">
        <button type="submit" className={buttonStyles({ variant: 'primary', size: 'sm' })} disabled={content.trim().length < 4}>Save memory</button>
        <button type="button" className={buttonStyles({ variant: 'ghost', size: 'sm' })} onClick={onCancel}>Cancel</button>
      </div>
    </form>
  )
}
