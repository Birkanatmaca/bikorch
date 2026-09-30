import { AI_ACCOUNT_KINDS } from '@shared/contracts/accounts'
import {
  MANAGER_API_STATUS_LABEL,
  MANAGER_CLI_STATUS_LABEL,
  type ManagerApiConnectionStatus,
  type ManagerCliConnectionStatus,
  type ManagerProviderPatch,
  type ManagerProviderSettings,
  type ManagerProviderSource,
  type ManagerProviderView
} from '@shared/contracts/secretary'
import type { CliUsageKind } from '@shared/contracts/usage'
import { cliManagerSupportsKind } from './cli-manager-launch'
import { isValidSecretaryModelId } from './model-policy'

export const MANAGER_PROVIDER_META_KEY = 'developer_secretary_provider'

export interface ManagerCliAccountRef {
  id: string
  kind: CliUsageKind
  profileReady: boolean
  lastAuthenticatedAt: number | null
}

export interface ManagerCliSessionSpec {
  role: 'manager'
  kind: CliUsageKind
  accountId: string
  /** Null until the CLI provider can open its own PTY. Coding panels are never reused. */
  sessionId: null
}

const EMPTY_CLI: ManagerProviderSettings['cli'] = { kind: null, accountId: null, model: null }

export function defaultManagerProviderSettings(model: string): ManagerProviderSettings {
  return {
    source: 'api',
    api: { provider: 'openai', model },
    cli: { ...EMPTY_CLI },
    fallbackToApi: false
  }
}

function isCliKind(value: unknown): value is CliUsageKind {
  return typeof value === 'string' && (AI_ACCOUNT_KINDS as readonly string[]).includes(value)
}

function parseCliModel(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null
  if (typeof value !== 'string' || !isValidSecretaryModelId(value)) {
    throw new Error('Enter a valid CLI model identifier')
  }
  return value.trim()
}

function parseAccountId(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null
  if (typeof value !== 'string') throw new Error('Choose a CLI account')
  const id = value.trim()
  if (!id || id.length > 80) throw new Error('Choose a CLI account')
  return id
}

function parseCli(value: unknown, fallback: ManagerProviderSettings['cli']): ManagerProviderSettings['cli'] {
  if (!value || typeof value !== 'object') return fallback
  const cli = value as { kind?: unknown; accountId?: unknown; model?: unknown }
  const kind = cli.kind === undefined
    ? fallback.kind
    : cli.kind === null || cli.kind === ''
      ? null
      : isCliKind(cli.kind) ? cli.kind : null
  if (cli.kind !== undefined && cli.kind !== null && cli.kind !== '' && !isCliKind(cli.kind)) {
    throw new Error('Choose a supported CLI')
  }
  return {
    kind,
    accountId: cli.accountId === undefined ? fallback.accountId : parseAccountId(cli.accountId),
    model: cli.model === undefined ? fallback.model : parseCliModel(cli.model)
  }
}

/** Missing or unreadable provider config stays on the existing OpenAI model. */
export function parseManagerProviderSettings(raw: string | null | undefined, model: string): ManagerProviderSettings {
  const fallback = defaultManagerProviderSettings(model)
  if (!raw) return fallback
  try {
    const value = JSON.parse(raw) as Partial<ManagerProviderSettings>
    const source: ManagerProviderSource = value.source === 'cli' ? 'cli' : 'api'
    return {
      source,
      api: { provider: 'openai', model },
      cli: parseCli(value.cli, EMPTY_CLI),
      fallbackToApi: value.fallbackToApi === true
    }
  } catch {
    return fallback
  }
}

export function applyManagerProviderUpdate(
  current: ManagerProviderSettings,
  patch: ManagerProviderPatch
): ManagerProviderSettings {
  if (!patch || typeof patch !== 'object') throw new Error('Invalid Manager provider settings')
  let model = current.api.model
  if (patch.api && Object.prototype.hasOwnProperty.call(patch.api, 'model')) {
    const next = patch.api.model
    if (typeof next !== 'string' || !isValidSecretaryModelId(next)) {
      throw new Error('Enter a valid model identifier')
    }
    model = next.trim()
  }
  if (patch.source !== undefined && patch.source !== 'api' && patch.source !== 'cli') {
    throw new Error('Choose API or CLI')
  }
  if (patch.fallbackToApi !== undefined && typeof patch.fallbackToApi !== 'boolean') {
    throw new Error('Invalid fallback setting')
  }
  return {
    source: patch.source ?? current.source,
    api: { provider: 'openai', model },
    cli: patch.cli === undefined ? current.cli : parseCli(patch.cli, current.cli),
    fallbackToApi: patch.fallbackToApi ?? current.fallbackToApi
  }
}

/** Persisted document. API keys are not a field here. */
export function storedManagerProvider(settings: ManagerProviderSettings): string {
  return JSON.stringify({
    source: settings.source,
    api: { provider: 'openai', model: settings.api.model },
    cli: {
      kind: settings.cli.kind,
      accountId: settings.cli.accountId,
      model: settings.cli.model
    },
    fallbackToApi: settings.fallbackToApi
  } satisfies ManagerProviderSettings)
}

export function assessCliManager(input: {
  kind: CliUsageKind | null
  accountId: string | null
  installed: boolean
  account: ManagerCliAccountRef | null
  generationSupported?: boolean
}): { status: ManagerCliConnectionStatus; message: string } {
  if (!input.kind || !input.accountId) {
    return { status: 'account-unavailable', message: MANAGER_CLI_STATUS_LABEL['account-unavailable'] }
  }
  if (!input.installed) {
    return { status: 'cli-unavailable', message: MANAGER_CLI_STATUS_LABEL['cli-unavailable'] }
  }
  if (!input.account || input.account.id !== input.accountId || input.account.kind !== input.kind) {
    return { status: 'account-unavailable', message: MANAGER_CLI_STATUS_LABEL['account-unavailable'] }
  }
  const authenticated = input.account.profileReady || input.account.lastAuthenticatedAt !== null
  if (!authenticated) {
    return { status: 'authentication-required', message: MANAGER_CLI_STATUS_LABEL['authentication-required'] }
  }
  if (!input.generationSupported) {
    return { status: 'unavailable', message: MANAGER_CLI_STATUS_LABEL.unavailable }
  }
  return { status: 'ready', message: MANAGER_CLI_STATUS_LABEL.ready }
}

export function dedicatedManagerCliSession(cli: ManagerProviderSettings['cli']): ManagerCliSessionSpec | null {
  if (!cli.kind || !cli.accountId) return null
  return { role: 'manager', kind: cli.kind, accountId: cli.accountId, sessionId: null }
}

export function buildManagerProviderView(input: {
  settings: ManagerProviderSettings
  hasApiKey: boolean
  cliStatus: ManagerCliConnectionStatus
}): ManagerProviderView {
  const apiStatus: ManagerApiConnectionStatus = input.hasApiKey ? 'configured' : 'not-configured'
  return {
    source: input.settings.source,
    fallbackToApi: input.settings.fallbackToApi,
    api: {
      provider: 'openai',
      model: input.settings.api.model,
      hasKey: input.hasApiKey,
      status: apiStatus,
      statusLabel: MANAGER_API_STATUS_LABEL[apiStatus]
    },
    cli: {
      kind: input.settings.cli.kind,
      accountId: input.settings.cli.accountId,
      model: input.settings.cli.model,
      status: input.cliStatus,
      statusLabel: MANAGER_CLI_STATUS_LABEL[input.cliStatus],
      generationAvailable: input.settings.cli.kind === null || cliManagerSupportsKind(input.settings.cli.kind),
      session: 'dedicated-manager'
    }
  }
}

export function apiProbeFailure(message: string): { status: ManagerApiConnectionStatus; message: string } {
  if (/rejected|invalid api key|incorrect api key/i.test(message)) {
    return { status: 'invalid-key', message: MANAGER_API_STATUS_LABEL['invalid-key'] }
  }
  return { status: 'unreachable', message: MANAGER_API_STATUS_LABEL.unreachable }
}

export function resolveManagerProviderKind(
  settings: Pick<ManagerProviderSettings, 'source' | 'fallbackToApi'>,
  options: { hasApiKey: boolean; cliGenerationAvailable: boolean }
): ManagerProviderSource {
  if (settings.source !== 'cli') return 'api'
  if (!options.cliGenerationAvailable && settings.fallbackToApi && options.hasApiKey) return 'api'
  return 'cli'
}

export function managerCanThink(
  settings: ManagerProviderSettings,
  hasApiKey: boolean,
  cliStatus: ManagerCliConnectionStatus = 'unavailable'
): boolean {
  const supported = cliManagerSupportsKind(settings.cli.kind) && cliStatus === 'ready'
  const kind = resolveManagerProviderKind(settings, {
    hasApiKey,
    cliGenerationAvailable: supported
  })
  if (kind === 'api') return hasApiKey
  return supported
}
