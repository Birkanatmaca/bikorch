import type { GitChangeStatus } from './git'
import type { Project, ProjectWorkspaceState } from '../types'
import type { AiAccount, ActiveAccountByKind } from './accounts'
import type { ProjectTask } from './tasks'
import type { CliUsageInfo, CliUsageKind, CliUsageStatus } from './usage'

export interface UsageSnapshotRecord {
  checkedAt: number
  accountId: string
  kind: CliUsageKind
  status: CliUsageStatus
  primaryUsedPercent?: number
  secondaryUsedPercent?: number
  primaryResetsAt?: number | null
  secondaryResetsAt?: number | null
  planType?: string | null
  creditsBalance?: string | null
  creditsAvailable?: boolean
}

export interface PersistedUsageSnapshot {
  providers: CliUsageInfo[]
  checkedAtByAccountId: Record<string, number>
  history: UsageSnapshotRecord[]
}

export type SubscriptionBillingPeriod = 'monthly' | 'yearly' | 'custom'

export interface SubscriptionRecord {
  id: string
  accountId?: string
  provider: string
  planName?: string
  amount: number
  currency: string
  billingPeriod: SubscriptionBillingPeriod
  renewalDate?: number
  source: 'manual' | 'provider'
}

export function createEmptyUsageSnapshot(): PersistedUsageSnapshot {
  return {
    providers: [],
    checkedAtByAccountId: {},
    history: []
  }
}

export interface PersistedEditorState {
  selectedFileByProject: Record<string, string | null>
  activeDiffByProject: Record<
    string,
    {
      filePath: string
      status: GitChangeStatus | null
      index: number
      mode?: 'diff' | 'file'
      absolutePath?: string
    } | null
  >
}

export interface PersistedSnapshot {
  projects: Project[]
  activeProjectId: string | null
  workspaces: Record<string, ProjectWorkspaceState>
  editor: PersistedEditorState
  accounts: AiAccount[]
  activeAccountByKind: ActiveAccountByKind
  tasksByProject: Record<string, ProjectTask[]>
  usage: PersistedUsageSnapshot
  subscriptions: SubscriptionRecord[]
}

export const PERSISTENCE_IPC = {
  LOAD: 'persistence:load',
  SAVE: 'persistence:save'
} as const

export const PERSISTENCE_SCHEMA_VERSION = 1
