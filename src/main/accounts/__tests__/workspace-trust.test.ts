import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { trustManagedWorktree } from '../workspace-trust'

let root = ''
let agentRoot = ''
let worktree = ''
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'bikorch-trust-'))
  agentRoot = join(root, 'agent-worktrees')
  worktree = join(agentRoot, 'repo', 'codex-1')
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('pre-trusting Manager worktrees', () => {
  it('trusts the agent-worktrees folder for a Claude profile, keeping its other settings', () => {
    const profile = join(root, 'claude')
    writeFileSync(join(root, 'seed.json'), '')
    const configPath = join(profile, '.claude.json')
    require('fs').mkdirSync(profile, { recursive: true })
    writeFileSync(configPath, JSON.stringify({ oauthAccount: { emailAddress: 'a@b.c' }, projects: { '/x': { allowedTools: [] } } }))
    expect(trustManagedWorktree({ kind: 'claude', cwd: worktree, agentRoot, profileEnv: { CLAUDE_CONFIG_DIR: profile } })).toBe(true)
    const config = JSON.parse(readFileSync(configPath, 'utf8'))
    expect(config.projects[agentRoot].hasTrustDialogAccepted).toBe(true)
    expect(config.oauthAccount.emailAddress).toBe('a@b.c')
    expect(config.projects['/x']).toEqual({ allowedTools: [] })
  })

  it('trusts the folder for Gemini and the exact worktree for Codex', () => {
    const gemini = join(root, 'gemini')
    const codex = join(root, 'codex')
    trustManagedWorktree({ kind: 'gemini', cwd: worktree, agentRoot, profileEnv: { GEMINI_CLI_HOME: gemini } })
    expect(JSON.parse(readFileSync(join(gemini, '.gemini', 'trustedFolders.json'), 'utf8'))[agentRoot]).toBe('TRUST_FOLDER')
    trustManagedWorktree({ kind: 'codex', cwd: worktree, agentRoot, profileEnv: { CODEX_HOME: codex } })
    trustManagedWorktree({ kind: 'codex', cwd: worktree, agentRoot, profileEnv: { CODEX_HOME: codex } })
    const toml = readFileSync(join(codex, 'config.toml'), 'utf8')
    expect(toml.match(/trust_level = "trusted"/g)).toHaveLength(1)
    expect(toml).toContain(`[projects."${worktree}"]`)
  })

  it('never trusts a folder outside agent-worktrees or touches global settings', () => {
    const codex = join(root, 'codex')
    expect(trustManagedWorktree({ kind: 'codex', cwd: join(root, 'my-project'), agentRoot, profileEnv: { CODEX_HOME: codex } })).toBe(false)
    expect(existsSync(join(codex, 'config.toml'))).toBe(false)
    expect(trustManagedWorktree({ kind: 'claude', cwd: worktree, agentRoot, profileEnv: {} })).toBe(false)
  })

  it('leaves an unreadable settings file alone', () => {
    const profile = join(root, 'claude')
    require('fs').mkdirSync(profile, { recursive: true })
    writeFileSync(join(profile, '.claude.json'), '{ half-written')
    expect(trustManagedWorktree({ kind: 'claude', cwd: worktree, agentRoot, profileEnv: { CLAUDE_CONFIG_DIR: profile } })).toBe(false)
    expect(readFileSync(join(profile, '.claude.json'), 'utf8')).toBe('{ half-written')
  })
})

describe('Claude trust inside a git worktree', () => {
  it('also trusts the main repository the worktree belongs to', () => {
    const fs = require('fs')
    const profile = join(root, 'claude')
    fs.mkdirSync(profile, { recursive: true })
    fs.mkdirSync(worktree, { recursive: true })
    const repo = join(root, 'my-app')
    writeFileSync(join(worktree, '.git'), `gitdir: ${repo}/.git/worktrees/codex-1\n`)
    trustManagedWorktree({ kind: 'claude', cwd: worktree, agentRoot, profileEnv: { CLAUDE_CONFIG_DIR: profile } })
    const config = JSON.parse(readFileSync(join(profile, '.claude.json'), 'utf8'))
    expect(config.projects[agentRoot].hasTrustDialogAccepted).toBe(true)
    expect(config.projects[repo].hasTrustDialogAccepted).toBe(true)
  })
})
