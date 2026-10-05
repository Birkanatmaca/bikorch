import { describe, expect, it } from 'vitest'
import { sanitizeManagerName } from '../manager-name'

describe('manager display name', () => {
  it('keeps a short readable name', () => {
    expect(sanitizeManagerName('  Ada  ')).toBe('Ada')
    expect(sanitizeManagerName('Bikorch Manager')).toBe('Bikorch Manager')
  })

  it('rejects empty, long, and symbolic names', () => {
    expect(sanitizeManagerName('   ')).toBeNull()
    expect(sanitizeManagerName('x'.repeat(41))).toBeNull()
    expect(sanitizeManagerName('Manager <script>')).toBeNull()
  })
})
