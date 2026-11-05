import { describe, expect, it } from 'vitest'
import { parseKey, parsePointer } from '@shared/contracts/simulator'
import {
  chooseSimulator,
  parseDeviceList,
  parseDeviceTypes,
  parseRuntimes,
  pickSimulatorWindow
} from '../devices'

const IPHONE = '11111111-1111-1111-1111-111111111111'
const OTHER = '22222222-2222-2222-2222-222222222222'

describe('simulator device selection', () => {
  it('uses a booted iPhone ahead of the Bikorch device', () => {
    const choice = chooseSimulator({
      devices: parseDeviceList({
        devices: {
          'com.apple.CoreSimulator.SimRuntime.iOS-26-1': [
            {
              name: 'Bikorch iPhone',
              udid: IPHONE,
              state: 'Shutdown',
              isAvailable: true,
              deviceTypeIdentifier: 'com.apple.CoreSimulator.SimDeviceType.iPhone-17'
            },
            {
              name: 'iPhone 16',
              udid: OTHER,
              state: 'Booted',
              isAvailable: true,
              deviceTypeIdentifier: 'com.apple.CoreSimulator.SimDeviceType.iPhone-16'
            }
          ]
        }
      }),
      runtimes: [],
      deviceTypes: []
    })
    expect(choice).toEqual({ action: 'use', udid: OTHER, name: 'iPhone 16', state: 'Booted' })
  })

  it('creates a Bikorch iPhone when no iPhone exists', () => {
    const choice = chooseSimulator({
      devices: parseDeviceList({
        devices: {
          runtime: [{ name: 'iPad', udid: IPHONE, state: 'Shutdown', isAvailable: true, deviceTypeIdentifier: 'iPad' }]
        }
      }),
      runtimes: parseRuntimes({
        runtimes: [
          { identifier: 'com.apple.CoreSimulator.SimRuntime.iOS-18-0', platform: 'iOS', isAvailable: true },
          { identifier: 'com.apple.CoreSimulator.SimRuntime.iOS-26-1', platform: 'iOS', isAvailable: true, name: 'iOS 26.1' }
        ]
      }),
      deviceTypes: parseDeviceTypes({
        devicetypes: [
          { identifier: 'com.apple.CoreSimulator.SimDeviceType.iPhone-16' },
          { identifier: 'com.apple.CoreSimulator.SimDeviceType.iPhone-17' }
        ]
      })
    })
    expect(choice).toEqual({
      action: 'create',
      name: 'Bikorch iPhone',
      deviceType: 'com.apple.CoreSimulator.SimDeviceType.iPhone-17',
      runtime: 'com.apple.CoreSimulator.SimRuntime.iOS-26-1'
    })
  })

  it('reports a missing runtime instead of inventing a device', () => {
    const choice = chooseSimulator({ devices: [], runtimes: parseRuntimes({}), deviceTypes: ['com.apple.CoreSimulator.SimDeviceType.iPhone-17'] })
    expect(choice.action).toBe('unavailable')
  })

  it('ignores malformed device rows', () => {
    expect(parseDeviceList({ devices: { runtime: [{ name: 'iPhone' }, null, 'nope'] } })).toEqual([])
  })

  it('matches the simulator window by device name', () => {
    const picked = pickSimulatorWindow(
      [
        { id: 'menu', name: 'Simulator' },
        { id: 'phone', name: 'Bikorch iPhone — iOS 26.1' }
      ],
      'Bikorch iPhone'
    )
    expect(picked?.id).toBe('phone')
  })
})

describe('simulator input parsing', () => {
  it('clamps pointer coordinates and rejects unknown phases', () => {
    expect(parsePointer({ phase: 'down', x: 2, y: -1 })).toEqual({ phase: 'down', x: 1, y: 0 })
    expect(parsePointer({ phase: 'tap', x: 0, y: 0 })).toBeNull()
  })

  it('accepts hardware keys and short text only', () => {
    expect(parseKey({ key: 'enter' })).toEqual({ key: 'enter' })
    expect(parseKey({ text: 'hi\n' })).toBeNull()
    expect(parseKey({ text: 'ok' })).toEqual({ text: 'ok' })
  })
})
