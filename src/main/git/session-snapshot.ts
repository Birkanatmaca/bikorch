import { spawn } from 'child_process'
import { access } from 'fs/promises'
import type { GitSessionSnapshot } from '@shared/contracts/git'
import { parseCommitLog, parsePorcelainPaths } from '../developer-intelligence/session-timeline'

function runGit(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn('git', args, { cwd, windowsHide: true })
    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    proc.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    proc.on('error', reject)
    proc.on('close', (code) => {
      if (code === 0) resolve(stdout)
      else reject(new Error(stderr.trim() || `git exited with code ${code}`))
    })
  })
}

const EMPTY: GitSessionSnapshot = { headSha: null, changedFiles: [], commits: [] }

export async function snapshotAgentGit(cwd: string, sinceSha?: string): Promise<GitSessionSnapshot> {
  if (!cwd) return EMPTY
  try {
    await access(cwd)
  } catch {
    return EMPTY
  }

  try {
    const headSha = (await runGit(cwd, ['rev-parse', 'HEAD']).catch(() => '')).trim() || null
    const status = await runGit(cwd, ['-c', 'core.quotepath=false', 'status', '--porcelain']).catch(() => '')
    const changed = new Set(parsePorcelainPaths(status))

    let commits: GitSessionSnapshot['commits'] = []
    if (sinceSha && headSha && sinceSha !== headSha) {
      const range = `${sinceSha}..HEAD`
      const log = await runGit(cwd, ['log', '--format=%h%x1f%s', '-n', '20', range]).catch(() => '')
      commits = parseCommitLog(log)
      const names = await runGit(cwd, ['diff', '--name-only', sinceSha]).catch(() => '')
      for (const line of names.split(/\r?\n/)) {
        const path = line.trim().replace(/\\/g, '/')
        if (path) changed.add(path)
        if (changed.size >= 80) break
      }
    }

    return {
      headSha,
      changedFiles: [...changed].slice(0, 80),
      commits
    }
  } catch {
    return EMPTY
  }
}
