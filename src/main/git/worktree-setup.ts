import { spawn } from 'child_process'
import { copyFile, lstat, symlink, unlink } from 'fs/promises'
import { join } from 'path'
import { constants } from 'fs'
import {
  DEFAULT_WORKTREE_PROVISION,
  WORKTREE_LOCAL_FILE_CATALOG,
  parseWorktreeProvision,
  type WorktreeLocalFileName,
  type WorktreeProvisionSettings
} from '@shared/contracts/git'
import { pathExists } from './git-exec'

const SETUP_TIMEOUT_MS = 120_000

export type WorktreeSetupRunner = (
  cwd: string,
  command: string,
  args: string[]
) => Promise<{ ok: boolean; output: string }>

let setupRunner: WorktreeSetupRunner | null = null

/** Test hook for the "Run setup command" dependency mode. */
export function setWorktreeSetupRunner(runner: WorktreeSetupRunner | null): void {
  setupRunner = runner
}

export async function listPresentWorktreeLocalFiles(
  repoRoot: string
): Promise<WorktreeLocalFileName[]> {
  const present: WorktreeLocalFileName[] = []
  for (const name of WORKTREE_LOCAL_FILE_CATALOG) {
    if (await pathExists(join(repoRoot, name))) present.push(name)
  }
  return present
}

export async function detectWorktreeSetupCommand(
  cwd: string
): Promise<{ command: string; args: string[] } | null> {
  if (!(await pathExists(join(cwd, 'package.json')))) return null
  if (await pathExists(join(cwd, 'pnpm-lock.yaml'))) return { command: 'pnpm', args: ['install'] }
  if (await pathExists(join(cwd, 'yarn.lock'))) return { command: 'yarn', args: ['install'] }
  if ((await pathExists(join(cwd, 'bun.lockb'))) || (await pathExists(join(cwd, 'bun.lock')))) {
    return { command: 'bun', args: ['install'] }
  }
  return { command: 'npm', args: ['install'] }
}

async function copyAllowedFile(fromRoot: string, toRoot: string, name: string): Promise<void> {
  const source = join(fromRoot, name)
  const dest = join(toRoot, name)
  if (!(await pathExists(source)) || (await pathExists(dest))) return
  await copyFile(source, dest, constants.COPYFILE_EXCL).catch(() => undefined)
}

async function linkNodeModules(fromRoot: string, toRoot: string): Promise<void> {
  const source = join(fromRoot, 'node_modules')
  const dest = join(toRoot, 'node_modules')
  if (!(await pathExists(source)) || (await pathExists(dest))) return
  const sourceStat = await lstat(source).catch(() => null)
  if (!sourceStat?.isDirectory() && !sourceStat?.isSymbolicLink()) return
  const type = process.platform === 'win32' ? 'junction' : 'dir'
  await symlink(source, dest, type).catch(() => undefined)
}

async function dropSharedNodeModulesLink(worktreePath: string): Promise<void> {
  const dest = join(worktreePath, 'node_modules')
  const destStat = await lstat(dest).catch(() => null)
  if (!destStat?.isSymbolicLink()) return
  await unlink(dest).catch(() => undefined)
}

function runSetupCommand(
  cwd: string,
  command: string,
  args: string[]
): Promise<{ ok: boolean; output: string }> {
  if (setupRunner) return setupRunner(cwd, command, args)
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      windowsHide: true,
      env: { ...process.env, CI: '1', npm_config_progress: 'false' }
    })
    let output = ''
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      resolve({ ok: false, output: output || `timed out running ${command} ${args.join(' ')}` })
    }, SETUP_TIMEOUT_MS)
    child.stdout?.on('data', (chunk: Buffer) => {
      output += chunk.toString()
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      output += chunk.toString()
    })
    child.on('error', (error) => {
      clearTimeout(timer)
      resolve({ ok: false, output: error.message })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ ok: code === 0, output })
    })
  })
}

async function runSetupInstall(worktreePath: string): Promise<void> {
  const spec = await detectWorktreeSetupCommand(worktreePath)
  if (!spec) return
  await runSetupCommand(worktreePath, spec.command, spec.args)
}

/**
 * Copy only the files this repo explicitly allowed, then apply the dependency
 * mode. Secrets (.env, .npmrc) are off by default. Sharing node_modules is
 * a speed option, not an isolation guarantee.
 */
export async function provisionWorktree(
  repoRoot: string,
  worktreePath: string,
  settings: WorktreeProvisionSettings = DEFAULT_WORKTREE_PROVISION
): Promise<void> {
  if (repoRoot === worktreePath) return
  const provision = parseWorktreeProvision(settings)
  for (const name of provision.copyLocalFiles) {
    await copyAllowedFile(repoRoot, worktreePath, name)
  }
  if (provision.dependencyMode === 'share') {
    await linkNodeModules(repoRoot, worktreePath)
    return
  }
  await dropSharedNodeModulesLink(worktreePath)
  if (provision.dependencyMode === 'setup') {
    await runSetupInstall(worktreePath)
  }
}
