import { execFile } from 'child_process'
import { basename } from 'path'
import type { GitActivity } from '@shared/contracts/dashboard'
import { listPersistedProjectFolders } from '../persistence/database'
import { localDate } from './claude-activity'

const CACHE_MS = 10 * 60_000

let cached: GitActivity | null = null

function git(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile('git', args, { cwd, timeout: 20_000, maxBuffer: 16 * 1024 * 1024 }, (_error, stdout) => resolve(String(stdout ?? '')))
  })
}

/** Your commits per day across the projects open in Bikorch, each commit counted once. */
export async function getGitActivity(force = false): Promise<GitActivity> {
  if (cached && !force && Date.now() - cached.computedAt < CACHE_MS) return cached
  const seenRepos = new Set<string>()
  const seenCommits = new Set<string>()
  const days: Record<string, number> = {}
  const projects: GitActivity['projects'] = []
  for (const folder of listPersistedProjectFolders()) {
    const root = (await git(folder, ['rev-parse', '--show-toplevel'])).trim()
    if (!root || seenRepos.has(root)) continue
    seenRepos.add(root)
    const email = (await git(root, ['config', 'user.email'])).trim()
    if (!email) continue
    const log = await git(root, ['log', '--all', '--since=1 year ago', `--author=${email}`, '--format=%H %at'])
    let commits = 0
    for (const line of log.split('\n')) {
      const [hash, seconds] = line.trim().split(' ')
      if (!hash || !seconds || seenCommits.has(hash)) continue
      seenCommits.add(hash)
      const date = localDate(Number(seconds) * 1000)
      if (!date) continue
      days[date] = (days[date] ?? 0) + 1
      commits += 1
    }
    if (commits > 0) projects.push({ name: basename(root), commits })
  }
  cached = {
    computedAt: Date.now(),
    days,
    projects: projects.sort((a, b) => b.commits - a.commits),
    total: seenCommits.size
  }
  return cached
}
