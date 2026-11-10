import { describe, expect, it } from 'vitest'
import { parseView } from '@shared/contracts/simulator'
import { HelperMessageReader } from '../headless'
import { hasNewInstall } from '../install-watch'

function message(type: string, payload: Buffer): Buffer {
  const header = Buffer.alloc(5)
  header[0] = type.charCodeAt(0)
  header.writeUInt32BE(payload.length, 1)
  return Buffer.concat([header, payload])
}

describe('headless helper messages', () => {
  it('reads raw frames and JSON however the pipe splits them', () => {
    const frame = Buffer.from([0xff, 0xd8, 0x00, 0x0a, 0xff, 0xd9])
    const json = Buffer.from('{"op":"ready"}')
    const stream = Buffer.concat([message('J', json), message('F', frame), message('F', frame)])
    const seen: Array<[string, string]> = []
    const reader = new HelperMessageReader()
    for (let index = 0; index < stream.length; index += 3) {
      reader.push(stream.subarray(index, index + 3), (type, payload) => {
        seen.push([String.fromCharCode(type), payload.toString('hex')])
      })
    }
    expect(seen).toEqual([
      ['J', json.toString('hex')],
      ['F', frame.toString('hex')],
      ['F', frame.toString('hex')]
    ])
  })
})

describe('simulator installs', () => {
  it('notices a new app and a reinstall, not an unchanged or removed one', () => {
    const before = new Map([['A', 100]])
    expect(hasNewInstall(before, new Map([['A', 100], ['B', 50]]))).toBe(true)
    expect(hasNewInstall(before, new Map([['A', 200]]))).toBe(true)
    expect(hasNewInstall(before, new Map([['A', 100]]))).toBe(false)
    expect(hasNewInstall(before, new Map())).toBe(false)
  })
})

describe('simulator panel view', () => {
  it('accepts visibility and clamps the height', () => {
    expect(parseView({ visible: false, height: 900.4 })).toEqual({ visible: false, height: 900 })
    expect(parseView({ visible: true, height: 10 })).toEqual({ visible: true, height: 320 })
    expect(parseView({ visible: true, height: 99999 })).toEqual({ visible: true, height: 2400 })
    expect(parseView({ visible: 'yes', height: 900 })).toBeNull()
    expect(parseView({ visible: true, height: Number.NaN })).toBeNull()
  })
})
