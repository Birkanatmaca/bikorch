import type { PtyKind } from './pty'

export type CliUsageKind = Exclude<PtyKind, 'terminal'>
export type CliUsageStatus = 'available' | 'not-installed' | 'unavailable' | 'error'

export interface CliUsageWindow {
  label?: string
  usedPercent: number
  windowDurationMins: number
  resetsAt: number | null
  resetLabel?: string | null
}

export interface CliUsageBreakdown {
  label: string
  value: string
  usedPercent?: number
}

export interface CliUsageInfo {
  kind: CliUsageKind
  label: string
  status: CliUsageStatus
  detail: string
  accountEmail?: string
  accountName?: string
  planType?: string | null
  primary?: CliUsageWindow
  secondary?: CliUsageWindow
  breakdown?: CliUsageBreakdown[]
  credits?: {
    hasCredits: boolean
    unlimited: boolean
    balance: string | null
  }
}

export interface CliUsageResponse {
  checkedAt: number
  providers: CliUsageInfo[]
}

export const USAGE_IPC = {
  READ: 'usage:read'
} as const
