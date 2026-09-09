import { useEffect, useState } from 'react'
import { Download, Trash2 } from 'lucide-react'
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
      <SectionCard title="Privacy">
        <div className="profile-toggle-list">
          <Toggle
            label="Activity history"
            checked={settings.keepActivityHistory}
            onChange={(value) => void updateSettings({ keepActivityHistory: value })}
          />
          <Toggle
            label="Prompt text"
            checked={settings.savePromptHistory}
            disabled={!settings.keepActivityHistory}
            onChange={(value) => void updateSettings({ savePromptHistory: value })}
          />
          <Toggle
            label="Analyze with AI"
            checked={settings.analyzePromptsWithAi}
            onChange={(value) => void updateSettings({ analyzePromptsWithAi: value })}
          />
          <Toggle
            label="Project files"
            checked={settings.useProjectFileContext}
            onChange={(value) => void updateSettings({ useProjectFileContext: value })}
          />
          <Toggle
            label="Git activity"
            checked={settings.useGitActivity}
            onChange={(value) => void updateSettings({ useGitActivity: value })}
          />
          <Toggle
            label="Memory in prompts"
            checked={settings.includeMemoryInPrompts}
            onChange={(value) => void updateSettings({ includeMemoryInPrompts: value })}
          />
        </div>
      </SectionCard>

      <SectionCard title="Retention" className="mt-2.5">
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
      </SectionCard>

      <SectionCard title="Data" className="mt-2.5">
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
            <strong>Reset</strong>
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
    </>
  )
}
