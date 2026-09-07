import { useEffect } from 'react'
import {
  BarChart3,
  Brain,
  CircleDollarSign,
  LayoutDashboard,
  MessageSquareText,
  ShieldCheck,
  Sparkles,
  UsersRound,
  type LucideIcon
} from 'lucide-react'
import type { MetricsRangeKey } from '@shared/contracts/developer-intelligence'
import {
  useDeveloperIntelligenceStore,
  type ProfileSection
} from '@renderer/stores/developer-intelligence-store'
import { useWorkspaceStore } from '@renderer/stores/workspace-store'
import { cn } from '@renderer/lib/utils'
import { ProfileOverview } from './ProfileOverview'
import { DeveloperInsights } from './DeveloperInsights'
import { AiAccountsSection } from './AiAccountsSection'
import { AiCosts } from './AiCosts'
import { PromptHistory } from './PromptHistory'
import { MemoryManager } from './MemoryManager'
import { PrivacySettings } from './PrivacySettings'

const SECTIONS: Array<{ id: ProfileSection; label: string; icon: LucideIcon }> = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'insights', label: 'Insights', icon: Sparkles },
  { id: 'accounts', label: 'Accounts', icon: UsersRound },
  { id: 'costs', label: 'Costs', icon: CircleDollarSign },
  { id: 'prompts', label: 'Prompts', icon: MessageSquareText },
  { id: 'memory', label: 'Memory', icon: Brain },
  { id: 'privacy', label: 'Privacy', icon: ShieldCheck }
]

const RANGE_OPTIONS: Array<{ value: MetricsRangeKey; label: string }> = [
  { value: 'today', label: 'Today' },
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: 'month', label: 'This month' },
  { value: 'all', label: 'All time' }
]

const SECTION_SUBTITLES: Record<ProfileSection, string> = {
  overview: 'Activity measured locally from this workspace',
  insights: 'Language, activity and workflow patterns',
  accounts: 'Per-account status and measured limits',
  costs: 'Subscriptions kept separate from metered API usage',
  prompts: 'Searchable prompt history you control',
  memory: 'Semantic preferences, reviewable and editable',
  privacy: 'What is stored, for how long, and how to remove it'
}

const METRICS_REFRESH_DEBOUNCE_MS = 1200

interface ProfilePanelProps {
  /** When false the panel stays mounted but hidden; live metric refreshes are paused. */
  visible?: boolean
}

export function ProfilePanel({ visible = true }: ProfilePanelProps): React.JSX.Element {
  const section = useDeveloperIntelligenceStore((state) => state.section)
  const setSection = useDeveloperIntelligenceStore((state) => state.setSection)
  const range = useDeveloperIntelligenceStore((state) => state.range)
  const setRange = useDeveloperIntelligenceStore((state) => state.setRange)
  const activityVersion = useDeveloperIntelligenceStore((state) => state.activityVersion)
  const settingsLoaded = useDeveloperIntelligenceStore((state) => state.settingsLoaded)
  const projects = useWorkspaceStore((state) => state.projects)

  const showsMetrics = visible && (section === 'overview' || section === 'insights')

  useEffect(() => {
    if (!visible) return
    if (!settingsLoaded) void useDeveloperIntelligenceStore.getState().loadSettings()
    void useDeveloperIntelligenceStore.getState().loadStats()
  }, [visible, settingsLoaded])

  useEffect(() => {
    if (!showsMetrics) return
    const timer = window.setTimeout(() => {
      void useDeveloperIntelligenceStore.getState().loadMetrics(
        projects.map((project) => ({ id: project.id, name: project.name, folderPath: project.folderPath }))
      )
    }, activityVersion === 0 ? 0 : METRICS_REFRESH_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [showsMetrics, range, activityVersion, projects])

  return (
    <div className="profile-panel relative flex h-full min-h-0 flex-col bg-app-bg">
      <header className="profile-panel-header shrink-0">
        <div className="flex min-w-0 items-start gap-2">
          <div className="profile-panel-icon"><BarChart3 className="h-4 w-4" /></div>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-xs font-semibold text-text-primary">Developer Profile</h2>
            <p className="mt-0.5 truncate text-[10px] text-text-muted">{SECTION_SUBTITLES[section]}</p>
          </div>
          {showsMetrics && (
            <select
              value={range}
              onChange={(event) => setRange(event.target.value as MetricsRangeKey)}
              className="profile-range-select"
              aria-label="Profile date range"
            >
              {RANGE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          )}
        </div>
        <nav className="profile-nav" aria-label="Profile sections">
          {SECTIONS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setSection(id)}
              className={cn('profile-nav-item', section === id && 'profile-nav-item-active')}
              aria-current={section === id ? 'page' : undefined}
            >
              <Icon className="h-3 w-3" aria-hidden />
              <span>{label}</span>
            </button>
          ))}
        </nav>
      </header>

      <div className="profile-scroll min-h-0 flex-1 overflow-auto p-2.5">
        {section === 'overview' && <ProfileOverview />}
        {section === 'insights' && <DeveloperInsights />}
        {section === 'accounts' && <AiAccountsSection />}
        {section === 'costs' && <AiCosts />}
        {section === 'prompts' && <PromptHistory />}
        {section === 'memory' && <MemoryManager />}
        {section === 'privacy' && <PrivacySettings />}
      </div>
    </div>
  )
}
