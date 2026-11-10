import { describe, expect, it } from 'vitest'
import {
  briefingFromStore,
  parseDevTips,
  parseNewsItems,
  parseStoredBriefing,
  readClaudeJson,
  safeHttpUrl
} from '../briefing-content'

const story = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  title: 'Node.js 24 is LTS',
  summary: 'Node 24 moved to long-term support.',
  analysis: 'Plan the upgrade for production services.',
  category: 'software',
  region: 'global',
  source: 'Node.js Blog',
  url: 'https://nodejs.org/en/blog/release/v24',
  publishedAt: '2026-11-05',
  severity: 'high',
  ...overrides
})

describe('home briefings', () => {
  it('keeps only web links', () => {
    expect(safeHttpUrl('https://example.com/a')).toBe('https://example.com/a')
    expect(safeHttpUrl('javascript:alert(1)')).toBeNull()
    expect(safeHttpUrl('file:///etc/passwd')).toBeNull()
    expect(safeHttpUrl('https://user:pw@example.com')).toBeNull()
    expect(safeHttpUrl('not a url')).toBeNull()
  })

  it('cleans news: drops bad links and duplicates, caps at ten, severity only for security', () => {
    const items = [
      story(),
      story({ title: 'Duplicate' }),
      story({ url: 'javascript:void(0)', title: 'Bad link' }),
      story({ url: 'https://example.com/cve', category: 'security', severity: 'critical', region: 'tr', publishedAt: 'yesterday' }),
      ...Array.from({ length: 12 }, (_, index) => story({ url: `https://example.com/${index}`, title: `Story ${index}` }))
    ]
    const news = parseNewsItems({ items })
    expect(news).toHaveLength(10)
    expect(news[0]).toMatchObject({ title: 'Node.js 24 is LTS', severity: null })
    expect(news[1]).toMatchObject({ category: 'security', severity: 'critical', region: 'tr', publishedAt: null })
    expect(news.some((item) => item.title === 'Duplicate' || item.title === 'Bad link')).toBe(false)
  })

  it('cleans dev notes', () => {
    const tips = parseDevTips({ items: [
      { title: 'git switch -', body: 'Jump back to the previous branch.', category: 'Git', snippet: 'git switch -', url: null },
      { title: '', body: 'missing title', category: 'Git', snippet: null, url: null },
      { title: 'No snippet', body: 'Body', category: '', snippet: '', url: 'ftp://x' }
    ] })
    expect(tips).toEqual([
      { title: 'git switch -', body: 'Jump back to the previous branch.', category: 'Git', snippet: 'git switch -', url: null },
      { title: 'No snippet', body: 'Body', category: 'Dev', snippet: null, url: null }
    ])
  })

  it('reads structured output, then falls back to JSON in the result text', () => {
    expect(readClaudeJson(JSON.stringify({ structured_output: { items: [] } }))).toEqual({ value: { items: [] }, error: null })
    expect(readClaudeJson(JSON.stringify({ result: 'Here you go: {"items":[1]}' })).value).toEqual({ items: [1] })
    expect(readClaudeJson(JSON.stringify({ is_error: true, result: 'Not logged in' })).error).toBe('Not logged in')
    expect(readClaudeJson('garbage').error).toBeTruthy()
  })

  it('marks a stored briefing stale after its window', () => {
    const stored = parseStoredBriefing(JSON.stringify({ items: [story()], generatedAt: 1_000, history: ['a'] }))
    expect(briefingFromStore('news', stored, 2_000, 5_000).status).toBe('ready')
    expect(briefingFromStore('news', stored, 10_000, 5_000).status).toBe('stale')
    expect(briefingFromStore('news', null, 0, 5_000).status).toBe('empty')
    expect(parseStoredBriefing('{bad')).toBeNull()
  })
})
