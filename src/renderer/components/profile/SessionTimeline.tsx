import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, ShieldAlert } from 'lucide-react'
import type { AgentSessionDetail, AgentSessionSummary, SessionCloseReason } from '@shared/contracts/developer-intelligence'
import { useDeveloperIntelligenceStore } from '@renderer/stores/developer-intelligence-store'
import { useWorkspaceStore } from '@renderer/stores/workspace-store'
import { buttonStyles } from '@renderer/components/ui/Button'
import { cn } from '@renderer/lib/utils'
import { formatDuration, formatRelativeDay, providerLabel } from './profile-format'
import { SectionCard } from './ProfilePrimitives'

const PAGE_SIZE = 40

function closeStatusLabel(
  stillOpen: boolean,
  closeReason: SessionCloseReason | undefined,
  exitCode: number | null | undefined
): string {
  if (stillOpen) return 'Still open'
  if (closeReason === 'exited') {
    return typeof exitCode === 'number' ? `Process exited (${exitCode})` : 'Process exited'
  }
  if (closeReason === 'error') return 'Failed to start'
  return 'Panel closed'
}

function SessionRow({
  session,
  projectName,
  selected,
  onSelect
}: {
  session: AgentSessionSummary
  projectName: string | undefined
  selected: boolean
  onSelect: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn('profile-session-row', selected && 'profile-session-row-selected')}
    >
      <div className="profile-prompt-meta">
        <span className="profile-prompt-provider">{providerLabel(session.kind)}</span>
        <span className={cn('profile-prompt-tag', session.stillOpen && 'profile-session-open')}>
          {closeStatusLabel(session.stillOpen, session.closeReason, undefined)}
        </span>
        <span className="profile-prompt-time">{formatRelativeDay(session.startedAt)}</span>
      </div>
      <div className="profile-session-summary">
        {formatDuration(session.durationMs)}
        {' · '}
        {session.promptCount} prompt{session.promptCount === 1 ? '' : 's'}
        {session.fileCount > 0 ? ` · ${session.fileCount} file${session.fileCount === 1 ? '' : 's'}` : ''}
        {session.commitCount > 0 ? ` · ${session.commitCount} commit${session.commitCount === 1 ? '' : 's'}` : ''}
        {projectName ? ` · ${projectName}` : ''}
      </div>
    </button>
  )
}

function SessionDetail({
  detail,
  projectName,
  onBack
}: {
  detail: AgentSessionDetail
  projectName: string | undefined
  onBack: () => void
}): React.JSX.Element {
  return (
    <SectionCard
      title={providerLabel(detail.kind)}
      description={`${formatRelativeDay(detail.startedAt)} · ${formatDuration(detail.durationMs)}`}
      action={
        <button
          type="button"
          className={buttonStyles({ variant: 'ghost', size: 'sm' })}
          onClick={onBack}
        >
          <ArrowLeft className="h-3 w-3" />
          Back
        </button>
      }
    >
      <dl className="profile-kv-list">
        <div className="profile-kv-row">
          <dt>Status</dt>
          <dd>{closeStatusLabel(detail.stillOpen, detail.closeReason, detail.exitCode)}</dd>
        </div>
        {projectName && (
          <div className="profile-kv-row">
            <dt>Project</dt>
            <dd>{projectName}</dd>
          </div>
        )}
      </dl>

      <h4 className="profile-subheading">Prompts</h4>
      {!detail.promptTextAvailable ? (
        <p className="profile-empty-state">
          {detail.promptCount} prompt{detail.promptCount === 1 ? '' : 's'} · text not saved
        </p>
      ) : detail.prompts.length === 0 ? (
        <p className="profile-empty-state">None</p>
      ) : (
        <ol className="profile-session-prompts">
          {detail.prompts.map((prompt, index) => (
            <li key={prompt.id}>
              <span className="profile-session-index">{index + 1}</span>
              <pre className="profile-prompt-text">{prompt.prompt || '(empty)'}</pre>
            </li>
          ))}
        </ol>
      )}

      <h4 className="profile-subheading">Injected memory</h4>
      {detail.injectedContext.length === 0 ? (
        <p className="profile-empty-state">None</p>
      ) : (
        <ul className="profile-session-context">
          {detail.injectedContext.map((item, index) => (
            <li key={`${item.category}-${index}`}>
              <span className="profile-prompt-tag">{item.category}</span>
              <span>{item.preview}</span>
            </li>
          ))}
        </ul>
      )}

      <h4 className="profile-subheading">Changed files</h4>
      {detail.changedFiles.length === 0 ? (
        <p className="profile-empty-state">None in the isolated copy</p>
      ) : (
        <ul className="profile-session-files">
          {detail.changedFiles.map((file) => (
            <li key={file}>{file}</li>
          ))}
        </ul>
      )}

      <h4 className="profile-subheading">Commits</h4>
      {detail.commits.length === 0 ? (
        <p className="profile-empty-state">None in this session</p>
      ) : (
        <ul className="profile-session-commits">
          {detail.commits.map((commit) => (
            <li key={commit.shortHash}>
              <code>{commit.shortHash}</code>
              <span>{commit.subject}</span>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  )
}

export function SessionTimeline(): React.JSX.Element {
  const settings = useDeveloperIntelligenceStore((state) => state.settings)
  const updateSettings = useDeveloperIntelligenceStore((state) => state.updateSettings)
  const sessions = useDeveloperIntelligenceStore((state) => state.sessions)
  const loading = useDeveloperIntelligenceStore((state) => state.sessionsLoading)
  const filter = useDeveloperIntelligenceStore((state) => state.sessionFilter)
  const setSessionFilter = useDeveloperIntelligenceStore((state) => state.setSessionFilter)
  const loadSessions = useDeveloperIntelligenceStore((state) => state.loadSessions)
  const getSession = useDeveloperIntelligenceStore((state) => state.getSession)
  const activityVersion = useDeveloperIntelligenceStore((state) => state.activityVersion)
  const projects = useWorkspaceStore((state) => state.projects)

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<AgentSessionDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  const projectNames = useMemo(
    () => new Map(projects.map((project) => [project.id, project.name])),
    [projects]
  )

  useEffect(() => {
    void loadSessions()
  }, [filter, activityVersion, loadSessions])

  useEffect(() => {
    if (!selectedId) {
      setDetail(null)
      return
    }
    let cancelled = false
    setDetailLoading(true)
    void getSession(selectedId).then((next) => {
      if (cancelled) return
      setDetail(next)
      setDetailLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [selectedId, activityVersion, getSession])

  const offset = filter.offset ?? 0
  const hasPrevious = offset > 0
  const hasNext = offset + sessions.items.length < sessions.total

  if (selectedId) {
    return (
      <>
        {detailLoading && !detail ? (
          <div className="profile-empty-state">Loading…</div>
        ) : detail ? (
          <SessionDetail
            detail={detail}
            projectName={detail.projectId ? projectNames.get(detail.projectId) : undefined}
            onBack={() => setSelectedId(null)}
          />
        ) : (
          <SectionCard title="Session">
            <p className="profile-empty-state">This session is no longer available.</p>
            <button
              type="button"
              className={buttonStyles({ variant: 'ghost', size: 'sm' })}
              onClick={() => setSelectedId(null)}
            >
              Back
            </button>
          </SectionCard>
        )}
      </>
    )
  }

  return (
    <>
      {!settings.keepActivityHistory && (
        <div className="profile-notice profile-notice-warning">
          <ShieldAlert className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1">Activity history is off — sessions are not recorded</span>
          <button
            type="button"
            className={buttonStyles({ variant: 'secondary', size: 'sm' })}
            onClick={() => void updateSettings({ keepActivityHistory: true })}
          >
            Enable
          </button>
        </div>
      )}

      <SectionCard
        title="Sessions"
        description="Agent runs: kind, prompts, injected memory, files, commits, and how the panel closed. Agent output is never stored."
      >
        <div className="profile-filter-grid">
          <select
            value={filter.projectId ?? ''}
            onChange={(event) =>
              setSessionFilter({ ...filter, projectId: event.target.value || undefined, offset: 0 })
            }
            aria-label="Filter by project"
          >
            <option value="">All projects</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </div>

        <div className="profile-list-toolbar">
          <span className="text-[9px] text-text-muted">
            {loading
              ? 'Loading…'
              : `Showing ${sessions.items.length === 0 ? 0 : offset + 1}–${offset + sessions.items.length} of ${sessions.total}`}
          </span>
        </div>

        {sessions.items.length === 0 ? (
          <div className="profile-empty-state">{loading ? 'Loading…' : 'None yet'}</div>
        ) : (
          <div className="profile-prompt-list">
            {sessions.items.map((session) => (
              <SessionRow
                key={session.id}
                session={session}
                projectName={session.projectId ? projectNames.get(session.projectId) : undefined}
                selected={false}
                onSelect={() => setSelectedId(session.id)}
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
              onClick={() => setSessionFilter({ ...filter, offset: Math.max(0, offset - PAGE_SIZE) })}
            >
              Previous
            </button>
            <button
              type="button"
              className={buttonStyles({ variant: 'ghost', size: 'sm' })}
              disabled={!hasNext}
              onClick={() => setSessionFilter({ ...filter, offset: offset + PAGE_SIZE })}
            >
              Next
            </button>
          </div>
        )}
      </SectionCard>
    </>
  )
}
