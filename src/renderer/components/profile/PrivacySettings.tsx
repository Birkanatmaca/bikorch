import { useEffect, useState } from 'react'
import { Download, ShieldCheck, Trash2 } from 'lucide-react'
import { RETENTION_OPTIONS } from '@shared/contracts/developer-intelligence'
import { useDeveloperIntelligenceStore } from '@renderer/stores/developer-intelligence-store'
import { buttonStyles } from '@renderer/components/ui/Button'
import { formatCount, formatDateTime } from './profile-format'
import { KeyValueList, SectionCard, Toggle } from './ProfilePrimitives'

function retentionLabel(days: number): string {
  if (days === 0) return 'Keep forever'
  if (days === 365) return '1 year'
  return `${days} days`
}

export function PrivacySettings(): React.JSX.Element {
  const settings = useDeveloperIntelligenceStore((state) => state.settings)
  const updateSettings = useDeveloperIntelligenceStore((state) => state.updateSettings)
  const stats = useDeveloperIntelligenceStore((state) => state.stats)
  const loadStats = useDeveloperIntelligenceStore((state) => state.loadStats)
  const exportData = useDeveloperIntelligenceStore((state) => state.exportData)
  const clear = useDeveloperIntelligenceStore((state) => state.clear)
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void loadStats()
  }, [loadStats])

  const run = async (label: string, action: () => Promise<string | void>): Promise<void> => {
    setBusy(true)
    setMessage(null)
    try {
      const detail = await action()
      setMessage(typeof detail === 'string' ? detail : label)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Action failed')
    } finally {
      setBusy(false)
      void loadStats()
    }
  }

  const confirmAndClear = (target: 'prompts' | 'events' | 'memories' | 'all', prompt: string, done: string): void => {
    if (!window.confirm(prompt)) return
    void run(done, () => clear(target))
  }

  return (
    <>
      <SectionCard title="Developer Intelligence" description="Everything here is opt-in and stored only on this computer">
        <div className="profile-toggle-list">
          <Toggle
            label="Keep local activity history"
            description="Sessions, commits, tasks, project opens, prompt counts and heuristic categories. Prompt text is controlled separately below."
            checked={settings.keepActivityHistory}
            onChange={(value) => void updateSettings({ keepActivityHistory: value })}
          />
          <Toggle
            label="Save prompt history"
            description="Store redacted prompt text so you can search it. Off by default."
            checked={settings.savePromptHistory}
            disabled={!settings.keepActivityHistory}
            onChange={(value) => void updateSettings({ savePromptHistory: value })}
          />
          <Toggle
            label="Analyze prompts with AI"
            description="Reserved for sending redacted prompt batches to an external model. No provider is configured; local extraction never leaves this computer and does not use this toggle."
            checked={settings.analyzePromptsWithAi}
            onChange={(value) => void updateSettings({ analyzePromptsWithAi: value })}
          />
          <Toggle
            label="Use project file context for metrics"
            description="Scan open project folders locally to weight the language distribution."
            checked={settings.useProjectFileContext}
            onChange={(value) => void updateSettings({ useProjectFileContext: value })}
          />
          <Toggle
            label="Use Git activity for metrics"
            description="Record commits and changed-file languages made from the Changes panel."
            checked={settings.useGitActivity}
            onChange={(value) => void updateSettings({ useGitActivity: value })}
          />
          <Toggle
            label="Include memory in future prompts"
            description="Let enabled memories be packed as a context preview. Terminals do not auto-inject yet."
            checked={settings.includeMemoryInPrompts}
            onChange={(value) => void updateSettings({ includeMemoryInPrompts: value })}
          />
        </div>
      </SectionCard>

      <SectionCard title="Retention" description="History older than this is removed automatically" className="mt-2.5">
        <label className="profile-inline-field">
          <span>Keep history for</span>
          <select
            value={settings.retentionDays}
            onChange={(event) => void updateSettings({ retentionDays: Number(event.target.value) })}
            aria-label="Retention period"
          >
            {RETENTION_OPTIONS.map((days) => (
              <option key={days} value={days}>{retentionLabel(days)}</option>
            ))}
          </select>
        </label>
        <KeyValueList
          items={[
            { label: 'Activity events', value: stats ? formatCount(stats.eventCount) : '…' },
            { label: 'Stored prompts', value: stats ? formatCount(stats.promptCount) : '…' },
            { label: 'Memories', value: stats ? formatCount(stats.memoryCount) : '…' },
            { label: 'Oldest record', value: stats ? formatDateTime(stats.oldestEventAt) : '…' },
            { label: 'Last local analysis', value: stats ? formatDateTime(stats.lastAnalysisAt) : '…' }
          ]}
        />
        <p className="profile-basis">Memories are not subject to retention; delete them explicitly below.</p>
      </SectionCard>

      <SectionCard title="Your data" description="Export or remove what Bikorch has recorded" className="mt-2.5">
        <div className="profile-action-list">
          <button
            type="button"
            className={buttonStyles({ variant: 'secondary', size: 'sm' })}
            disabled={busy}
            onClick={() =>
              void run('Export saved', async () => {
                const result = await exportData()
                if (!result) throw new Error('Export is unavailable')
                if (!result.ok) throw new Error('Export cancelled')
                return `Exported ${result.counts.events} events, ${result.counts.prompts} prompts and ${result.counts.memories} memories to ${result.filePath}`
              })
            }
          >
            <Download className="h-3 w-3" />
            Export data (JSON)
          </button>
          <button
            type="button"
            className={buttonStyles({ variant: 'ghost', size: 'sm' })}
            disabled={busy}
            onClick={() => confirmAndClear('prompts', 'Delete all stored prompt text?', 'Prompt history deleted')}
          >
            <Trash2 className="h-3 w-3" />
            Delete prompt history
          </button>
          <button
            type="button"
            className={buttonStyles({ variant: 'ghost', size: 'sm' })}
            disabled={busy}
            onClick={() => confirmAndClear('events', 'Delete all activity events? Metrics will reset.', 'Activity history deleted')}
          >
            <Trash2 className="h-3 w-3" />
            Delete activity history
          </button>
          <button
            type="button"
            className={buttonStyles({ variant: 'ghost', size: 'sm' })}
            disabled={busy}
            onClick={() => confirmAndClear('memories', 'Delete all memories, including ones you created?', 'Memories deleted')}
          >
            <Trash2 className="h-3 w-3" />
            Delete memories
          </button>
        </div>
        <div className="profile-danger-zone">
          <div className="min-w-0 flex-1">
            <strong>Reset profile</strong>
            <p>Removes all history, prompts and memories and restores default privacy settings.</p>
          </div>
          <button
            type="button"
            className={buttonStyles({ variant: 'danger', size: 'sm' })}
            disabled={busy}
            onClick={() =>
              confirmAndClear('all', 'Reset the Developer Intelligence profile? All local history, prompts, memories and settings will be removed.', 'Profile reset')
            }
          >
            Reset
          </button>
        </div>
        {message && <p className="profile-basis mt-2">{message}</p>}
      </SectionCard>

      <div className="profile-privacy-note">
        <ShieldCheck className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span>
          Prompts are redacted for API keys, tokens, passwords and connection strings before they are
          stored. Raw prompts never go to logs, telemetry or crash reports.
        </span>
      </div>
    </>
  )
}
