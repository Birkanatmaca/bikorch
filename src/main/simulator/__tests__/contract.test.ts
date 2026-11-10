import { describe, expect, it } from 'vitest'
import { deviceOrientationValue, parseButton, parseKey, parsePointer, parseRotation, turnDevice } from '@shared/contracts/simulator'

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

describe('turning the device', () => {
  it('steps between portrait and the two landscapes', () => {
    expect(turnDevice(0, 'left')).toBe(270)
    expect(turnDevice(270, 'left')).toBe(270)
    expect(turnDevice(270, 'right')).toBe(0)
    expect(turnDevice(0, 'right')).toBe(90)
    expect(turnDevice(90, 'left')).toBe(0)
  })

  it('sends the orientation Simulator.app sends', () => {
    expect(deviceOrientationValue(0)).toBe(1)
    expect(deviceOrientationValue(270)).toBe(3)
    expect(deviceOrientationValue(90)).toBe(4)
  })

  it('accepts only the turns the device supports', () => {
    expect(parseRotation(270)).toBe(270)
    expect(parseRotation(180)).toBeNull()
    expect(parseRotation('90')).toBeNull()
  })
})
