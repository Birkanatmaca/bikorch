import {
  Activity,
  Bot,
  CalendarDays,
  CheckSquare,
  CircleDollarSign,
  Clock3,
  Coins,
  FolderKanban,
  GitCommitHorizontal,
  Gauge,
  MessageSquareText,
  Ruler,
  TerminalSquare
} from 'lucide-react'
import { useDeveloperIntelligenceStore } from '@renderer/stores/developer-intelligence-store'
import { useSubscriptionStore } from '@renderer/stores/subscription-store'
import {
  formatCount,
  formatDateTime,
  formatDelta,
  formatDuration,
  formatMeasured,
  monthlySubscriptionLabel,
  providerLabel,
  totalAiSpendLabel,
  UNAVAILABLE
} from './profile-format'
import { AvailabilityChip, KeyValueList, SectionCard, Sparkline, StatCard } from './ProfilePrimitives'

export function ProfileOverview(): React.JSX.Element {
  const metrics = useDeveloperIntelligenceStore((state) => state.metrics)
  const loading = useDeveloperIntelligenceStore((state) => state.metricsLoading)
  const error = useDeveloperIntelligenceStore((state) => state.metricsError)
  const settings = useDeveloperIntelligenceStore((state) => state.settings)
  const subscriptions = useSubscriptionStore((state) => state.subscriptions)

  if (!metrics && loading) {
    return <div className="profile-empty-state">Computing metrics from local history…</div>
  }
  if (!metrics) {
    return (
      <div className="profile-empty-state">
        {error ?? 'Metrics are unavailable until the local database is ready.'}
      </div>
    )
  }

  const { overview, activity } = metrics
  const nothingRecorded =
    overview.promptsSent === 0 && overview.sessions === 0 && overview.commits === 0 && overview.tasksCompleted === 0

  return (
    <>
      {!settings.keepActivityHistory && (
        <div className="profile-notice">
          Activity history is turned off. Metrics only reflect previously recorded events.
        </div>
      )}

      <div className="profile-stat-grid">
        <StatCard
          icon={MessageSquareText}
          label="Prompts sent"
          value={formatCount(overview.promptsSent)}
          delta={formatDelta(overview.promptsDeltaPercent)}
        />
        <StatCard
          icon={TerminalSquare}
          label="Agent sessions"
          value={formatCount(overview.sessions)}
          delta={formatDelta(overview.sessionsDeltaPercent)}
        />
        <StatCard icon={FolderKanban} label="Active projects" value={formatCount(overview.activeProjects)} />
        <StatCard icon={Bot} label="AI providers used" value={formatCount(overview.providersUsed)} />
        <StatCard icon={GitCommitHorizontal} label="Commits" value={formatCount(overview.commits)} />
        <StatCard icon={CheckSquare} label="Tasks completed" value={formatCount(overview.tasksCompleted)} />
      </div>

      {nothingRecorded && (
        <div className="profile-empty-state mt-2.5">
          No activity recorded in this range yet. Open a CLI agent, send a prompt or commit from the
          Changes panel and the numbers here will fill in.
        </div>
      )}

      <SectionCard
        title="Activity"
        description="Prompts per day in the selected range"
        className="mt-2.5"
        chip={<span className="profile-measurement-chip">Local</span>}
      >
        <Sparkline points={activity.dailyPrompts} label="Prompts per day" />
        <KeyValueList
          items={[
            {
              label: 'Average prompt size',
              value: formatMeasured(overview.averagePromptChars, (value) => `${formatCount(Math.round(value))} chars`)
            },
            {
              label: 'Average session duration',
              value: formatMeasured(overview.averageSessionDurationMs, formatDuration)
            },
            { label: 'Most active period', value: overview.mostActivePeriod ?? UNAVAILABLE },
            { label: 'Last activity', value: formatDateTime(activity.lastActivityAt) },
            {
              label: 'Most used agent',
              value: metrics.workflow.mostUsedAgent ? providerLabel(metrics.workflow.mostUsedAgent) : UNAVAILABLE
            }
          ]}
        />
      </SectionCard>

      <SectionCard
        title="Tokens"
        description="Only shown when an official provider source reports them"
        className="mt-2.5"
        chip={<AvailabilityChip availability={overview.totalTokens.availability} />}
      >
        <div className="profile-cost-grid">
          <div>
            <span>Total tokens</span>
            <strong>{formatMeasured(overview.totalTokens)}</strong>
          </div>
          <div>
            <span>Input tokens</span>
            <strong>{formatMeasured(overview.inputTokens)}</strong>
          </div>
          <div>
            <span>Output tokens</span>
            <strong>{formatMeasured(overview.outputTokens)}</strong>
          </div>
          <div>
            <span>Cached tokens</span>
            <strong>{formatMeasured(overview.cachedTokens)}</strong>
          </div>
        </div>
        <p className="profile-cost-note">
          CLI terminals are not token meters. Token counts are never estimated from terminal output.
        </p>
      </SectionCard>

      <SectionCard title="Spend" description="Subscriptions and metered API usage are tracked separately" className="mt-2.5">
        <div className="profile-cost-grid">
          <div>
            <Coins className="h-3 w-3" aria-hidden />
            <span>Subscription spend</span>
            <strong>{monthlySubscriptionLabel(subscriptions)}</strong>
          </div>
          <div className="profile-cost-unavailable">
            <CircleDollarSign className="h-3 w-3" aria-hidden />
            <span>Estimated / API spend</span>
            <strong>{formatMeasured(overview.apiSpendUsd, (value) => `$${value.toFixed(2)}`)}</strong>
          </div>
          <div className="profile-cost-unavailable">
            <Ruler className="h-3 w-3" aria-hidden />
            <span>Total AI spend</span>
            <strong>{totalAiSpendLabel(subscriptions, overview.apiSpendUsd, metrics.range.key)}</strong>
          </div>
          <div>
            <Gauge className="h-3 w-3" aria-hidden />
            <span>Average primary limit used</span>
            <strong>
              {formatMeasured(overview.averagePrimaryLimitUsed, (value) => `${Math.round(value)}%`)}
            </strong>
          </div>
        </div>
        <p className="profile-cost-note">
          Total spend combines manual subscription records with API costs recorded on prompts in this
          range. Usage averages come from locally recorded usage snapshots.
        </p>
      </SectionCard>

      <div className="profile-privacy-note">
        <Activity className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span>
          Counts are measured from locally recorded events.
          Nothing is sent anywhere.
        </span>
      </div>
      <div className="profile-last-activity">
        <CalendarDays className="h-3 w-3" aria-hidden />
        <span>Computed</span>
        <strong>{formatDateTime(metrics.computedAt)}</strong>
        <Clock3 className="ml-1 h-3 w-3" aria-hidden />
      </div>
    </>
  )
}
