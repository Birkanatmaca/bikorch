import { execFile, spawn } from 'child_process'
import { existsSync, writeFileSync } from 'fs'
import { join } from 'path'
import { shell } from 'electron'
import type { GitSetupStatus } from '@shared/contracts/git'

/**
 * The Manager runs every task in its own Git worktree, so a project needs Git,
 * a repository and at least one commit. A clean Mac has none of these: /usr/bin/git
 * is only a stub that asks to install Apple's Command Line Tools.
 */

function run(command: string, args: string[], cwd?: string): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(command, args, { cwd, timeout: 15_000, windowsHide: true, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({ ok: !error, stdout: String(stdout ?? '').trim(), stderr: String(stderr ?? '').trim() })
    })
  })
}

async function gitInstalled(platform: NodeJS.Platform): Promise<boolean> {
  if (platform === 'darwin') {
    // Asking the stub for a version would pop Apple's install dialog. xcode-select -p
    // answers quietly; a Homebrew Git also counts.
    if ((await run('xcode-select', ['-p'])).ok) return true
    return ['/opt/homebrew/bin/git', '/usr/local/bin/git'].some((path) => existsSync(path))
  }
  return (await run('git', ['--version'])).ok
}

export async function inspectGitSetup(projectRoot: string, platform: NodeJS.Platform = process.platform): Promise<GitSetupStatus> {
  if (!(await gitInstalled(platform))) {
    return { gitInstalled: false, isRepo: false, hasCommits: false, identityConfigured: false }
  }
  const inside = await run('git', ['rev-parse', '--is-inside-work-tree'], projectRoot)
  const isRepo = inside.ok && inside.stdout === 'true'
  const hasCommits = isRepo && (await run('git', ['rev-parse', '--verify', '--quiet', 'HEAD'], projectRoot)).ok
  const name = await run('git', ['config', 'user.name'], projectRoot)
  const email = await run('git', ['config', 'user.email'], projectRoot)
  return {
    gitInstalled: true,
    isRepo,
    hasCommits,
    identityConfigured: Boolean(name.stdout && email.stdout)
  }
}

/** Starts the platform's Git installer. macOS shows Apple's own confirmation dialog. */
export async function installGitTools(platform: NodeJS.Platform = process.platform): Promise<{ ok: boolean; message: string }> {
  if (platform === 'darwin') {
    const child = spawn('xcode-select', ['--install'], { detached: true, stdio: 'ignore' })
    child.unref()
    return { ok: true, message: 'Follow the macOS installer window, then check again. It usually takes a few minutes.' }
  }
  if (platform === 'win32') {
    await shell.openExternal('https://git-scm.com/downloads/win')
    return { ok: true, message: 'Install Git for Windows from the page that opened, then check again.' }
  }
  return { ok: false, message: 'Install Git with your package manager (for example: sudo apt install git), then check again.' }
}

const DEFAULT_GITIGNORE = [
  '# Created by Bikorch when Git was set up for this project',
  'node_modules/',
  '.venv/',
  '__pycache__/',
  'dist/',
  'build/',
  '.next/',
  '.env',
  '.env.*',
  '.DS_Store',
  ''
].join('\n')

export interface GitInitRequest {
  name?: string
  email?: string
}

/**
 * Makes the project ready for Manager work: git init when needed, the user's
 * name and email for this repository when Git has none, a starter .gitignore
 * when there is none, and a first commit of the current files.
 */
export async function initializeGitRepo(projectRoot: string, identity: GitInitRequest = {}): Promise<{ ok: boolean; error?: string; status: GitSetupStatus }> {
  const fail = async (error: string) => ({ ok: false, error, status: await inspectGitSetup(projectRoot) })
  let status = await inspectGitSetup(projectRoot)
  if (!status.gitInstalled) return fail('Git is not installed yet.')
  if (!status.isRepo) {
    const init = await run('git', ['init'], projectRoot)
    if (!init.ok) return fail(init.stderr || 'git init failed')
  }
  if (!status.identityConfigured) {
    const name = identity.name?.trim()
    const email = identity.email?.trim()
    if (!name || !email || !/^[^\s@]+@[^\s@]+$/.test(email)) return fail('Enter your name and email for commits.')
    if (!(await run('git', ['config', 'user.name', name], projectRoot)).ok) return fail('Could not save your Git name')
    if (!(await run('git', ['config', 'user.email', email], projectRoot)).ok) return fail('Could not save your Git email')
  }
  status = await inspectGitSetup(projectRoot)
  if (!status.hasCommits) {
    const gitignore = join(projectRoot, '.gitignore')
    if (!existsSync(gitignore)) writeFileSync(gitignore, DEFAULT_GITIGNORE, 'utf8')
    const add = await run('git', ['add', '-A'], projectRoot)
    if (!add.ok) return fail(add.stderr || 'git add failed')
    const commit = await run('git', ['commit', '--allow-empty', '-m', 'Initial commit'], projectRoot)
    if (!commit.ok) return fail(commit.stderr || 'git commit failed')
  }
  return { ok: true, status: await inspectGitSetup(projectRoot) }
}
