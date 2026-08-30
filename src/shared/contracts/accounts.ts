import type { CliUsageKind } from './usage'

export const AI_ACCOUNT_KINDS: CliUsageKind[] = [
  'claude',
  'cursor',
  'gemini',
  'antigravity',
  'codex'
]

export const AI_ACCOUNT_LABELS: Record<CliUsageKind, string> = {
  claude: 'Claude Code',
  cursor: 'Cursor CLI',
  gemini: 'Gemini CLI',
  antigravity: 'Antigravity CLI',
  codex: 'Codex CLI'
}

export interface AiAccount {
  id: string
  kind: CliUsageKind
  name: string
  email: string
  plan: string
  note: string
  createdAt: number
  source: 'manual' | 'discovered'
  lastSeenAt: number | null
  profileReady: boolean
  lastAuthenticatedAt: number | null
}

export type DiscoveredAiAccount = Pick<AiAccount, 'kind' | 'name' | 'email' | 'plan'>

export type ActiveAccountByKind = Record<CliUsageKind, string | null>

export interface AiAccountsSnapshot {
  accounts: AiAccount[]
  activeAccountByKind: ActiveAccountByKind
}

export function createDefaultActiveAccountByKind(): ActiveAccountByKind {
  return {
    claude: null,
    cursor: null,
    gemini: null,
    antigravity: null,
    codex: null
  }
}
