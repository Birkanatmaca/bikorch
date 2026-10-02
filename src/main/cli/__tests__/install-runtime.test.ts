import { describe, expect, it } from 'vitest'
import { selectNodeArchive } from '../install-runtime'

const hash = 'a'.repeat(64)
describe('portable Node.js manifest', () => {
  it.each([
    ['win32', 'x64', 'node-v22.23.0-win-x64.zip'],
    ['win32', 'arm64', 'node-v22.23.0-win-arm64.zip'],
    ['darwin', 'arm64', 'node-v22.23.0-darwin-arm64.tar.gz'],
    ['linux', 'x64', 'node-v22.23.0-linux-x64.tar.gz']
  ])('selects the official checksum for %s/%s', (platform, arch, name) => {
    expect(selectNodeArchive(`${hash}  ${name}\r\n`, platform, arch)).toEqual({ sha256: hash, name })
  })
  it('rejects malformed manifests and path traversal', () => {
    expect(() => selectNodeArchive(`${hash}  ../node-v22.23.0-win-x64.zip`, 'win32', 'x64')).toThrow()
    expect(() => selectNodeArchive(`invalid  node-v22.23.0-win-x64.zip`, 'win32', 'x64')).toThrow()
    expect(() => selectNodeArchive(`${hash}  node-v22.23.0-win-x64.zip`, 'win32', 'arm64')).toThrow()
    expect(() => selectNodeArchive('', 'freebsd', 'x64')).toThrow('unavailable')
  })
})
