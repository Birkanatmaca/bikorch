import { describe, expect, it } from 'vitest'
import { buildRunNotice } from '../run-notice'

describe('buildRunNotice', () => {
  it('uses the Manager summary when it wrote one', () => {
    const notice = buildRunNotice(
      { headline: "calc.js'e add ekledim ve testini yazdım.", highlights: ['calc.js: add(a, b) eklendi', 'test.js: add testi eklendi', 'CLI reports npm test passed', 'x', 'extra'] },
      { reply: 'long report', failed: false, changedFiles: ['calc.js', 'test.js'] }
    )
    expect(notice.headline).toBe("calc.js'e add ekledim ve testini yazdım.")
    expect(notice.highlights).toHaveLength(4)
  })

  it('falls back to the first sentence of the report and the Git facts', () => {
    const notice = buildRunNotice(null, {
      reply: 'Görev tamamlandı ve beklenen sonuç karşılandı. Aşağıda kanıtlar var.',
      failed: false,
      changedFiles: ['a.ts', 'b.ts', 'c.ts', 'd.ts']
    })
    expect(notice.headline).toBe('Görev tamamlandı ve beklenen sonuç karşılandı.')
    expect(notice.highlights[0]).toBe('4 files changed: a.ts, b.ts, c.ts, …')
  })

  it('still says something when there is no report', () => {
    expect(buildRunNotice({}, { reply: '', failed: true, changedFiles: [] }).headline).toBe('The work did not finish.')
  })
})
