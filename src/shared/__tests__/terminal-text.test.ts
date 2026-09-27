import { describe, expect, it } from 'vitest'
import { cleanCliLabel } from '../terminal-text'

describe('cleanCliLabel', () => {
  it('drops a 256-color tail glued to a CLI email', () => {
    const banner = `\u001b[38;5;131mbirkanatmacaa@gmail.com`
    expect(cleanCliLabel(banner)).toBe('birkanatmacaa@gmail.com')
    expect(cleanCliLabel('131mbirkan.atmaca@priente.com')).toBe('birkan.atmaca@priente.com')
  })
})