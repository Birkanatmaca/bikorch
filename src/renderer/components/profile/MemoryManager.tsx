import { useEffect, useMemo, useState } from 'react'
import { Bot, BrainCircuit, Pencil, Plus, Sparkles, Trash2, UserRound, X } from 'lucide-react'
import {
  MEMORY_CATEGORIES,
  type DeveloperMemory,
  type MemoryDraft,
  type MemoryScope
} from '@shared/contracts/developer-intelligence'
import { useDeveloperIntelligenceStore } from '@renderer/stores/developer-intelligence-store'
import { useWorkspaceStore } from '@renderer/stores/workspace-store'
import { useSecretaryStore } from '@renderer/stores/secretary-store'
import { buttonStyles } from '@renderer/components/ui/Button'
import { cn } from '@renderer/lib/utils'
import { SectionCard, Toggle } from './ProfilePrimitives'
import { MemoryBrain } from './MemoryBrain'

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
          <h3 className="min-w-0 flex-1">Anıyı düzenle</h3>
          <button
            type="button"
            onClick={onClose}
            className={buttonStyles({ variant: 'ghost', size: 'icon-sm' })}
            aria-label="Anı formunu kapat"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="profile-form-fields">
          <div className="profile-form-row">
            <label>
              <span>Kapsam</span>
              <select value={scope} onChange={(event) => setScope(event.target.value as MemoryScope)}>
                <option value="global">Genel</option>
                <option value="project" disabled={projects.length === 0}>Proje</option>
              </select>
            </label>
            <label>
              <span>Kategori</span>
              <select value={category} onChange={(event) => setCategory(event.target.value)}>
                {MEMORY_CATEGORIES.map((item) => (
                  <option key={item} value={item}>{item}</option>
                ))}
              </select>
            </label>
          </div>
          {scope === 'project' && (
            <label>
            <span>Proje</span>
              <select value={projectId} onChange={(event) => setProjectId(event.target.value)}>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>{project.name}</option>
                ))}
              </select>
            </label>
          )}
          <label>
            <span>Anı</span>
            <textarea
              value={content}
              onChange={(event) => setContent(event.target.value)}
              placeholder="Seni anlatan bir bilgi veya tercih"
              rows={4}
              maxLength={2000}
              required
            />
          </label>
        </div>
        <div className="profile-form-actions">
          <button type="button" onClick={onClose} className={buttonStyles()}>Vazgeç</button>
          <button type="submit" className={buttonStyles({ variant: 'primary' })} disabled={saving}>
            Kaydet
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
        aria-label="Anı kapsamı"
      >
        <option value="global">Genel</option>
        <option value="project" disabled={projects.length === 0}>Proje</option>
      </select>
      {scope === 'project' && (
        <select
          value={projectId}
          onChange={(event) => setProjectId(event.target.value)}
          aria-label="Anı projesi"
        >
          {projects.map((project) => (
            <option key={project.id} value={project.id}>{project.name}</option>
          ))}
        </select>
      )}
      <select
        value={category}
        onChange={(event) => setCategory(event.target.value)}
        aria-label="Anı kategorisi"
      >
        {MEMORY_CATEGORIES.map((item) => (
          <option key={item} value={item}>{item}</option>
        ))}
      </select>
      <input
        value={content}
        onChange={(event) => setContent(event.target.value)}
        placeholder={category === 'About me' ? 'Örn. Adım Birkan; ürün geliştiricisiyim…' : 'Bir tercih veya gerçek ekle…'}
        maxLength={2000}
        aria-label="Yeni anı"
      />
      <button
        type="submit"
        className={buttonStyles({ variant: 'ghost', size: 'icon-sm' })}
        disabled={saving || !content.trim()}
        aria-label="Anı ekle"
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
  const setSection = useDeveloperIntelligenceStore((state) => state.setSection)
  const projects = useWorkspaceStore((state) => state.projects)
  const activeProjectId = useWorkspaceStore((state) => state.activeProjectId)
  const [editing, setEditing] = useState<DeveloperMemory | null>(null)
  const [filter, setFilter] = useState<MemoryFilter>('all')
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
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

  useEffect(() => {
    void loadContextPreview({
      ...(activeProjectId ? { projectId: activeProjectId } : {}),
      limit: 6
    })
  }, [activeProjectId, memories, loadContextPreview])

  const projectNames = useMemo(() => new Map(projects.map((project) => [project.id, project.name])), [projects])
  const aiCount = memories.filter((memory) => memory.source === 'ai').length
  const scopeVisible = useMemo(() => {
    return memories.filter((memory) => {
      if (filter === 'global') return memory.scope === 'global'
      if (filter === 'project') return memory.scope === 'project'
      if (filter === 'you') return memory.source === 'user'
      if (filter === 'ai') return memory.source === 'ai'
      return true
    })
  }, [memories, filter])
  const visible = useMemo(() => scopeVisible.filter((memory) => !selectedCategory || memory.category === selectedCategory), [scopeVisible, selectedCategory])
  const selected = memories.find((memory) => memory.id === selectedId) ?? null
  const canLearn = secretarySettings.configured && settings.savePromptHistory && settings.analyzePromptsWithAi

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
    setFeedback(null)
    const result = await analyzeMemories(
      projects.map((project) => ({ id: project.id, name: project.name, folderPath: project.folderPath }))
    )
    setFeedback(result ? `${result.created} yeni, ${result.updated} güncellenen anı` : 'Yerel keşif tamamlanamadı.')
  }

  const learnWithAi = async (): Promise<void> => {
    setLearning(true)
    setFeedback(null)
    try {
      const result = await window.api.developerIntelligence.learnMemoriesWithAi()
      await Promise.all([loadMemories(), useSecretaryStore.getState().load()])
      setFeedback(`${result.analyzedPrompts} prompt incelendi · ${result.created} yeni anı, ${result.updated} güncelleme`)
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'AI öğrenme tamamlanamadı.')
    } finally {
      setLearning(false)
    }
  }

  const filters: Array<{ id: MemoryFilter; label: string }> = [
    { id: 'all', label: 'Tümü' },
    { id: 'global', label: 'Genel' },
    { id: 'project', label: 'Proje' },
    { id: 'you', label: 'Sen' },
    { id: 'ai', label: 'AI' }
  ]

  return (
    <>
      <section className="profile-brain-shell">
        <div className="profile-brain-heading">
          <div className="profile-brain-heading-icon"><BrainCircuit aria-hidden="true" /></div>
          <div>
            <span className="profile-brain-eyebrow">DEVELOPER INTELLIGENCE</span>
            <h3>Memory Brain</h3>
            <p>Çalışma tarzın, tercihlerin ve projelerin tek haritada.</p>
          </div>
        </div>
        <div className="profile-brain-metrics">
          <span><strong>{memories.length}</strong> anı</span>
          <span><strong>{new Set(memories.map((memory) => memory.category)).size}</strong> bağlantı kümesi</span>
          <span className={cn('profile-brain-key-status', secretarySettings.configured && 'is-connected')}>
            <i />{secretarySettings.configured ? 'Anahtar kayıtlı' : 'Anahtar yok'}
          </span>
        </div>
        <MemoryBrain
          memories={scopeVisible}
          selectedId={selectedId}
          selectedCategory={selectedCategory}
          onSelectMemory={setSelectedId}
          onSelectCategory={setSelectedCategory}
        />
        <div className="profile-brain-legend">
          <span><i className="is-user" /> Senin eklediğin</span>
          <span><i className="is-ai" /> AI keşfi</span>
          <span><i className="is-off" /> Kapalı</span>
        </div>
        {selected && (
          <div className="profile-brain-detail">
            <div className="profile-brain-detail-top">
              <span className="profile-prompt-tag">{selected.category}</span>
              <span>{selected.scope === 'project' ? projectNames.get(selected.projectId ?? '') ?? 'Proje' : 'Genel'}</span>
              <button type="button" onClick={() => setSelectedId(null)} aria-label="Seçimi kapat"><X aria-hidden="true" /></button>
            </div>
            <p>{selected.content}</p>
            <div className="profile-brain-detail-actions">
              <span>{selected.source === 'ai' ? `AI keşfi · %${Math.round(selected.confidence * 100)} güven` : 'Senin eklediğin anı'}</span>
              <button type="button" onClick={() => setEditing(selected)} aria-label="Anıyı düzenle"><Pencil aria-hidden="true" /></button>
              <button type="button" onClick={() => {
                if (window.confirm('Bu anı silinsin mi?')) {
                  void deleteMemory(selected.id)
                  setSelectedId(null)
                }
              }} aria-label="Anıyı sil"><Trash2 aria-hidden="true" /></button>
            </div>
          </div>
        )}
        <div className="profile-brain-controls">
          <Toggle
            checked={settings.includeMemoryInPrompts}
            onChange={(value) => void updateSettings({ includeMemoryInPrompts: value })}
            label="Sekreter ve CLI bu anıları kullansın"
          />
          <p>{settings.includeMemoryInPrompts
            ? `${contextPreview?.memories.length ?? 0} uygun anı bu projede bağlama girebilir. Yalnızca etkin anılar paylaşılır.`
            : 'Kapalıyken anılar sadece bu cihazda kalır; Sekreter’e veya CLI’a eklenmez.'}</p>
        </div>
        <div className="profile-brain-actions">
          <button type="button" className={buttonStyles({ variant: 'secondary', size: 'sm' })} disabled={analyzing || learning} onClick={() => void runAnalysis()}>
            {analyzing ? 'Keşfediliyor…' : 'Yerel keşif'}
          </button>
          <button type="button" className={buttonStyles({ variant: 'secondary', size: 'sm' })} disabled={learning || analyzing || !canLearn} onClick={() => void learnWithAi()}>
            <Sparkles className="h-3 w-3" aria-hidden="true" />{learning ? 'Öğreniyor…' : 'AI ile öğren'}
          </button>
        </div>
        {!canLearn && <p className="profile-brain-note">AI öğrenme için Sekreter API anahtarı ile Gizlilik bölümündeki “Prompt text” ve “Analyze with AI” izinleri gerekli. <button type="button" onClick={() => setSection(secretarySettings.configured ? 'privacy' : 'secretary')}>Ayarları aç</button></p>}
        {canLearn && <p className="profile-brain-note">“AI ile öğren” seçildiğinde yalnızca saklanan, gizli bilgileri temizlenmiş promptlar API’ye gönderilir.</p>}
        {feedback && <p className="profile-brain-feedback" role="status">{feedback}</p>}
      </section>

      <SectionCard title="Anı kütüphanesi" description="Düğümleri incele, tercihlerini elle ekle veya düzelt." className="mt-2.5">
        <MemoryComposer />

        {memories.length > 0 && (
          <div className="profile-memory-filters" role="group" aria-label="Anı filtreleri">
            {filters.map((item) => (
              <button
                key={item.id}
                type="button"
                aria-pressed={filter === item.id}
                className={cn('profile-seg-btn', filter === item.id && 'is-active')}
                onClick={() => setFilter(item.id)}
              >
                {item.label}
              </button>
            ))}
            {selectedCategory && <button type="button" className="profile-seg-btn is-active" onClick={() => setSelectedCategory(null)}>{selectedCategory} ×</button>}
            {aiCount > 0 && (
              <button
                type="button"
                className="profile-seg-btn profile-seg-danger"
                onClick={() => {
                  if (window.confirm(`${aiCount} AI anısı silinsin mi?`)) void clear('ai-memories')
                }}
              >
                AI anılarını sil
              </button>
            )}
          </div>
        )}

        {visible.length === 0 ? (
          <div className="profile-empty-state">
            {memories.length === 0
              ? (analysis ? 'Henüz anı yok.' : 'Bir anı ekle veya yerel keşfi çalıştır.')
              : 'Bu filtrede anı yok.'}
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
