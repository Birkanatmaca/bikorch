import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronUp, Search, ShieldAlert, Trash2 } from 'lucide-react'
import {
  PROMPT_SOURCES,
  WORK_CATEGORIES,
  type PromptRecord,
  type PromptSource,
  type WorkCategory
} from '@shared/contracts/developer-intelligence'
import { AI_ACCOUNT_KINDS } from '@shared/contracts/accounts'
import { useDeveloperIntelligenceStore } from '@renderer/stores/developer-intelligence-store'
import { useWorkspaceStore } from '@renderer/stores/workspace-store'
import { buttonStyles } from '@renderer/components/ui/Button'
import { cn } from '@renderer/lib/utils'
import { formatRelativeDay, languageLabel, providerLabel } from './profile-format'
import { SectionCard } from './ProfilePrimitives'

const PAGE_SIZE = 50

function PromptRow({
  record,
  projectName,
  selected,
  onToggleSelect,
  onDelete
}: {
  record: PromptRecord
  projectName: string | undefined
  selected: boolean
  onToggleSelect: () => void
  onDelete: () => void
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const isLong = record.prompt.length > 220 || record.prompt.includes('\n')
  const preview = expanded || !isLong ? record.prompt : `${record.prompt.slice(0, 220).trimEnd()}…`

  return (
    <article className={cn('profile-prompt-row', selected && 'profile-prompt-row-selected')}>
      <div className="profile-prompt-meta">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelect}
          aria-label="Select prompt"
          className="profile-checkbox"
        />
        <span className="profile-prompt-provider">{providerLabel(record.provider)}</span>
        {record.category && <span className="profile-prompt-tag">{record.category}</span>}
        <span className="profile-prompt-time">{formatRelativeDay(record.createdAt)}</span>
      </div>
      <pre className="profile-prompt-text">{preview}</pre>
      <div className="profile-prompt-footer">
        <span className="truncate">
          {projectName ?? 'No project'} · {record.source}
          {record.languageHints && record.languageHints.length > 0
            ? ` · ${record.languageHints.map(languageLabel).join(', ')}`
            : ''}
          {record.redactedCount > 0 ? ` · ${record.redactedCount} redacted` : ''}
        </span>
        <span className="flex shrink-0 items-center gap-0.5">
          {isLong && (
            <button
              type="button"
              onClick={() => setExpanded((value) => !value)}
              className={buttonStyles({ variant: 'ghost', size: 'icon-sm' })}
              aria-label={expanded ? 'Collapse prompt' : 'Expand prompt'}
              title={expanded ? 'Collapse' : 'Expand'}
            >
              {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </button>
          )}
          <button
            type="button"
            onClick={onDelete}
            className={buttonStyles({ variant: 'ghost', size: 'icon-sm' })}
            aria-label="Delete prompt"
            title="Delete prompt"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </span>
      </div>
    </article>
  )
}

export function PromptHistory(): React.JSX.Element {
  const settings = useDeveloperIntelligenceStore((state) => state.settings)
  const updateSettings = useDeveloperIntelligenceStore((state) => state.updateSettings)
  const prompts = useDeveloperIntelligenceStore((state) => state.prompts)
  const loading = useDeveloperIntelligenceStore((state) => state.promptsLoading)
  const filter = useDeveloperIntelligenceStore((state) => state.promptFilter)
  const setPromptFilter = useDeveloperIntelligenceStore((state) => state.setPromptFilter)
  const loadPrompts = useDeveloperIntelligenceStore((state) => state.loadPrompts)
  const deletePrompts = useDeveloperIntelligenceStore((state) => state.deletePrompts)
  const activityVersion = useDeveloperIntelligenceStore((state) => state.activityVersion)
  const projects = useWorkspaceStore((state) => state.projects)

  const [search, setSearch] = useState(filter.search ?? '')
  const [datePreset, setDatePreset] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const projectNames = useMemo(() => new Map(projects.map((project) => [project.id, project.name])), [projects])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if ((filter.search ?? '') !== search) setPromptFilter({ ...filter, search: search || undefined, offset: 0 })
    }, 250)
    return () => window.clearTimeout(timer)
  }, [search, filter, setPromptFilter])

  useEffect(() => {
    void loadPrompts()
  }, [filter, activityVersion, loadPrompts])

  const offset = filter.offset ?? 0
  const hasPrevious = offset > 0
  const hasNext = offset + prompts.items.length < prompts.total

  const toggleSelected = (id: string): void => {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const removeIds = async (ids: string[]): Promise<void> => {
    await deletePrompts(ids)
    setSelected(new Set())
  }

  return (
    <>
      {!settings.savePromptHistory && (
        <div className="profile-notice profile-notice-warning">
          <ShieldAlert className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1">
            Prompt text is not being saved. Prompt counts still work; enable retention to search your
            prompts here.
          </span>
          <button
            type="button"
            className={buttonStyles({ variant: 'secondary', size: 'sm' })}
            onClick={() => void updateSettings({ savePromptHistory: true })}
          >
            Enable
          </button>
        </div>
      )}

      <SectionCard
        title="Prompt history"
        description={`${prompts.total} stored · secrets redacted before saving`}
        chip={<span className="profile-measurement-chip">Local</span>}
      >
        <div className="profile-filter-grid">
          <label className="profile-search">
            <Search className="h-3 w-3" aria-hidden />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search prompt text…"
              aria-label="Search prompts"
            />
          </label>
          <select
            value={filter.provider ?? ''}
            onChange={(event) => setPromptFilter({ ...filter, provider: event.target.value || undefined, offset: 0 })}
            aria-label="Filter by provider"
          >
            <option value="">All providers</option>
            {AI_ACCOUNT_KINDS.map((kind) => (
              <option key={kind} value={kind}>{providerLabel(kind)}</option>
            ))}
          </select>
          <select
            value={filter.projectId ?? ''}
            onChange={(event) => setPromptFilter({ ...filter, projectId: event.target.value || undefined, offset: 0 })}
            aria-label="Filter by project"
          >
            <option value="">All projects</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>{project.name}</option>
            ))}
          </select>
          <select
            value={filter.category ?? ''}
            onChange={(event) =>
              setPromptFilter({ ...filter, category: (event.target.value || undefined) as WorkCategory | undefined, offset: 0 })
            }
            aria-label="Filter by category"
          >
            <option value="">All categories</option>
            {WORK_CATEGORIES.map((category) => (
              <option key={category} value={category}>{category}</option>
            ))}
          </select>
          <select
            value={filter.source ?? ''}
            onChange={(event) =>
              setPromptFilter({ ...filter, source: (event.target.value || undefined) as PromptSource | undefined, offset: 0 })
            }
            aria-label="Filter by source"
          >
            <option value="">All sources</option>
            {PROMPT_SOURCES.map((source) => (
              <option key={source} value={source}>{source}</option>
            ))}
          </select>
          <select
            value={datePreset}
            onChange={(event) => {
              setDatePreset(event.target.value)
              const days = Number(event.target.value)
              setPromptFilter({
                ...filter,
                from: days > 0 ? Date.now() - days * 24 * 60 * 60 * 1000 : undefined,
                offset: 0
              })
            }}
            aria-label="Filter by date"
          >
            <option value="">Any date</option>
            <option value="1">Last 24 hours</option>
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
          </select>
        </div>

        <div className="profile-list-toolbar">
          <span className="text-[9px] text-text-muted">
            {loading ? 'Loading…' : `Showing ${prompts.items.length === 0 ? 0 : offset + 1}–${offset + prompts.items.length} of ${prompts.total}`}
          </span>
          <span className="flex items-center gap-1">
            {selected.size > 0 && (
              <button
                type="button"
                className={buttonStyles({ variant: 'danger', size: 'sm' })}
                onClick={() => void removeIds([...selected])}
              >
                <Trash2 className="h-3 w-3" />
                Delete {selected.size}
              </button>
            )}
            {prompts.total > 0 && (
              <button
                type="button"
                className={buttonStyles({ variant: 'ghost', size: 'sm' })}
                onClick={() => {
                  if (window.confirm(`Delete all ${prompts.total} stored prompts? This cannot be undone.`)) {
                    void deletePrompts('all')
                  }
                }}
              >
                Delete all
              </button>
            )}
          </span>
        </div>

        {prompts.items.length === 0 ? (
          <div className="profile-empty-state">
            {loading
              ? 'Loading prompts…'
              : settings.savePromptHistory
                ? 'No prompts match these filters yet. Prompts you send to a CLI agent will show up here.'
                : 'No stored prompts.'}
          </div>
        ) : (
          <div className="profile-prompt-list">
            {prompts.items.map((record) => (
              <PromptRow
                key={record.id}
                record={record}
                projectName={record.projectId ? projectNames.get(record.projectId) : undefined}
                selected={selected.has(record.id)}
                onToggleSelect={() => toggleSelected(record.id)}
                onDelete={() => void removeIds([record.id])}
              />
            ))}
          </div>
        )}

        {(hasPrevious || hasNext) && (
          <div className="profile-list-toolbar">
            <button
              type="button"
              className={buttonStyles({ variant: 'ghost', size: 'sm' })}
              disabled={!hasPrevious}
              onClick={() => setPromptFilter({ ...filter, offset: Math.max(0, offset - PAGE_SIZE) })}
            >
              Previous
            </button>
            <button
              type="button"
              className={buttonStyles({ variant: 'ghost', size: 'sm' })}
              disabled={!hasNext}
              onClick={() => setPromptFilter({ ...filter, offset: offset + PAGE_SIZE })}
            >
              Next
            </button>
          </div>
        )}
      </SectionCard>
    </>
  )
}
