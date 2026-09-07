import { useEffect, useMemo, useState } from 'react'
import { Bot, Brain, Pencil, Plus, Trash2, UserRound, X } from 'lucide-react'
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
import { formatDateTime } from './profile-format'
import { SectionCard, Toggle } from './ProfilePrimitives'

function MemoryForm({
  memory,
  onClose
}: {
  memory: DeveloperMemory | null
  onClose: () => void
}): React.JSX.Element {
  const projects = useWorkspaceStore((state) => state.projects)
  const activeProjectId = useWorkspaceStore((state) => state.activeProjectId)
  const createMemory = useDeveloperIntelligenceStore((state) => state.createMemory)
  const updateMemory = useDeveloperIntelligenceStore((state) => state.updateMemory)
  const [scope, setScope] = useState<MemoryScope>(memory?.scope ?? 'global')
  const [projectId, setProjectId] = useState(memory?.projectId ?? activeProjectId ?? projects[0]?.id ?? '')
  const [category, setCategory] = useState(memory?.category ?? MEMORY_CATEGORIES[0])
  const [content, setContent] = useState(memory?.content ?? '')
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
      if (memory) await updateMemory(memory.id, draft)
      else await createMemory(draft)
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="profile-form-overlay">
      <form onSubmit={(event) => void submit(event)} className="profile-subscription-form">
        <div className="profile-form-heading">
          <div className="profile-panel-icon"><Brain className="h-3.5 w-3.5" /></div>
          <div className="min-w-0 flex-1">
            <h3>{memory ? 'Edit memory' : 'New memory'}</h3>
            <p>A preference or fact future agents may be offered as context.</p>
          </div>
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
              placeholder="Prefers TypeScript strict mode and small React components."
              rows={4}
              maxLength={2000}
              required
            />
          </label>
        </div>
        <div className="profile-form-actions">
          <button type="button" onClick={onClose} className={buttonStyles()}>Cancel</button>
          <button type="submit" className={buttonStyles({ variant: 'primary' })} disabled={saving}>
            {memory ? 'Save memory' : 'Add memory'}
          </button>
        </div>
      </form>
    </div>
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
  return (
    <article className={cn('profile-memory-row', !memory.enabled && 'profile-memory-disabled')}>
      <div className="profile-memory-head">
        <span className="profile-prompt-tag">{memory.category}</span>
        <span className="profile-prompt-provider">
          {memory.scope === 'project' ? projectName ?? 'Project' : 'Global'}
        </span>
        <span className="profile-memory-source" title={memory.source === 'ai' ? 'AI-generated' : 'Added by you'}>
          <SourceIcon className="h-3 w-3" aria-hidden />
          {memory.source === 'ai' ? `AI · ${Math.round(memory.confidence * 100)}% · ${memory.evidenceCount} evidence` : 'You'}
        </span>
      </div>
      <p className="profile-memory-content">{memory.content}</p>
      <div className="profile-prompt-footer">
        <span className="truncate">Updated {formatDateTime(memory.lastSeenAt)}</span>
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
  const settings = useDeveloperIntelligenceStore((state) => state.settings)
  const stats = useDeveloperIntelligenceStore((state) => state.stats)
  const analysis = useDeveloperIntelligenceStore((state) => state.analysis)
  const analyzing = useDeveloperIntelligenceStore((state) => state.analysisLoading)
  const analyzeMemories = useDeveloperIntelligenceStore((state) => state.analyzeMemories)
  const contextPreview = useDeveloperIntelligenceStore((state) => state.contextPreview)
  const contextLoading = useDeveloperIntelligenceStore((state) => state.contextLoading)
  const loadContextPreview = useDeveloperIntelligenceStore((state) => state.loadContextPreview)
  const projects = useWorkspaceStore((state) => state.projects)
  const activeProjectId = useWorkspaceStore((state) => state.activeProjectId)
  const [form, setForm] = useState<DeveloperMemory | null | undefined>(undefined)
  const [contextProjectId, setContextProjectId] = useState(activeProjectId ?? projects[0]?.id ?? '')
  const [contextQuery, setContextQuery] = useState('')
  const [copyMessage, setCopyMessage] = useState<string | null>(null)

  useEffect(() => {
    if (!memoriesLoaded) void loadMemories()
  }, [memoriesLoaded, loadMemories])

  const projectNames = useMemo(() => new Map(projects.map((project) => [project.id, project.name])), [projects])
  const aiCount = memories.filter((memory) => memory.source === 'ai').length
  const enabledCount = memories.filter((memory) => memory.enabled).length

  const runAnalysis = async (): Promise<void> => {
    await analyzeMemories(
      projects.map((project) => ({ id: project.id, name: project.name, folderPath: project.folderPath }))
    )
  }

  const runPreview = async (): Promise<void> => {
    await loadContextPreview({
      ...(contextProjectId ? { projectId: contextProjectId } : {}),
      ...(contextQuery.trim() ? { query: contextQuery.trim() } : {})
    })
  }

  const copyPreview = async (): Promise<void> => {
    if (!contextPreview || contextPreview.memories.length === 0) return
    const text = contextPreview.memories.map((item) => `- [${item.category}] ${item.content}`).join('\n')
    try {
      await navigator.clipboard.writeText(text)
      setCopyMessage('Copied context package')
    } catch {
      setCopyMessage('Could not copy')
    }
  }

  return (
    <>
      <SectionCard
        title="Developer memory"
        description={`${memories.length} memories · ${enabledCount} enabled · ${aiCount} AI-generated`}
        action={
          <button type="button" onClick={() => setForm(null)} className={buttonStyles({ variant: 'secondary', size: 'sm' })}>
            <Plus className="h-3 w-3" />
            Add
          </button>
        }
      >
        {memories.length === 0 ? (
          <div className="profile-empty-state">
            No memories yet. Add one, or run local analysis after you have some prompt, session or Git activity.
          </div>
        ) : (
          <div className="profile-memory-list">
            {memories.map((memory) => (
              <MemoryRow
                key={memory.id}
                memory={memory}
                projectName={memory.projectId ? projectNames.get(memory.projectId) : undefined}
                onEdit={() => setForm(memory)}
                onDelete={() => {
                  if (window.confirm('Delete this memory?')) void deleteMemory(memory.id)
                }}
                onToggle={(enabled) => void updateMemory(memory.id, { enabled })}
              />
            ))}
          </div>
        )}
        {aiCount > 0 && (
          <div className="profile-list-toolbar">
            <span className="text-[9px] text-text-muted">AI-generated memories are interpretations, not facts.</span>
            <button
              type="button"
              className={buttonStyles({ variant: 'ghost', size: 'sm' })}
              onClick={() => {
                if (window.confirm(`Remove all ${aiCount} AI-generated memories?`)) void clear('ai-memories')
              }}
            >
              Clear AI memories
            </button>
          </div>
        )}
      </SectionCard>

      <SectionCard
        title="Local analysis"
        description="Turns recorded activity into reviewable memory candidates on this computer"
        className="mt-2.5"
        action={
          <button
            type="button"
            className={buttonStyles({ variant: 'secondary', size: 'sm' })}
            disabled={analyzing}
            onClick={() => void runAnalysis()}
          >
            {analyzing ? 'Updating…' : 'Update from activity'}
          </button>
        }
      >
        {analysis ? (
          <p className="profile-basis mt-2">
            Last run {formatDateTime(analysis.lastRunAt)} · {analysis.created} created · {analysis.updated} updated
            {analysis.skipped > 0 ? ` · ${analysis.skipped} previously dismissed` : ''}.
            External model analysis is unavailable in this build
            {settings.analyzePromptsWithAi ? ' even though the opt-in is on' : ''}.
          </p>
        ) : (
          <p className="profile-basis mt-2">
            Analysis runs locally from metrics, Git files and (when enabled) stored prompt text.
            It also runs in the background after enough new activity. Generated memories stay off
            until you review them — they start enabled so you can disable or delete any you disagree with.
          </p>
        )}
        {stats?.lastAnalysisAt && !analysis && (
          <p className="profile-basis">Last automatic run {formatDateTime(stats.lastAnalysisAt)}.</p>
        )}
      </SectionCard>

      <SectionCard
        title="Context preview"
        description="What would be offered to an agent for the current project"
        className="mt-2.5"
      >
        <div className="profile-filter-grid">
          <select
            value={contextProjectId}
            onChange={(event) => setContextProjectId(event.target.value)}
            aria-label="Context project"
          >
            <option value="">No project (global only)</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>{project.name}</option>
            ))}
          </select>
          <input
            className="profile-search"
            value={contextQuery}
            onChange={(event) => setContextQuery(event.target.value)}
            placeholder="Optional topic, e.g. React"
            aria-label="Context query"
          />
        </div>
        <div className="profile-list-toolbar">
          <span className="text-[9px] text-text-muted">
            {settings.includeMemoryInPrompts
              ? 'Injection is opted in; terminals do not auto-insert this yet.'
              : 'Injection is off — preview only.'}
          </span>
          <span className="flex gap-1">
            <button
              type="button"
              className={buttonStyles({ variant: 'secondary', size: 'sm' })}
              disabled={contextLoading}
              onClick={() => void runPreview()}
            >
              {contextLoading ? 'Loading…' : 'Preview'}
            </button>
            <button
              type="button"
              className={buttonStyles({ variant: 'ghost', size: 'sm' })}
              disabled={!contextPreview || contextPreview.memories.length === 0}
              onClick={() => void copyPreview()}
            >
              Copy
            </button>
          </span>
        </div>
        {contextPreview && (
          contextPreview.memories.length === 0 ? (
            <div className="profile-empty-state">No enabled memories match this project and query.</div>
          ) : (
            <>
              <ul className="profile-context-list">
                {contextPreview.memories.map((item) => (
                  <li key={item.id}>
                    <span className="profile-prompt-tag">{item.category}</span>
                    <span>{item.content}</span>
                  </li>
                ))}
              </ul>
              <p className="profile-basis">
                ~{contextPreview.tokenEstimate} tokens · {contextPreview.characterCount} characters
                {contextPreview.truncated ? ' · truncated to the context budget' : ''}
              </p>
            </>
          )
        )}
        {copyMessage && <p className="profile-basis">{copyMessage}</p>}
      </SectionCard>

      {form !== undefined && <MemoryForm memory={form} onClose={() => setForm(undefined)} />}
    </>
  )
}
