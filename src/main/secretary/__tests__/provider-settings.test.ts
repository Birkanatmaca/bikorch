import { describe, expect, it, vi } from 'vitest'
import { CLI_MANAGER_PROVIDER_UNAVAILABLE } from '@shared/contracts/secretary'
import type { ManagerProviderPatch } from '@shared/contracts/secretary'
import { createCliManagerProvider } from '../cli-manager-provider'
import { resolveManagerAiProvider, type ManagerAiProvider } from '../manager-ai-provider'
import { SECRETARY_CHAT_RESPONSE_FORMAT } from '../response-schema'
import {
  applyManagerProviderUpdate,
  assessCliManager,
  buildManagerProviderView,
  dedicatedManagerCliSession,
  defaultManagerProviderSettings,
  managerCanThink,
  parseManagerProviderSettings,
  storedManagerProvider
} from '../provider-settings'

const format = SECRETARY_CHAT_RESPONSE_FORMAT
const secret = 'sk-live-secret-value-should-not-leak'

function providers(): { api: ManagerAiProvider; cli: ManagerAiProvider } {
  return {
    api: { generate: vi.fn(async () => '{"reply":"ok","actions":[],"plan":null}') },
    cli: createCliManagerProvider()
  }
}

describe('Manager provider settings', () => {
  it('keeps an existing API model on source api when no provider config is stored', () => {
    const settings = parseManagerProviderSettings(null, 'gpt-5.6-luna')
    expect(settings.source).toBe('api')
    expect(settings.api).toEqual({ provider: 'openai', model: 'gpt-5.6-luna' })
    expect(settings.fallbackToApi).toBe(false)
    expect(managerCanThink(settings, true)).toBe(true)
  })

  it('treats unreadable provider config as the existing API setup', () => {
    const settings = parseManagerProviderSettings('{', 'gpt-5')
    expect(settings.source).toBe('api')
    expect(settings.api.model).toBe('gpt-5')
  })

  it('does not put the API key on the settings returned to the renderer', () => {
    const view = buildManagerProviderView({
      settings: defaultManagerProviderSettings('gpt-5'),
      hasApiKey: true,
      cliStatus: 'account-unavailable'
    })
    expect(view.api.hasKey).toBe(true)
    expect(view.api).not.toHaveProperty('apiKey')
    expect(view.api).not.toHaveProperty('key')
    const next = applyManagerProviderUpdate(defaultManagerProviderSettings('gpt-5'), {
      api: { model: 'gpt-5' },
      apiKey: secret
    } as ManagerProviderPatch)
    const stored = storedManagerProvider(next)
    expect(stored).not.toContain(secret)
    expect(stored).not.toContain('apiKey')
    expect(JSON.stringify(view)).not.toContain(secret)
  })

  it('selects the OpenAI provider when the source is api', () => {
    const { api, cli } = providers()
    const selected = resolveManagerAiProvider({
      source: 'api',
      fallbackToApi: false,
      hasApiKey: true,
      cliGenerationAvailable: false,
      api,
      cli
    })
    expect(selected).toBe(api)
  })

  it('selects the CLI provider when the source is cli', () => {
    const { api, cli } = providers()
    const selected = resolveManagerAiProvider({
      source: 'cli',
      fallbackToApi: false,
      hasApiKey: true,
      cliGenerationAvailable: false,
      api,
      cli
    })
    expect(selected).toBe(cli)
  })

  it('returns an explicit error when CLI is selected and generation is unavailable', async () => {
    const { api, cli } = providers()
    const selected = resolveManagerAiProvider({
      source: 'cli',
      fallbackToApi: false,
      hasApiKey: false,
      cliGenerationAvailable: false,
      api,
      cli
    })
    await expect(selected.generate([], format)).rejects.toThrow(CLI_MANAGER_PROVIDER_UNAVAILABLE)
    expect(api.generate).not.toHaveBeenCalled()
  })

  it('does not start Manager when CLI is selected without an account', () => {
    const settings = applyManagerProviderUpdate(defaultManagerProviderSettings('gpt-5'), {
      source: 'cli',
      fallbackToApi: false,
      cli: { kind: 'claude', accountId: null }
    })
    expect(managerCanThink(settings, true)).toBe(false)
    expect(assessCliManager({
      kind: 'claude',
      accountId: null,
      installed: true,
      account: null
    }).status).toBe('account-unavailable')
    expect(dedicatedManagerCliSession(settings.cli)).toBeNull()
  })

  it('does not rewrite conversation or run records when the provider changes', () => {
    const next = applyManagerProviderUpdate(defaultManagerProviderSettings('gpt-5'), {
      source: 'api',
      fallbackToApi: true,
      threadId: 'thread-1',
      runId: 'run-1'
    } as ManagerProviderPatch)
    const stored = JSON.parse(storedManagerProvider(next)) as Record<string, unknown>
    expect(Object.keys(stored).sort()).toEqual(['api', 'cli', 'fallbackToApi', 'source'])
    expect(stored).not.toHaveProperty('threadId')
    expect(stored).not.toHaveProperty('runId')
    expect(next.api.model).toBe('gpt-5')
  })

  it('does not dispatch coding work from a provider', async () => {
    const dispatch = vi.fn()
    const cli = createCliManagerProvider()
    expect(Object.keys(cli)).toEqual(['generate'])
    await expect(cli.generate([], format)).rejects.toThrow(CLI_MANAGER_PROVIDER_UNAVAILABLE)
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('asks API and CLI providers for the same Manager response contract', async () => {
    expect(format.schema.required).toEqual(expect.arrayContaining(['reply', 'actions', 'plan']))
    const { api, cli } = providers()
    const apiProvider = resolveManagerAiProvider({
      source: 'api',
      fallbackToApi: false,
      hasApiKey: true,
      cliGenerationAvailable: false,
      api,
      cli
    })
    await expect(apiProvider.generate([], format)).resolves.toContain('"reply"')
    const cliProvider = resolveManagerAiProvider({
      source: 'cli',
      fallbackToApi: false,
      hasApiKey: true,
      cliGenerationAvailable: false,
      api,
      cli
    })
    await expect(cliProvider.generate([], format)).rejects.toThrow(CLI_MANAGER_PROVIDER_UNAVAILABLE)
  })

  it('keeps a dedicated Manager CLI session separate from coding sessions', () => {
    const session = dedicatedManagerCliSession({ kind: 'claude', accountId: 'account-1', model: null })
    expect(session).toEqual({ role: 'manager', kind: 'claude', accountId: 'account-1', sessionId: null })
  })

  it('reports real CLI availability without claiming the provider is ready', () => {
    expect(assessCliManager({
      kind: 'codex',
      accountId: 'account-1',
      installed: false,
      account: null
    })).toMatchObject({ status: 'cli-unavailable', message: 'CLI not installed' })
    expect(assessCliManager({
      kind: 'claude',
      accountId: 'account-1',
      installed: true,
      account: { id: 'account-1', kind: 'claude', profileReady: false, lastAuthenticatedAt: null }
    })).toMatchObject({ status: 'authentication-required', message: 'Authentication required' })
    expect(assessCliManager({
      kind: 'gemini',
      accountId: 'account-1',
      installed: true,
      account: { id: 'account-1', kind: 'gemini', profileReady: true, lastAuthenticatedAt: 1 }
    })).toMatchObject({ status: 'unavailable', message: 'Unavailable' })
    expect(assessCliManager({
      kind: 'cursor',
      accountId: 'account-1',
      installed: true,
      account: { id: 'account-1', kind: 'cursor', profileReady: true, lastAuthenticatedAt: 1 },
      generationSupported: true
    })).toMatchObject({ status: 'ready', message: 'Ready' })
  })

  it('uses the API provider only as an explicit fallback when CLI cannot answer', () => {
    const { api, cli } = providers()
    const selected = resolveManagerAiProvider({
      source: 'cli',
      fallbackToApi: true,
      hasApiKey: true,
      cliGenerationAvailable: false,
      api,
      cli
    })
    expect(selected).toBe(api)
    const blocked = defaultManagerProviderSettings('gpt-5')
    blocked.source = 'cli'
    blocked.fallbackToApi = false
    expect(managerCanThink(blocked, true)).toBe(false)
    blocked.fallbackToApi = true
    expect(managerCanThink(blocked, true)).toBe(true)
  })
})
