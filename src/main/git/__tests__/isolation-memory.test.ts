import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import type { AgentRunRecord } from '@shared/contracts/git'
import {
  clearRepoIsolationMemory,
  evictIdleIsolationMemory,
  isolationMemorySize,
  loadRepoIsolation,
  saveRepoIsolation,
  upsertAgentRun
} from '../agent-run-store'

function run(id: string, status: AgentRunRecord['status']): AgentRunRecord {
  return {
    id: `${id}-aaaa-bbbb-cccc-ddddeeee`,
    kind: 'cursor',
    title: id,
    branch: `bikorch/cursor-${id}`,
    worktreePath: `/tmp/${id}`,
    targetBranch: 'release',
    baseSha: 'abc',
    isolationPolicy: 'isolated',
    status,
    attachedPanelId: null,
    createdAt: 1,
    updatedAt: 1
  }
}

describe('isolation memory bound', () => {
  afterEach(() => {
    clearRepoIsolationMemory()
  })

  it('evicts merged repos and keeps dirty/active runs', async () => {
    const base = await mkdtemp(join(tmpdir(), 'bikorch-iso-mem-'))
    try {
      const merged = await loadRepoIsolation('/repos/old', base)
      upsertAgentRun(merged, run('old1', 'merged'))
      await saveRepoIsolation(merged, base)

      const abandoned = await loadRepoIsolation('/repos/gone', base)
      upsertAgentRun(abandoned, run('gone1', 'abandoned'))
      await saveRepoIsolation(abandoned, base)

      const live = await loadRepoIsolation('/repos/live', base)
      upsertAgentRun(live, run('live1', 'running'))
      await saveRepoIsolation(live, base)

      const evicted = evictIdleIsolationMemory(1)
      expect(evicted.length).toBeGreaterThan(0)
      expect(isolationMemorySize()).toBe(1)
      expect((await loadRepoIsolation('/repos/live', base)).runs[0]?.status).toBe('running')
    } finally {
      await rm(base, { recursive: true, force: true })
    }
  })
})
