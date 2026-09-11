import { useMemo, useState } from 'react'
import { CalendarClock, Loader2, Pause, Play, Plus } from 'lucide-react'
import {
  AUTOMATION_PERMISSION_PROFILE_LABELS,
  describeAutomationSchedule,
  type AutomationDefinition,
  type AutomationPermissionProfile,
  type AutomationRunStatus,
  type AutomationSchedule,
  type AutomationScheduleKind
} from '@shared/contracts/automation'
import { useAutomationStore } from '@renderer/stores/automation-store'
import { useWorkspaceStore } from '@renderer/stores/workspace-store'
import { EmptyState } from '@renderer/components/ui/EmptyState'
import { Button } from '@renderer/components/ui/Button'
import { cn } from '@renderer/lib/utils'

const SCHEDULE_KIND_LABELS: Record<AutomationScheduleKind, string> = {
  once: 'Once',
  daily: 'Daily',
  weekdays: 'Weekdays',
  weekly: 'Weekly',
  interval: 'Every N minutes',
  cron: 'Advanced (cron)'
}

const RUN_STATUS_LABELS: Record<AutomationRunStatus, string> = {
  queued: 'Queued',
  'waiting-network': 'Waiting for network',
  preparing: 'Preparing',
  running: 'Running',
  'needs-attention': 'Needs attention',
  succeeded: 'Succeeded',
  failed: 'Failed',
  cancelled: 'Cancelled',
  interrupted: 'Interrupted'
}

const DEFAULT_TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone

function formatNextRun(nextRunAt: number | null): string {
  if (nextRunAt === null) return 'Not scheduled'
  return new Date(nextRunAt).toLocaleString()
}

function buildSchedule(
  kind: AutomationScheduleKind,
  localTime: string,
  weekdayFlags: boolean[],
  everyMinutes: number,
  cronExpression: string
): AutomationSchedule {
  switch (kind) {
    case 'once':
      return { kind: 'once', runAt: Date.now() + 5 * 60_000, timeZone: DEFAULT_TIME_ZONE }
    case 'daily':
      return { kind: 'daily', localTime, timeZone: DEFAULT_TIME_ZONE }
    case 'weekdays':
      return { kind: 'weekdays', localTime, timeZone: DEFAULT_TIME_ZONE }
    case 'weekly': {
      const days = weekdayFlags.flatMap((flag, index) => (flag ? [index] : []))
      return {
        kind: 'weekly',
        days: days.length > 0 ? days : [1],
        localTime,
        timeZone: DEFAULT_TIME_ZONE
      }
    }
    case 'interval':
      return { kind: 'interval', everyMinutes: Math.max(5, everyMinutes), anchorAt: Date.now() }
    case 'cron':
      return { kind: 'cron', expression: cronExpression || '0 9 * * *', timeZone: DEFAULT_TIME_ZONE }
  }
}

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function AutomationCreateForm({ onCancel }: { onCancel: () => void }): React.JSX.Element {
  const projects = useWorkspaceStore((state) => state.projects)
  const activeProjectId = useWorkspaceStore((state) => state.activeProjectId)
  const create = useAutomationStore((state) => state.create)

  const [name, setName] = useState('')
  const [projectId, setProjectId] = useState(activeProjectId ?? projects[0]?.id ?? '')
  const [prompt, setPrompt] = useState('')
  const [scheduleKind, setScheduleKind] = useState<AutomationScheduleKind>('daily')
  const [localTime, setLocalTime] = useState('09:00')
  const [weekdayFlags, setWeekdayFlags] = useState<boolean[]>([false, true, false, false, false, false, false])
  const [everyMinutes, setEveryMinutes] = useState(60)
  const [cronExpression, setCronExpression] = useState('0 9 * * *')
  const [permissionProfile, setPermissionProfile] = useState<AutomationPermissionProfile>('observe')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (!name.trim() || !projectId || !prompt.trim()) return
    setSubmitting(true)
    setError(null)
    try {
      await create({
        name: name.trim(),
        projectId,
        prompt: prompt.trim(),
        executorKind: 'codex',
        schedule: buildSchedule(scheduleKind, localTime, weekdayFlags, everyMinutes, cronExpression),
        permissionProfile
      })
      onCancel()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create automation')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 p-3 text-xs">
      <input
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="Automation name"
        maxLength={120}
        className="ui-control ui-control-sm w-full"
        aria-label="Automation name"
        autoFocus
      />

      <select
        value={projectId}
        onChange={(event) => setProjectId(event.target.value)}
        className="ui-control ui-control-sm w-full"
        aria-label="Project"
      >
        {projects.length === 0 ? <option value="">No projects</option> : null}
        {projects.map((project) => (
          <option key={project.id} value={project.id}>
            {project.name}
          </option>
        ))}
      </select>

      <textarea
        value={prompt}
        onChange={(event) => setPrompt(event.target.value)}
        placeholder="What should the agent do each run?"
        maxLength={8000}
        rows={3}
        className="ui-control ui-control-sm w-full resize-none"
        aria-label="Prompt"
      />

      <div className="flex flex-wrap gap-1.5">
        {(Object.keys(SCHEDULE_KIND_LABELS) as AutomationScheduleKind[]).map((kind) => (
          <button
            key={kind}
            type="button"
            onClick={() => setScheduleKind(kind)}
            className={cn(
              'rounded-md border px-2 py-1 text-[11px] transition-colors',
              scheduleKind === kind
                ? 'border-purple-400/40 bg-purple-400/10 text-purple-200'
                : 'border-white/10 text-text-muted hover:text-text-secondary'
            )}
          >
            {SCHEDULE_KIND_LABELS[kind]}
          </button>
        ))}
      </div>

      {(scheduleKind === 'daily' || scheduleKind === 'weekdays' || scheduleKind === 'weekly') && (
        <label className="flex items-center gap-2 text-[11px] text-text-secondary">
          Local time
          <input
            type="time"
            value={localTime}
            onChange={(event) => setLocalTime(event.target.value)}
            className="ui-control ui-control-sm"
          />
        </label>
      )}

      {scheduleKind === 'weekly' && (
        <div className="flex flex-wrap gap-1">
          {DAY_LABELS.map((label, index) => (
            <button
              key={label}
              type="button"
              onClick={() =>
                setWeekdayFlags((flags) => flags.map((flag, i) => (i === index ? !flag : flag)))
              }
              className={cn(
                'rounded px-1.5 py-0.5 text-[10px]',
                weekdayFlags[index]
                  ? 'bg-purple-400/20 text-purple-200'
                  : 'bg-white/5 text-text-muted'
              )}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {scheduleKind === 'interval' && (
        <label className="flex items-center gap-2 text-[11px] text-text-secondary">
          Every
          <input
            type="number"
            min={5}
            value={everyMinutes}
            onChange={(event) => setEveryMinutes(Number(event.target.value) || 60)}
            className="ui-control ui-control-sm w-20"
          />
          minutes
        </label>
      )}

      {scheduleKind === 'cron' && (
        <input
          value={cronExpression}
          onChange={(event) => setCronExpression(event.target.value)}
          placeholder="0 9 * * *"
          className="ui-control ui-control-sm w-full font-mono"
          aria-label="Cron expression"
        />
      )}

      <select
        value={permissionProfile}
        onChange={(event) => setPermissionProfile(event.target.value as AutomationPermissionProfile)}
        className="ui-control ui-control-sm w-full"
        aria-label="Permission profile"
      >
        {(Object.keys(AUTOMATION_PERMISSION_PROFILE_LABELS) as AutomationPermissionProfile[])
          .filter((profile) => profile !== 'full-access')
          .map((profile) => (
            <option key={profile} value={profile}>
              {AUTOMATION_PERMISSION_PROFILE_LABELS[profile]}
            </option>
          ))}
      </select>

      {error ? <p className="text-[11px] text-red-400">{error}</p> : null}

      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" size="sm" disabled={submitting || !name.trim() || !prompt.trim()}>
          {submitting ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Create'}
        </Button>
      </div>
    </form>
  )
}

function AutomationCard({ automation }: { automation: AutomationDefinition }): React.JSX.Element {
  const setEnabled = useAutomationStore((state) => state.setEnabled)
  const runNow = useAutomationStore((state) => state.runNow)
  const loadRuns = useAutomationStore((state) => state.loadRuns)
  const runs = useAutomationStore((state) => state.runsByAutomation[automation.id] ?? [])
  const [expanded, setExpanded] = useState(false)
  const [running, setRunning] = useState(false)

  const handleToggleExpand = (): void => {
    setExpanded((value) => !value)
    if (!expanded) void loadRuns(automation.id)
  }

  const handleRunNow = async (): Promise<void> => {
    setRunning(true)
    try {
      await runNow(automation.id)
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="rounded-lg border border-white/8 bg-white/[0.02] p-3 text-xs">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <button
            type="button"
            onClick={handleToggleExpand}
            className="truncate text-left font-medium text-text-primary hover:text-purple-200"
            title={automation.name}
          >
            {automation.name}
          </button>
          <p className="mt-0.5 truncate text-[11px] text-text-muted">
            {describeAutomationSchedule(automation.schedule)} · {formatNextRun(automation.nextRunAt)}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void setEnabled(automation.id, !automation.enabled)}
          className={cn(
            'shrink-0 rounded-md p-1.5',
            automation.enabled ? 'text-purple-200' : 'text-text-muted'
          )}
          title={automation.enabled ? 'Pause' : 'Enable'}
          aria-label={automation.enabled ? 'Pause automation' : 'Enable automation'}
        >
          {automation.enabled ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
        </button>
      </div>

      <div className="mt-2 flex items-center gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={handleRunNow} disabled={running}>
          {running ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Run now'}
        </Button>
        <button
          type="button"
          onClick={handleToggleExpand}
          className="text-[11px] text-text-muted hover:text-text-secondary"
        >
          {expanded ? 'Hide history' : 'History'}
        </button>
      </div>

      {expanded && (
        <ul className="mt-2 space-y-1 border-t border-white/5 pt-2">
          {runs.length === 0 ? (
            <li className="text-[11px] text-text-muted">No runs yet.</li>
          ) : (
            runs.slice(0, 6).map((run) => (
              <li key={run.id} className="flex items-center justify-between text-[11px]">
                <span className="text-text-secondary">{RUN_STATUS_LABELS[run.status]}</span>
                <span className="text-text-muted">
                  {run.startedAt ? new Date(run.startedAt).toLocaleTimeString() : '—'}
                </span>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  )
}

export function AutomationPanel(): React.JSX.Element {
  const definitions = useAutomationStore((state) => state.definitions)
  const loaded = useAutomationStore((state) => state.loaded)
  const [creating, setCreating] = useState(false)

  const sorted = useMemo(
    () =>
      [...definitions].sort((a, b) => {
        if (a.enabled !== b.enabled) return a.enabled ? -1 : 1
        return (a.nextRunAt ?? Infinity) - (b.nextRunAt ?? Infinity)
      }),
    [definitions]
  )

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between px-3 py-2">
        <p className="text-[11px] font-medium text-text-secondary">
          {definitions.length > 0 ? `${definitions.length} automation${definitions.length === 1 ? '' : 's'}` : 'Automations'}
        </p>
        <Button type="button" variant="secondary" size="sm" onClick={() => setCreating((v) => !v)}>
          <Plus className="h-3 w-3" />
          New
        </Button>
      </div>

      {creating && (
        <div className="shrink-0 border-b border-white/5">
          <AutomationCreateForm onCancel={() => setCreating(false)} />
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto p-2">
        {!loaded ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-4 w-4 animate-spin text-text-muted" />
          </div>
        ) : sorted.length === 0 && !creating ? (
          <EmptyState
            icon={CalendarClock}
            title="Run repeatable AI tasks on a schedule."
            description="Create your first automation."
            action={
              <Button type="button" variant="primary" size="sm" onClick={() => setCreating(true)}>
                New automation
              </Button>
            }
          />
        ) : (
          <div className="flex flex-col gap-2">
            {sorted.map((automation) => (
              <AutomationCard key={automation.id} automation={automation} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
