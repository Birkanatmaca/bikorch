import { describe, expect, it } from 'vitest'
import { cliPermissionResponse, isReadOnlyCliCommand } from '../cli-permission'

describe('cli permission prompts', () => {
  it('accepts a read-only command and an Enter pause', () => {
    expect(cliPermissionResponse('Run this command?\ngit status\n❯ Allow\n  Deny')).toBe('\r')
    expect(cliPermissionResponse('Allow this command? (y/n)\ngit diff -- src/a.ts')).toBe('y\r')
    expect(cliPermissionResponse('Press Enter to continue')).toBe('\r')
    expect(isReadOnlyCliCommand('kubectl get pods')).toBe(true)
    expect(isReadOnlyCliCommand('terraform plan')).toBe(true)
  })

  it('does not approve a confirmation whose command is missing or not read-only', () => {
    expect(cliPermissionResponse('Allow this command? (y/n)')).toBeNull()
    expect(cliPermissionResponse('Run this command?\n❯ Allow\n  Deny')).toBeNull()
    expect(cliPermissionResponse('Workspace Trust Required\nDo you trust the contents of this directory?')).toBeNull()
    expect(cliPermissionResponse('Allow this command?\ngit push --force')).toBeNull()
    expect(cliPermissionResponse('Allow this command? (y/n)\ngit clean -fd')).toBeNull()
    expect(cliPermissionResponse('Allow this command? (y/n)\nterraform destroy')).toBeNull()
    expect(cliPermissionResponse('Allow this command? (y/n)\nkubectl delete pod api')).toBeNull()
    expect(cliPermissionResponse('Allow this command? (y/n)\nnpm publish')).toBeNull()
    expect(cliPermissionResponse('Allow this command? (y/n)\nrm -rf dist')).toBeNull()
    expect(cliPermissionResponse('Allow this command? (y/n)\ngit reset --hard')).toBeNull()
    expect(cliPermissionResponse('Allow this command? (y/n)\ngit status && git push')).toBeNull()
    expect(cliPermissionResponse('Press Enter to continue\nterraform destroy')).toBeNull()
  })

  it('ignores a normal idle prompt', () => {
    expect(cliPermissionResponse('Done.\n❯ ')).toBeNull()
  })
})
