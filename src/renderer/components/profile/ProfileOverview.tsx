import {
  Bot,
  CheckSquare,
  FolderKanban,
  GitCommitHorizontal,
  MessageSquareText,
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
  UNAVAILABLE
} from './profile-format'
import { KeyValueList, SectionCard, Sparkline, StatCard } from './ProfilePrimitives'

export function ProfileOverview(): React.JSX.Element {
  const metrics = useDeveloperIntelligenceStore((state) => state.metrics)
  const loading = useDeveloperIntelligenceStore((state) => state.metricsLoading)
  const error = useDeveloperIntelligenceStore((state) => state.metricsError)
  const settings = useDeveloperIntelligenceStore((state) => state.settings)
  const subscriptions = useSubscriptionStore((state) => state.subscriptions)

  if (!metrics && loading) {
    return <div className="profile-empty-state">Loading…</div>
  }
  if (!metrics) {
    return <div className="profile-empty-state">{error ?? 'No data yet'}</div>
  }

  const { overview, activity } = metrics
  const nothingRecorded =
    overview.promptsSent === 0 && overview.sessions === 0 && overview.commits === 0 && overview.tasksCompleted === 0
  const tokensReady = overview.totalTokens.availability === 'measured'

  return (
    <>
      {!settings.keepActivityHistory && (
        <div className="profile-notice">History is off</div>
      )}

      <div className="profile-stat-grid">
        <StatCard
          icon={MessageSquareText}
          label="Prompts"
          value={formatCount(overview.promptsSent)}
          delta={formatDelta(overview.promptsDeltaPercent)}
        />
        <StatCard
          icon={TerminalSquare}
          label="Sessions"
          value={formatCount(overview.sessions)}
          delta={formatDelta(overview.sessionsDeltaPercent)}
        />
        <StatCard icon={FolderKanban} label="Projects" value={formatCount(overview.activeProjects)} />
        <StatCard icon={Bot} label="Agents" value={formatCount(overview.providersUsed)} />
        <StatCard icon={GitCommitHorizontal} label="Commits" value={formatCount(overview.commits)} />
        <StatCard icon={CheckSquare} label="Tasks" value={formatCount(overview.tasksCompleted)} />
      </div>

      {nothingRecorded ? (
        <div className="profile-empty-state mt-2.5">No activity in this range</div>
      ) : (
        <SectionCard title="Activity" className="mt-2.5">
          <Sparkline points={activity.dailyPrompts} label="Prompts" />
          <KeyValueList
            items={[
              {
                label: 'Avg prompt',
                value: formatMeasured(overview.averagePromptChars, (value) => `${formatCount(Math.round(value))} ch`)
              },
              {
                label: 'Avg session',
                value: formatMeasured(overview.averageSessionDurationMs, formatDuration)
              },
              { label: 'Peak', value: overview.mostActivePeriod ?? UNAVAILABLE },
              { label: 'Last', value: formatDateTime(activity.lastActivityAt) },
              {
                label: 'Top agent',
                value: metrics.workflow.mostUsedAgent ? providerLabel(metrics.workflow.mostUsedAgent) : UNAVAILABLE
              }
            ]}
          />
        </SectionCard>
      )}

      {tokensReady && (
        <SectionCard title="Tokens" className="mt-2.5">
          <div className="profile-cost-grid">
            <div>
              <span>Total</span>
              <strong>{formatMeasured(overview.totalTokens)}</strong>
            </div>
            <div>
              <span>Input</span>
              <strong>{formatMeasured(overview.inputTokens)}</strong>
            </div>
            <div>
              <span>Output</span>
              <strong>{formatMeasured(overview.outputTokens)}</strong>
            </div>
            <div>
              <span>Cached</span>
              <strong>{formatMeasured(overview.cachedTokens)}</strong>
            </div>
          </div>
        </SectionCard>
      )}

      <SectionCard title="Spend" className="mt-2.5">
        <div className="profile-cost-grid">
          <div>
            <span>Subscriptions</span>
            <strong>{monthlySubscriptionLabel(subscriptions)}</strong>
          </div>
          <div>
            <span>API</span>
            <strong>{formatMeasured(overview.apiSpendUsd, (value) => `$${value.toFixed(2)}`)}</strong>
          </div>
          <div>
            <span>Limit used</span>
            <strong>
              {formatMeasured(overview.averagePrimaryLimitUsed, (value) => `${Math.round(value)}%`)}
            </strong>
          </div>
        </div>
      </SectionCard>
    </>
  )
}
