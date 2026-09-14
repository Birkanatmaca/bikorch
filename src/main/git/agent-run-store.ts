import { mkdir, readFile, rename, writeFile } from 'fs/promises'
import { dirname, join } from 'path'
import type {
  AgentRunRecord,
  AgentWorktreeKind,
  IsolationFoldSession,
  WorktreeProvisionSettings,
  WorkspaceIsolation
} from '@shared/contracts/git'
import { parseWorktreeProvision } from '@shared/contracts/git'
import { AGENT_WORKTREE_KINDS } from '@shared/contracts/git'
import { normalizeAgentRunStatus, isTerminalAgentRunStatus } from './agent-lifecycle'
import { canonicalRepoRoot, hashRepoRoot } from './worktree-paths'

export interface RepoIsolationState {
  repoRoot: string
  targetBranch: string
  targetSha: string
  runs: AgentRunRecord[]
  fold: IsolationFoldSession | null
  provision: WorktreeProvisionSettings
}

const memory = new Map<string, RepoIsolationState>()
const accessedAt = new Map<string, number>()

function storePath(baseDir: string, repoRoot: string): string {
  return join(baseDir, 'merge-queue', `${hashRepoRoot(repoRoot)}.json`)
}

function isolationKey(repoRoot: string): string {
  return canonicalRepoRoot(repoRoot)
}

function isKind(value: unknown): value is AgentWorktreeKind {
  return typeof value === 'string' && (AGENT_WORKTREE_KINDS as readonly string[]).includes(value)
}

function isPolicy(value: unknown): value is WorkspaceIsolation {
  return value === 'isolated' || value === 'shared'
}

function parseRun(raw: unknown): AgentRunRecord | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as AgentRunRecord
  if (typeof row.id !== 'string' || row.id.length < 8) return null
  if (!isKind(row.kind)) return null
  if (typeof row.title !== 'string' || typeof row.branch !== 'string') return null
  if (typeof row.worktreePath !== 'string' || typeof row.targetBranch !== 'string') return null
  if (typeof row.baseSha !== 'string') return null
  if (!isPolicy(row.isolationPolicy)) return null
  return {
    id: row.id,
    kind: row.kind,
    title: row.title.slice(0, 200),
    branch: row.branch.slice(0, 255),
    worktreePath: row.worktreePath.slice(0, 1000),
    targetBranch: row.targetBranch.slice(0, 255),
    baseSha: row.baseSha.slice(0, 64),
    isolationPolicy: row.isolationPolicy,
    status: normalizeAgentRunStatus(row.status),
    attachedPanelId: typeof row.attachedPanelId === 'string' ? row.attachedPanelId : null,
    writerSessionId: typeof row.writerSessionId === 'string' ? row.writerSessionId : null,
    lastCheckpointSha: typeof row.lastCheckpointSha === 'string' ? row.lastCheckpointSha : null,
    lastCheckpointAt: typeof row.lastCheckpointAt === 'number' ? row.lastCheckpointAt : null,
    createdAt: typeof row.createdAt === 'number' ? row.createdAt : Date.now(),
    updatedAt: typeof row.updatedAt === 'number' ? row.updatedAt : Date.now()
  }
}

function pinIsolationState(state: RepoIsolationState): boolean {
  if (state.fold) return true
  return state.runs.some((run) => !isTerminalAgentRunStatus(run.status))
}

function touch(key: string): void {
  accessedAt.set(key, Date.now())
}

let memoryLimit = 8

export function setIsolationMemoryLimit(limit: number): void {
  memoryLimit = Math.max(1, Math.floor(limit))
  evictIdleIsolationMemory(memoryLimit)
}

export function isolationMemorySize(): number {
  return memory.size
}

export function evictIdleIsolationMemory(limit: number): string[] {
  const cap = Math.max(1, Math.floor(limit))
  if (memory.size <= cap) return []
  const evicted: string[] = []
  const candidates = [...memory.entries()]
    .filter(([, state]) => !pinIsolationState(state))
    .sort((a, b) => (accessedAt.get(a[0]) ?? 0) - (accessedAt.get(b[0]) ?? 0))
  for (const [key] of candidates) {
    if (memory.size <= cap) break
    memory.delete(key)
    accessedAt.delete(key)
    evicted.push(key)
  }
  return evicted
}

function emptyState(repoRoot: string): RepoIsolationState {
  return {
    repoRoot,
    targetBranch: '',
    targetSha: '',
    runs: [],
    fold: null,
    provision: parseWorktreeProvision(undefined)
  }
}

export async function loadRepoIsolation(repoRoot: string, baseDir: string): Promise<RepoIsolationState> {
  const key = isolationKey(repoRoot)
  const cached = memory.get(key)
  if (cached) {
    touch(key)
    return cached
  }
  const file = storePath(baseDir, key)
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8')) as Partial<RepoIsolationState>
    const state: RepoIsolationState = {
      repoRoot: key,
      targetBranch: typeof parsed.targetBranch === 'string' ? parsed.targetBranch : '',
      targetSha: typeof parsed.targetSha === 'string' ? parsed.targetSha : '',
      runs: Array.isArray(parsed.runs) ? parsed.runs.map(parseRun).filter((run): run is AgentRunRecord => Boolean(run)) : [],
      fold: parsed.fold && typeof parsed.fold === 'object' ? (parsed.fold as IsolationFoldSession) : null,
      provision: parseWorktreeProvision(parsed.provision)
    }
    memory.set(key, state)
    touch(key)
    evictIdleIsolationMemory(memoryLimit)
    return state
  } catch {
    const state = emptyState(key)
    memory.set(key, state)
    touch(key)
    evictIdleIsolationMemory(memoryLimit)
    return state
  }
}

export async function saveRepoIsolation(state: RepoIsolationState, baseDir: string): Promise<void> {
  state.repoRoot = isolationKey(state.repoRoot)
  memory.set(state.repoRoot, state)
  touch(state.repoRoot)
  evictIdleIsolationMemory(memoryLimit)
  const file = storePath(baseDir, state.repoRoot)
  await mkdir(dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  const payload = JSON.stringify(state, null, 2)
  await writeFile(tmp, payload, 'utf8')
  await rename(tmp, file)
  persistSink?.(state)
}

export function upsertAgentRun(state: RepoIsolationState, patch: AgentRunRecord): AgentRunRecord {
  const now = Date.now()
  const existing = state.runs.find((run) => run.id === patch.id)
  const next: AgentRunRecord = existing
    ? { ...existing, ...patch, createdAt: existing.createdAt, updatedAt: now }
    : { ...patch, createdAt: patch.createdAt || now, updatedAt: now }
  state.runs = [...state.runs.filter((run) => run.id !== patch.id), next]
  return next
}

type IsolationPersistSink = (state: RepoIsolationState) => void
let persistSink: IsolationPersistSink | null = null

export function setIsolationPersistSink(sink: IsolationPersistSink | null): void {
  persistSink = sink
}

export function clearRepoIsolationMemory(): void {
  memory.clear()
  accessedAt.clear()
}
