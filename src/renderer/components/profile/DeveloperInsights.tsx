import { Info } from 'lucide-react'
import { useDeveloperIntelligenceStore } from '@renderer/stores/developer-intelligence-store'
import { cn } from '@renderer/lib/utils'
import {
  formatCount,
  formatMeasured,
  languageLabel,
  providerLabel,
  UNAVAILABLE
} from './profile-format'
import { DistributionBars, KeyValueList, SectionCard } from './ProfilePrimitives'

export function DeveloperInsights(): React.JSX.Element {
  const metrics = useDeveloperIntelligenceStore((state) => state.metrics)
  const loading = useDeveloperIntelligenceStore((state) => state.metricsLoading)
  const settings = useDeveloperIntelligenceStore((state) => state.settings)

  if (!metrics) {
    return (
      <div className="profile-empty-state">
        {loading ? 'Computing insights from local history…' : 'Insights are unavailable until the local database is ready.'}
      </div>
    )
  }

  const { languages, frameworks, workCategories, workflow } = metrics
  const disabledSources = [
    !settings.useGitActivity ? 'Git activity' : null,
    !settings.useProjectFileContext ? 'project files' : null
  ].filter((value): value is string => Boolean(value))

  return (
    <>
      {metrics.interpretations.length > 0 && (
        <SectionCard
          title="Interpretations"
          description="Local readings of the numbers below — not facts"
          chip={<span className="profile-measurement-chip">Heuristic</span>}
        >
          <ul className="profile-interpretation-list">
            {metrics.interpretations.map((item) => (
              <li key={item.text}>
                <p>{item.text}</p>
                <small>{item.basis}</small>
              </li>
            ))}
          </ul>
        </SectionCard>
      )}

      <SectionCard
        title="Language activity distribution"
        description="Share of activity per language — not a skill level"
        chip={<span className="profile-measurement-chip">Heuristic</span>}
        className={metrics.interpretations.length > 0 ? 'mt-2.5' : undefined}
      >
        <DistributionBars
          entries={languages.entries}
          labelFor={languageLabel}
          emptyLabel="No language evidence yet. Commit files from the Changes panel or keep project file context enabled."
        />
        {languages.basis.length > 0 && (
          <p className="profile-basis">
            Based on: {languages.basis.join(' · ')}
            {languages.unknownPercent > 0 ? ` · ${languages.unknownPercent}% unclassified` : ''}
          </p>
        )}
        {disabledSources.length > 0 && (
          <p className="profile-basis">Excluded by your privacy settings: {disabledSources.join(', ')}.</p>
        )}
      </SectionCard>

      <SectionCard
        title="Frameworks & technologies"
        description="Evidence from project manifests and prompt mentions"
        className="mt-2.5"
      >
        {frameworks.length === 0 ? (
          <div className="profile-empty-state">No framework evidence in this range.</div>
        ) : (
          <div className="profile-chip-list">
            {frameworks.map((framework) => (
              <span
                key={framework.name}
                className={cn('profile-chip', `profile-chip-${framework.confidence}`)}
                title={`${framework.evidenceCount} evidence · ${framework.sources.join(', ')}`}
              >
                {framework.name}
                <small>{framework.confidence}</small>
              </span>
            ))}
          </div>
        )}
        <p className="profile-basis">Confidence reflects how many independent signals agree, not expertise.</p>
      </SectionCard>

      <SectionCard
        title="Main activity"
        description="Work categories inferred from prompts and commit messages"
        className="mt-2.5"
        chip={<span className="profile-measurement-chip">Heuristic</span>}
      >
        <DistributionBars entries={workCategories.entries} />
        <p className="profile-basis">{workCategories.basis}</p>
      </SectionCard>

      <SectionCard title="AI workflow" description="How agents, projects and outcomes line up" className="mt-2.5">
        <KeyValueList
          items={[
            {
              label: 'Most used agent',
              value: workflow.mostUsedAgent ? providerLabel(workflow.mostUsedAgent) : UNAVAILABLE
            },
            { label: 'Most used project', value: workflow.mostUsedProject?.name ?? UNAVAILABLE },
            {
              label: 'Prompts per session',
              value: formatMeasured(workflow.promptsPerSession, (value) => value.toFixed(1))
            },
            {
              label: 'Sessions ending in a commit',
              value: formatMeasured(workflow.sessionsEndingInCommit, (value) => `${Math.round(value)}%`),
              hint: 'Commit within 10 minutes of the session in the same project'
            },
            {
              label: 'Tasks completed during sessions',
              value: formatCount(workflow.tasksCompletedDuringSessions)
            },
            {
              label: 'Common agent sequence',
              value: workflow.commonAgentSequence
                ? workflow.commonAgentSequence.map(providerLabel).join(' → ')
                : UNAVAILABLE,
              hint: 'Most frequent back-to-back pair of agent sessions'
            }
          ]}
        />
        {workflow.providerDistribution.length > 0 && (
          <>
            <h4 className="profile-subheading">Provider usage</h4>
            <DistributionBars entries={workflow.providerDistribution} labelFor={providerLabel} />
          </>
        )}
        {workflow.projectDistribution.length > 0 && (
          <>
            <h4 className="profile-subheading">Project usage</h4>
            <DistributionBars entries={workflow.projectDistribution} />
          </>
        )}
      </SectionCard>

      <div className="profile-privacy-note">
        <Info className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span>
          Every insight here is a local interpretation of recorded activity. Generated memories
          live in the Memory section so you can edit or delete them.
        </span>
      </div>
    </>
  )
}
