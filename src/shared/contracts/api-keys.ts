import type { CliUsageKind } from './usage'

export type ApiKeyProvider = 'anthropic' | 'openai' | 'gemini'

export const API_KEY_PROVIDERS: readonly ApiKeyProvider[] = ['anthropic', 'openai', 'gemini']

export const API_KEY_PROVIDER_LABELS: Record<ApiKeyProvider, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  gemini: 'Google Gemini'
}

/** The CLI each provider's key can drive. */
export const API_KEY_PROVIDER_CLI: Record<ApiKeyProvider, CliUsageKind> = {
  anthropic: 'claude',
  openai: 'codex',
  gemini: 'gemini'
}

/** The Manager talks to the OpenAI Responses API, so only OpenAI keys can power it. */
export const MANAGER_API_KEY_PROVIDERS: readonly ApiKeyProvider[] = ['openai']

/** Stored key metadata. The secret itself never leaves the main process. */
export interface ApiKeyRecord {
  id: string
  provider: ApiKeyProvider
  label: string
  /** Last four characters, for recognising the key without revealing it. */
  hint: string
  createdAt: number
  useForManager: boolean
  lastTestedAt: number | null
  lastTestOk: boolean | null
}

export interface ApiKeyAddRequest {
  provider: ApiKeyProvider
  label: string
  secret: string
  useForManager?: boolean
}

export interface ApiKeyTestResult {
  ok: boolean
  error?: string
}

export interface ApiKeyConnectCliRequest {
  keyId: string
  accountId: string
}

export interface ApiKeyResult {
  ok: boolean
  error?: string
  keys: ApiKeyRecord[]
}

export const API_KEYS_IPC = {
  LIST: 'api-keys:list',
  ADD: 'api-keys:add',
  REMOVE: 'api-keys:remove',
  RENAME: 'api-keys:rename',
  SET_MANAGER: 'api-keys:set-manager',
  TEST: 'api-keys:test',
  CONNECT_CLI: 'api-keys:connect-cli'
} as const

export function apiKeyHint(secret: string): string {
  return secret.trim().slice(-4)
}

/** Loose shape checks that catch pasting the wrong provider's key. */
export function looksLikeProviderKey(provider: ApiKeyProvider, secret: string): boolean {
  const value = secret.trim()
  if (value.length < 20 || value.length > 500 || /\s/.test(value)) return false
  if (provider === 'anthropic') return value.startsWith('sk-ant-') && !value.startsWith('sk-ant-admin')
  if (provider === 'openai') return value.startsWith('sk-') && !value.startsWith('sk-ant-')
  return /^[A-Za-z0-9_-]+$/.test(value)
}
