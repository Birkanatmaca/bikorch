import { describe, expect, it } from 'vitest'
import { parseButton, parseKey, parsePointer } from '@shared/contracts/simulator'

describe('simulator input contract', () => {
  it('accepts only the hardware buttons the helper knows', () => {
    expect(parseButton('home')).toBe('home')
    expect(parseButton('lock')).toBe('lock')
    expect(parseButton('volume')).toBeNull()
    expect(parseButton({ button: 'home' })).toBeNull()
  })

  it('clamps pointers to the screen and drops bad input', () => {
    expect(parsePointer({ phase: 'down', x: 1.4, y: -0.2 })).toEqual({ phase: 'down', x: 1, y: 0 })
    expect(parsePointer({ phase: 'tap', x: 0.5, y: 0.5 })).toBeNull()
    expect(parsePointer({ phase: 'move', x: Number.NaN, y: 0.5 })).toBeNull()
  })

  it('passes Turkish text and named keys through', () => {
    expect(parseKey({ text: 'ğİş' })).toEqual({ text: 'ğİş' })
    expect(parseKey({ key: 'enter' })).toEqual({ key: 'enter' })
    expect(parseKey({ text: '\n' })).toBeNull()
  })
})
