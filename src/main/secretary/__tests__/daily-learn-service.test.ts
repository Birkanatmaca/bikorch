import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getLocale: vi.fn(),
  encryptionAvailable: vi.fn(),
  existsSync: vi.fn(),
  readMetaValue: vi.fn(),
  writeMetaValue: vi.fn(),
  getDeveloperIntelligenceSettings: vi.fn(),
  listMemories: vi.fn(),
  getSecretaryStore: vi.fn(),
  listRecentUserMessages: vi.fn(),
  fetch: vi.fn()
}))

vi.mock('electron', () => ({
  app: { getPath: () => 'test-user-data', getLocale: mocks.getLocale },
  safeStorage: { isEncryptionAvailable: mocks.encryptionAvailable, decryptString: () => 'test-api-key' }
}))
vi.mock('fs', async (importOriginal) => ({
  ...await importOriginal<typeof import('fs')>(),
  existsSync: mocks.existsSync,
  readFileSync: () => Buffer.from('test-encrypted-key')
}))
vi.mock('../../persistence/database', () => ({
  readMetaValue: mocks.readMetaValue, writeMetaValue: mocks.writeMetaValue
}))
vi.mock('../../developer-intelligence/service', () => ({
  getDeveloperIntelligenceSettings: mocks.getDeveloperIntelligenceSettings,
  listMemories: mocks.listMemories
}))
vi.mock('../store', () => ({ getSecretaryStore: mocks.getSecretaryStore }))
vi.mock('../context-service', () => ({ buildSecretaryProjectContext: vi.fn() }))

import { getDailyLearn } from '../service'
import { localDateKey } from '../daily-learn'

const lesson = {
  topic: 'Go eşzamanlılığı',
  body: 'Goroutine bağımsız işleri aynı anda yürütür. Kanallar bu işleri koordine ederek servislerin yanıt vermeye devam etmesini sağlar.',
  basis: 'Languages'
}

describe('Daily Learn language request', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    const meta = new Map<string, string>()
    mocks.readMetaValue.mockImplementation((key: string) => meta.get(key) ?? null)
    mocks.writeMetaValue.mockImplementation((key: string, value: string) => meta.set(key, value))
    mocks.getLocale.mockReturnValue('en-US')
    mocks.encryptionAvailable.mockReturnValue(true)
    mocks.existsSync.mockReturnValue(true)
    mocks.getDeveloperIntelligenceSettings.mockReturnValue({ includeMemoryInPrompts: true })
    mocks.listMemories.mockReturnValue([{ category: 'Languages', content: 'Writes Go services every week.', enabled: true, lastSeenAt: 1 }])
    mocks.listRecentUserMessages.mockReturnValue(['Bu servisi Türkçe açıklar mısın?'])
    mocks.getSecretaryStore.mockReturnValue({ listRecentUserMessages: mocks.listRecentUserMessages })
    mocks.fetch.mockResolvedValue({ ok: true, json: async () => ({ output_text: JSON.stringify(lesson) }) })
    vi.stubGlobal('fetch', mocks.fetch)
  })

  afterEach(() => vi.unstubAllGlobals())

  it('sends Turkish conversation context even with an English locale and caches the returned lesson', async () => {
    const pending = getDailyLearn()
    expect(getDailyLearn()).toBe(pending)
    await expect(pending).resolves.toEqual({ status: 'ready', lesson: { date: localDateKey(), ...lesson } })
    const request = JSON.parse(mocks.fetch.mock.calls[0][1].body)
    expect(request.input[0].content[0].text).toContain("user's preferred UI/conversation language")
    expect(request.input[0].content[0].text).not.toContain('Write in English.')
    expect(JSON.parse(request.input[1].content[0].text).languageContext).toEqual({
      locale: 'en-US', communicationPreferences: [], recentUserMessages: ['Bu servisi Türkçe açıklar mısın?']
    })
    mocks.getLocale.mockReturnValue('tr-TR')
    mocks.listRecentUserMessages.mockReturnValue(['Başka bir dil tercih ediyorum.'])
    await expect(getDailyLearn()).resolves.toMatchObject({ status: 'ready', lesson })
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
  })

  it('uses the locale when there is no saved conversation', async () => {
    mocks.getSecretaryStore.mockReturnValue(null)
    mocks.getLocale.mockReturnValue('tr-TR')
    await getDailyLearn()
    expect(JSON.parse(JSON.parse(mocks.fetch.mock.calls[0][1].body).input[1].content[0].text).languageContext).toEqual({
      locale: 'tr-TR', communicationPreferences: [], recentUserMessages: []
    })
  })

  it.each(['memory-off', 'empty', 'unconfigured'] as const)('keeps the %s gate before reading conversation context or calling the API', async (status) => {
    if (status === 'memory-off') mocks.getDeveloperIntelligenceSettings.mockReturnValue({ includeMemoryInPrompts: false })
    if (status === 'empty') mocks.listMemories.mockReturnValue([])
    if (status === 'unconfigured') mocks.encryptionAvailable.mockReturnValue(false)
    await expect(getDailyLearn()).resolves.toEqual({ status, lesson: null })
    expect(mocks.listRecentUserMessages).not.toHaveBeenCalled()
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('does not retry a failed daily lesson when language context changes', async () => {
    mocks.fetch.mockResolvedValue({ ok: true, json: async () => ({ output_text: '{}' }) })
    await expect(getDailyLearn()).resolves.toEqual({ status: 'unavailable', lesson: null })
    mocks.getLocale.mockReturnValue('tr-TR')
    await expect(getDailyLearn()).resolves.toEqual({ status: 'unavailable', lesson: null })
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
  })
})
