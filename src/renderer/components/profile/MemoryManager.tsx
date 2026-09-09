import { useEffect, useMemo, useState } from 'react'
import { Bot, Pencil, Plus, Trash2, UserRound, X } from 'lucide-react'
import {
  MEMORY_CATEGORIES,
  type DeveloperMemory,
  type MemoryDraft,
  type MemoryScope
} from '@shared/contracts/developer-intelligence'
import { useDeveloperIntelligenceStore } from '@renderer/stores/developer-intelligence-store'
import { useWorkspaceStore } from '@renderer/stores/workspace-store'
import { buttonStyles } from '@renderer/components/ui/Button'
import { cn } from '@renderer/lib/utils'
import { SectionCard, Toggle } from './ProfilePrimitives'

type MemoryFilter = 'all' | 'global' | 'project' | 'you' | 'ai'

function MemoryForm({
  memory,
  onClose
}: {
  memory: DeveloperMemory
  onClose: () => void
}): React.JSX.Element {
  const projects = useWorkspaceStore((state) => state.projects)
  const updateMemory = useDeveloperIntelligenceStore((state) => state.updateMemory)
  const [scope, setScope] = useState<MemoryScope>(memory.scope)
  const [projectId, setProjectId] = useState(memory.projectId ?? projects[0]?.id ?? '')
  const [category, setCategory] = useState(memory.category)
  const [content, setContent] = useState(memory.content)
  const [saving, setSaving] = useState(false)

  const submit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    const trimmed = content.trim()
    if (!trimmed) return
    if (scope === 'project' && !projectId) return
    setSaving(true)
    try {
      await updateMemory(memory.id, {
        scope,
        ...(scope === 'project' ? { projectId } : {}),
        category,
        content: trimmed
      })
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="profile-form-overlay">
      <form onSubmit={(event) => void submit(event)} className="profile-subscription-form">
        <div className="profile-form-heading">
          <h3 className="min-w-0 flex-1">Edit memory</h3>
          <button
            type="button"
            onClick={onClose}
            className={buttonStyles({ variant: 'ghost', size: 'icon-sm' })}
            aria-label="Close memory form"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="profile-form-fields">
          <div className="profile-form-row">
            <label>
              <span>Scope</span>
              <select value={scope} onChange={(event) => setScope(event.target.value as MemoryScope)}>
                <option value="global">Global</option>
                <option value="project" disabled={projects.length === 0}>Project</option>
              </select>
            </label>
            <label>
              <span>Category</span>
              <select value={category} onChange={(event) => setCategory(event.target.value)}>
                {MEMORY_CATEGORIES.map((item) => (
                  <option key={item} value={item}>{item}</option>
                ))}
              </select>
            </label>
          </div>
          {scope === 'project' && (
            <label>
              <span>Project</span>
              <select value={projectId} onChange={(event) => setProjectId(event.target.value)}>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>{project.name}</option>
                ))}
              </select>
            </label>
          )}
          <label>
            <span>Memory</span>
            <textarea
              value={content}
              onChange={(event) => setContent(event.target.value)}
              placeholder="A preference or fact"
              rows={4}
              maxLength={2000}
              required
            />
          </label>
        </div>
        <div className="profile-form-actions">
          <button type="button" onClick={onClose} className={buttonStyles()}>Cancel</button>
          <button type="submit" className={buttonStyles({ variant: 'primary' })} disabled={saving}>
            Save
          </button>
        </div>
      </form>
    </div>
  )
}

function MemoryComposer(): React.JSX.Element {
  const projects = useWorkspaceStore((state) => state.projects)
  const activeProjectId = useWorkspaceStore((state) => state.activeProjectId)
  const createMemory = useDeveloperIntelligenceStore((state) => state.createMemory)
  const [scope, setScope] = useState<MemoryScope>('global')
  const [projectId, setProjectId] = useState(activeProjectId ?? projects[0]?.id ?? '')
  const [category, setCategory] = useState<string>(MEMORY_CATEGORIES[0])
  const [content, setContent] = useState('')
  const [saving, setSaving] = useState(false)

  const submit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    const trimmed = content.trim()
    if (!trimmed) return
    if (scope === 'project' && !projectId) return
    setSaving(true)
    try {
      const draft: MemoryDraft = {
        scope,
        ...(scope === 'project' ? { projectId } : {}),
        category,
        content: trimmed
      }
      await createMemory(draft)
      setContent('')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="profile-memory-composer">
      <select
        value={scope}
        onChange={(event) => setScope(event.target.value as MemoryScope)}
        aria-label="Memory scope"
      >
        <option value="global">Global</option>
        <option value="project" disabled={projects.length === 0}>Project</option>
      </select>
      {scope === 'project' && (
        <select
          value={projectId}
          onChange={(event) => setProjectId(event.target.value)}
          aria-label="Memory project"
        >
          {projects.map((project) => (
            <option key={project.id} value={project.id}>{project.name}</option>
          ))}
        </select>
      )}
      <select
        value={category}
        onChange={(event) => setCategory(event.target.value)}
        aria-label="Memory category"
      >
        {MEMORY_CATEGORIES.map((item) => (
          <option key={item} value={item}>{item}</option>
        ))}
      </select>
      <input
        value={content}
        onChange={(event) => setContent(event.target.value)}
        placeholder="A preference or fact"
        maxLength={2000}
        aria-label="New memory"
      />
      <button
        type="submit"
        className={buttonStyles({ variant: 'ghost', size: 'icon-sm' })}
        disabled={saving || !content.trim()}
        aria-label="Add memory"
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
    </form>
  )
}

function MemoryRow({
  memory,
  projectName,
  onEdit,
  onDelete,
  onToggle
}: {
  memory: DeveloperMemory
  projectName: string | undefined
  onEdit: () => void
  onDelete: () => void
  onToggle: (enabled: boolean) => void
}): React.JSX.Element {
  const SourceIcon = memory.source === 'ai' ? Bot : UserRound
  const sourceLabel = memory.source === 'ai'
    ? `AI · ${Math.round(memory.confidence * 100)}%`
    : 'You'
  return (
    <article className={cn('profile-memory-row', !memory.enabled && 'profile-memory-disabled')}>
      <div className="profile-memory-head">
        <span className="profile-prompt-tag">{memory.category}</span>
        <span className="profile-prompt-provider">
          {memory.scope === 'project' ? projectName ?? 'Project' : 'Global'}
        </span>
        <span className="profile-memory-source" title={sourceLabel}>
          <SourceIcon className="h-3 w-3" aria-hidden />
          {sourceLabel}
        </span>
      </div>
      <p className="profile-memory-content">{memory.content}</p>
      <div className="profile-memory-row-actions">
        <span className="flex shrink-0 items-center gap-1">
          <Toggle
            checked={memory.enabled}
            onChange={onToggle}
            ariaLabel={memory.enabled ? 'Disable memory' : 'Enable memory'}
          />
          <button type="button" onClick={onEdit} className={buttonStyles({ variant: 'ghost', size: 'icon-sm' })} aria-label="Edit memory" title="Edit">
            <Pencil className="h-3 w-3" />
          </button>
          <button type="button" onClick={onDelete} className={buttonStyles({ variant: 'ghost', size: 'icon-sm' })} aria-label="Delete memory" title="Delete">
            <Trash2 className="h-3 w-3" />
          </button>
        </span>
      </div>
    </article>
  )
}

export function MemoryManager(): React.JSX.Element {
  const memories = useDeveloperIntelligenceStore((state) => state.memories)
  const memoriesLoaded = useDeveloperIntelligenceStore((state) => state.memoriesLoaded)
  const loadMemories = useDeveloperIntelligenceStore((state) => state.loadMemories)
  const updateMemory = useDeveloperIntelligenceStore((state) => state.updateMemory)
  const deleteMemory = useDeveloperIntelligenceStore((state) => state.deleteMemory)
  const clear = useDeveloperIntelligenceStore((state) => state.clear)
  const analysis = useDeveloperIntelligenceStore((state) => state.analysis)
  const analyzing = useDeveloperIntelligenceStore((state) => state.analysisLoading)
  const analyzeMemories = useDeveloperIntelligenceStore((state) => state.analyzeMemories)
  const contextPreview = useDeveloperIntelligenceStore((state) => state.contextPreview)
  const loadContextPreview = useDeveloperIntelligenceStore((state) => state.loadContextPreview)
  const settings = useDeveloperIntelligenceStore((state) => state.settings)
  const updateSettings = useDeveloperIntelligenceStore((state) => state.updateSettings)
  const projects = useWorkspaceStore((state) => state.projects)
  const activeProjectId = useWorkspaceStore((state) => state.activeProjectId)
  const [editing, setEditing] = useState<DeveloperMemory | null>(null)
  const [filter, setFilter] = useState<MemoryFilter>('all')

  useEffect(() => {
    if (!memoriesLoaded) void loadMemories()
  }, [memoriesLoaded, loadMemories])

  useEffect(() => {
    void loadContextPreview({
      ...(activeProjectId ? { projectId: activeProjectId } : {}),
      limit: 6
    })
  }, [activeProjectId, memories, loadContextPreview])

  const projectNames = useMemo(() => new Map(projects.map((project) => [project.id, project.name])), [projects])
  const aiCount = memories.filter((memory) => memory.source === 'ai').length
  const visible = useMemo(() => {
    return memories.filter((memory) => {
      if (filter === 'global') return memory.scope === 'global'
      if (filter === 'project') return memory.scope === 'project'
      if (filter === 'you') return memory.source === 'user'
      if (filter === 'ai') return memory.source === 'ai'
      return true
    })
  }, [memories, filter])

  const groups = useMemo(() => {
    const buckets = new Map<string, DeveloperMemory[]>()
    for (const memory of visible) {
      const key = memory.scope === 'global' ? 'global' : memory.projectId ?? 'project'
      const list = buckets.get(key) ?? []
      list.push(memory)
      buckets.set(key, list)
    }
    const keys = [...buckets.keys()].sort((a, b) => {
      if (a === 'global') return -1
      if (b === 'global') return 1
      if (a === activeProjectId) return -1
      if (b === activeProjectId) return 1
      return (projectNames.get(a) ?? a).localeCompare(projectNames.get(b) ?? b)
    })
    return keys.map((key) => ({
      key,
      label: key === 'global' ? 'Global' : projectNames.get(key) ?? 'Project',
      items: (buckets.get(key) ?? []).slice().sort((a, b) => Number(b.enabled) - Number(a.enabled) || b.lastSeenAt - a.lastSeenAt)
    }))
  }, [visible, activeProjectId, projectNames])

  const runAnalysis = async (): Promise<void> => {
    await analyzeMemories(
      projects.map((project) => ({ id: project.id, name: project.name, folderPath: project.folderPath }))
    )
  }

  const filters: Array<{ id: MemoryFilter; label: string }> = [
    { id: 'all', label: 'All' },
    { id: 'global', label: 'Global' },
    { id: 'project', label: 'Project' },
    { id: 'you', label: 'You' },
    { id: 'ai', label: 'AI' }
  ]

  return (
    <>
      <SectionCard
        title="Memory"
        action={
          <button
            type="button"
            className={buttonStyles({ variant: 'secondary', size: 'sm' })}
            disabled={analyzing}
            onClick={() => void runAnalysis()}
          >
            {analyzing ? 'Updating…' : 'Update'}
          </button>
        }
      >
        <div className="profile-memory-use">
          <Toggle
            checked={settings.includeMemoryInPrompts}
            onChange={(value) => void updateSettings({ includeMemoryInPrompts: value })}
            label="Use in CLI"
          />
        </div>
        <MemoryComposer />

        {contextPreview && contextPreview.memories.length > 0 && (
          <div className={cn('profile-memory-inject', !settings.includeMemoryInPrompts && 'is-off')}>
            <p>
              {settings.includeMemoryInPrompts
                ? `CLI prompts get ${contextPreview.memories.length}`
                : `Would add ${contextPreview.memories.length} to CLI prompts`}
            </p>
            <ul>
              {contextPreview.memories.map((item) => (
                <li key={item.id}>
                  <span className="profile-prompt-tag">{item.category}</span>
                  <span>{item.content}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {memories.length > 0 && (
          <div className="profile-memory-filters" role="tablist" aria-label="Memory filters">
            {filters.map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={filter === item.id}
                className={cn('profile-seg-btn', filter === item.id && 'is-active')}
                onClick={() => setFilter(item.id)}
              >
                {item.label}
              </button>
            ))}
            {aiCount > 0 && (
              <button
                type="button"
                className="profile-seg-btn profile-seg-danger"
                onClick={() => {
                  if (window.confirm(`Remove all ${aiCount} AI-generated memories?`)) void clear('ai-memories')
                }}
              >
                Clear AI
              </button>
            )}
          </div>
        )}

        {visible.length === 0 ? (
          <div className="profile-empty-state">
            {memories.length === 0
              ? (analysis ? 'None' : 'Add one, or Update from local activity')
              : 'None'}
          </div>
        ) : (
          <div className="profile-memory-list">
            {groups.map((group) => (
              <section key={group.key} className="profile-memory-group">
                {groups.length > 1 && <h4>{group.label}</h4>}
                {group.items.map((memory) => (
                  <MemoryRow
                    key={memory.id}
                    memory={memory}
                    projectName={memory.projectId ? projectNames.get(memory.projectId) : undefined}
                    onEdit={() => setEditing(memory)}
                    onDelete={() => {
                      if (window.confirm('Delete this memory?')) void deleteMemory(memory.id)
                    }}
                    onToggle={(enabled) => void updateMemory(memory.id, { enabled })}
                  />
                ))}
              </section>
            ))}
          </div>
        )}
      </SectionCard>

      {editing && <MemoryForm memory={editing} onClose={() => setEditing(null)} />}
    </>
  )
}
