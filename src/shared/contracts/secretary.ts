import type { CliUsageInfo, CliUsageKind } from './usage'

export interface SecretarySettings {
  configured: boolean
  model: string
  usage: SecretaryUsageStats
}

export interface SecretaryUsageStats {
  requests: number
  inputTokens: number
  cachedInputTokens: number
  outputTokens: number
  totalTokens: number
  estimatedCostUsd: number | null
  lastRequestAt: number | null
}

export interface SecretaryPanelContext {
  id: string
  kind: CliUsageKind
  accountId?: string
  title: string
  status: 'waiting' | 'busy' | 'stopped' | 'error' | 'starting' | 'running'
}

export interface SecretaryPlanRequest {
  project: { id: string; name: string; folderPath: string | null }
  brief: string
  panels: SecretaryPanelContext[]
  usage: CliUsageInfo[]
}

export interface SecretaryAssignment {
  id: string
  panelId: string | null
  kind: CliUsageKind
  title: string
  instruction: string
  rationale: string
  usageNote: string
}

export interface SecretaryPlan {
  overview: string
  assumptions: string[]
  assignments: SecretaryAssignment[]
  approvalRequired: true
}

export const SECRETARY_IPC = {
  GET_SETTINGS: 'secretary:getSettings',
  SAVE_KEY: 'secretary:saveKey',
  CLEAR_KEY: 'secretary:clearKey',
  RESET_USAGE: 'secretary:resetUsage',
  UPDATE_SETTINGS: 'secretary:updateSettings',
  CREATE_PLAN: 'secretary:createPlan'
} as const
