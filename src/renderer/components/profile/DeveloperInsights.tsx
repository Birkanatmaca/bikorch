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

function languageBasis(basis: string[]): string | undefined {
  if (basis.length === 0) return undefined
  if (basis.some((item) => item.startsWith('Git'))) return 'From Git changes in this range'
  if (basis.some((item) => item.startsWith('Code'))) return 'From code in prompts'
  if (basis.some((item) => item.startsWith('Project'))) return 'From files in open projects'
  return undefined
}

export function DeveloperInsights(): React.JSX.Element {
  const metrics = useDeveloperIntelligenceStore((state) => state.metrics)
  const loading = useDeveloperIntelligenceStore((state) => state.metricsLoading)

  if (!metrics) {
    return <div className="profile-empty-state">{loading ? 'Loading…' : 'No data yet'}</div>
  }

  const { languages, frameworks, workCategories, workflow } = metrics

  return (
    <>
      <SectionCard title="Languages" description={languageBasis(languages.basis)}>
        <DistributionBars entries={languages.entries} labelFor={languageLabel} emptyLabel="—" />
      </SectionCard>

      <SectionCard title="Stack" className="mt-2.5">
        {frameworks.length === 0 ? (
          <div className="profile-empty-state">—</div>
        ) : (
          <div className="profile-chip-list">
            {frameworks.map((framework) => (
              <span
                key={framework.name}
                className={cn('profile-chip', `profile-chip-${framework.confidence}`)}
                title={`${framework.evidenceCount} · ${framework.sources.join(', ')}`}
              >
                {framework.name}
              </span>
            ))}
          </div>
        )}
      </SectionCard>

      <SectionCard title="Work" className="mt-2.5">
        <DistributionBars entries={workCategories.entries} emptyLabel="—" />
      </SectionCard>

      <SectionCard title="Workflow" className="mt-2.5">
        <KeyValueList
          items={[
            {
              label: 'Agent',
              value: workflow.mostUsedAgent ? providerLabel(workflow.mostUsedAgent) : UNAVAILABLE
            },
            { label: 'Project', value: workflow.mostUsedProject?.name ?? UNAVAILABLE },
            {
              label: 'Prompts / session',
              value: formatMeasured(workflow.promptsPerSession, (value) => value.toFixed(1))
            },
            {
              label: 'Commit rate',
              value: formatMeasured(workflow.sessionsEndingInCommit, (value) => `${Math.round(value)}%`)
            },
            {
              label: 'Tasks in session',
              value: formatCount(workflow.tasksCompletedDuringSessions)
            },
            {
              label: 'Sequence',
              value: workflow.commonAgentSequence
                ? workflow.commonAgentSequence.map(providerLabel).join(' → ')
                : UNAVAILABLE
            }
          ]}
        />
        {workflow.taskPriorityDistribution.length > 0 && (
          <>
            <h4 className="profile-subheading">Priority</h4>
            <DistributionBars entries={workflow.taskPriorityDistribution} />
          </>
        )}
        {workflow.providerDistribution.length > 0 && (
          <>
            <h4 className="profile-subheading">Agents</h4>
            <DistributionBars entries={workflow.providerDistribution} labelFor={providerLabel} />
          </>
        )}
        {workflow.projectDistribution.length > 0 && (
          <>
            <h4 className="profile-subheading">Projects</h4>
            <DistributionBars entries={workflow.projectDistribution} />
          </>
        )}
      </SectionCard>
    </>
  )
}
