import { describe, expect, it } from 'vitest'
import { cliPermissionResponse } from '../cli-permission'

describe('cli permission prompts', () => {
  it('accepts an Allow choice and an Enter pause', () => {
    expect(cliPermissionResponse('Run this command?\n❯ Allow\n  Deny')).toBe('\r')
    expect(cliPermissionResponse('Press Enter to continue')).toBe('\r')
    expect(cliPermissionResponse('Allow this command? (y/n)')).toBe('y\r')
  })

  it('leaves workspace trust and destructive confirms to the user', () => {
    expect(cliPermissionResponse('Workspace Trust Required\nDo you trust the contents of this directory?')).toBeNull()
    expect(cliPermissionResponse('Allow this command?\ngit push --force')).toBeNull()
  })

  it('ignores a normal idle prompt', () => {
    expect(cliPermissionResponse('Done.\n❯ ')).toBeNull()
  })
})
