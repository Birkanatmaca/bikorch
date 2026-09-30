import { describe, expect, it } from 'vitest'
import { cliPermissionResponse, isReadOnlyCliCommand } from '../cli-permission'

describe('cli permission prompts', () => {
  it('accepts a read-only command and an Enter pause', () => {
    expect(cliPermissionResponse('Run this command?\ngit status\n❯ Allow\n  Deny')).toBe('\r')
    expect(cliPermissionResponse('Allow this command? (y/n)\ngit diff -- src/a.ts')).toBe('y\r')
    expect(cliPermissionResponse('git status\nPress Enter to continue')).toBe('\r')
    expect(isReadOnlyCliCommand('kubectl get pods')).toBe(true)
    expect(isReadOnlyCliCommand('terraform plan')).toBe(true)
  })

  it('does not approve a confirmation whose command is missing or not read-only', () => {
    expect(cliPermissionResponse('Allow this command? (y/n)')).toBeNull()
    expect(cliPermissionResponse('Run this command?\n❯ Allow\n  Deny')).toBeNull()
    expect(cliPermissionResponse('Workspace Trust Required\nDo you trust the contents of this directory?')).toBeNull()
    expect(cliPermissionResponse(`Accessing workspace:
/Users/me/projects/helper
Do you trust the contents of this project?
> Yes, I trust this folder
  No, exit`)).toBeNull()
    expect(cliPermissionResponse(`Accessing workspace:
/Users/me/Library/Application Support/Bikorch/agent-worktrees/repo/antigravity-1
Do you trust the contents of this project?
  Yes, I trust this folder
> No, exit`)).toBeNull()
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

  it('confirms trust for a Bikorch agent worktree when Yes is selected', () => {
    expect(cliPermissionResponse(`Accessing workspace:
/Users/me/Library/Application Support/Bikorch/agent-worktrees/repo/antigravity-1
Do you trust the contents of this project?
Antigravity CLI requires permission to read, edit, and execute files here.
> Yes, I trust this folder
  No, exit
enter Confirm`)).toBe('\r')
    expect(cliPermissionResponse(`Workspace Trust Required
/Users/me/Library/Application Support/Bikorch/agent-worktrees/repo/claude-1
Do you trust the contents of this directory?
▶ [a] Trust this workspace`)).toBe('a\r')
    expect(cliPermissionResponse(`Accessing workspace:
/Users/me/Library/Application Support/Bikorch/agent-worktrees/repo/antigravity-1
Do you trust the contents of this project?
Yes, I trust this folder
No, exit`, { managedWorktree: true })).toBe('\r')
    expect(cliPermissionResponse(`Do you trust the contents of this project?
Yes, I trust this folder
No, exit`, { managedWorktree: true })).toBe('\r')
    expect(cliPermissionResponse(`Do you trust the contents of this project?
Yes, I trust this folder
> No, exit`, { managedWorktree: true })).toBeNull()
  })

  it('ignores a normal idle prompt', () => {
    expect(cliPermissionResponse('Done.\n❯ ')).toBeNull()
  })

  it.each([
    'git branch',
    'git branch --list',
    'git branch --show-current',
    'git branch -a',
    'git branch -r',
    'git branch --list -a'
  ])('accepts an explicitly allowed branch listing: %s', (command) => {
    expect(isReadOnlyCliCommand(command)).toBe(true)
    expect(cliPermissionResponse(`${command}\nPress Enter to continue`)).toBe('\r')
  })

  it.each([
    'git branch new-feature',
    'git branch new-feature HEAD',
    'git branch -d old-feature',
    'git branch -m old-feature new-feature',
    'git branch --copy old-feature new-feature',
    'git branch --force new-feature HEAD',
    'git branch --set-upstream-to=origin/main',
    'git branch --unset-upstream',
    'git branch --edit-description',
    'git branch --list --delete old-feature'
  ])('refuses branch creation or mutation: %s', (command) => {
    expect(isReadOnlyCliCommand(command)).toBe(false)
    expect(cliPermissionResponse(`Allow this command? (y/n)\n${command}`)).toBeNull()
    expect(cliPermissionResponse(`${command}\nPress Enter to continue`)).toBeNull()
  })

  it.each([
    'Press Enter to continue',
    'Press Return to continue',
    'Hit Enter to continue',
    'Press any key to continue',
    'Continue?'
  ])('requires a recognized read-only command before a pause: %s', (prompt) => {
    expect(cliPermissionResponse(prompt)).toBeNull()
    expect(cliPermissionResponse(`custom-deployer is about to modify production.\n\n${prompt}`)).toBeNull()
    expect(cliPermissionResponse(`git status\n${prompt}`)).toBe('\r')
  })
})
