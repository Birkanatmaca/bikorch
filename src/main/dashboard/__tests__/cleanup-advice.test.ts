import { tmpdir } from 'os'
import { describe, expect, it, vi } from 'vitest'
import type { StorageItem, StorageReport } from '@shared/contracts/storage'
import { DEFAULT_HOME_LAYOUT, withSystemCare, type HomeWidgetRect } from '@shared/contracts/dashboard'

vi.mock('electron', () => ({ app: { getPath: () => tmpdir(), getLocale: () => 'tr' }, powerMonitor: {} }))
vi.mock('../../persistence/database', () => ({ readMetaValue: () => null, writeMetaValue: () => undefined, listPersistedProjectFolders: () => [] }))
vi.mock('../../storage/scan', () => ({ latestStorageReport: () => null, scanStorage: async () => null }))
vi.mock('../../secretary/cli-manager-session', () => ({ runManagerCliProcess: vi.fn() }))
vi.mock('../briefing', () => ({ claudeEnv: async () => ({}) }))

const { cleanupAdvicePrompt, parseAdvice, rulesAdvice } = await import('../cleanup-advice')

const GB = 1024 ** 3
const NOW = Date.UTC(2026, 10, 10)
const DAY = 86_400_000

function item(overrides: Partial<StorageItem> & Pick<StorageItem, 'id'>): StorageItem {
  return {
    group: 'developer',
    label: overrides.id,
    detail: '',
    path: `/Users/me/${overrides.id}`,
    bytes: GB,
    lastUsedAt: NOW - DAY,
    safety: 'safe',
    ...overrides
  }
}

function report(items: StorageItem[], freeGb: number, totalGb = 228): StorageReport {
  return {
    collectedAt: NOW,
    durationMs: 10,
    items: [...items].sort((a, b) => b.bytes - a.bytes),
    disk: { freeBytes: freeGb * GB, totalBytes: totalGb * GB },
    swapUsedBytes: null
  }
}

describe('cleanup advice without Claude', () => {
  const items = [
    item({ id: 'derived', label: 'Xcode DerivedData', bytes: 11 * GB }),
    item({ id: 'gradle', label: 'Gradle caches', bytes: 4 * GB, safety: 'rebuild' }),
    item({ id: 'old-modules', group: 'projects', project: 'old-app', label: 'node_modules', bytes: 2 * GB, safety: 'rebuild', lastUsedAt: NOW - 90 * DAY }),
    item({ id: 'fresh-modules', group: 'projects', project: 'bikorch', label: 'node_modules', bytes: 2 * GB, safety: 'rebuild', lastUsedAt: NOW - DAY }),
    item({ id: 'archives', label: 'Xcode archives', bytes: 2 * GB, safety: 'caution' }),
    item({ id: 'tiny', bytes: 10 * 1024 ** 2 })
  ]

  it('recommends safe caches and stale project outputs when the disk is nearly full', () => {
    const advice = rulesAdvice(report(items, 0.6), null, NOW)
    expect(advice.recommend).toBe(true)
    expect(advice.source).toBe('rules')
    // Disk is low: rebuildable tool caches count too; caution items and tiny ones never do.
    expect(advice.picks).toEqual(['derived', 'gradle', 'old-modules', 'fresh-modules'])
  })

  it('leaves rebuildable caches and active projects alone when there is room', () => {
    const advice = rulesAdvice(report(items, 120), null, NOW)
    expect(advice.picks).toEqual(['derived', 'old-modules'])
    expect(advice.recommend).toBe(true)
  })

  it('does not push a cleanup for a little cache on a roomy disk', () => {
    const advice = rulesAdvice(report([item({ id: 'npm', bytes: 300 * 1024 ** 2 })], 120), null, NOW)
    expect(advice.recommend).toBe(false)
  })
})

describe('cleanup advice from Claude', () => {
  const scan = report([item({ id: 'derived', bytes: 11 * GB }), item({ id: 'npm', bytes: GB })], 0.6)

  it('keeps only ids from the scan', () => {
    const advice = parseAdvice({
      headline: 'Diskin dolmak üzere',
      message: '11 GB önbellek temizlenebilir. Temizleyeyim mi?',
      recommend: true,
      picks: ['derived', 'derived', '/etc', '../../Documents', 'npm']
    }, scan, NOW)
    expect(advice?.picks).toEqual(['derived', 'npm'])
    expect(advice?.source).toBe('ai')
  })

  it('rejects an answer without the required fields', () => {
    expect(parseAdvice({ headline: 'x', picks: [] }, scan, NOW)).toBeNull()
    expect(parseAdvice(null, scan, NOW)).toBeNull()
  })

  it('shows Claude the numbers, the ids and the language to answer in', () => {
    const prompt = cleanupAdvicePrompt(null, scan, 'tr-TR', NOW)
    expect(prompt).toContain('id=derived')
    expect(prompt).toContain('11.0 GB')
    expect(prompt).toContain('614 MB free')
    expect(prompt).toContain('tr-TR')
  })
})

describe('Home layout migration', () => {
  it('adds System care to a free spot of an earlier arrangement', () => {
    const earlier: HomeWidgetRect[] = [{ id: 'today', x: 0, y: 0, w: 12, h: 2 }, { id: 'chat', x: 0, y: 2, w: 4, h: 10 }]
    const next = withSystemCare(earlier)
    expect(next?.find((rect) => rect.id === 'system')).toEqual({ id: 'system', x: 4, y: 2, w: 5, h: 6 })
    expect(next?.slice(0, 2)).toEqual(earlier)
  })

  it('gives up on a full canvas so the new default is used', () => {
    const full: HomeWidgetRect[] = [{ id: 'chat', x: 0, y: 0, w: 12, h: 12 }]
    expect(withSystemCare(full)).toBeNull()
  })

  it('keeps an arrangement that already has it, and the default has it', () => {
    expect(withSystemCare(DEFAULT_HOME_LAYOUT)).toBe(DEFAULT_HOME_LAYOUT)
  })
})
