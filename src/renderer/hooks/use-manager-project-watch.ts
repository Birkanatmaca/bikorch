import { useEffect, useRef, useState } from 'react'
import type { PanelDefinition, Project } from '@shared/types'
import type { SecretaryChatRequest } from '@shared/contracts/secretary'
import { useTerminalStore } from '@renderer/stores/terminal-store'
import { fingerprint, managerFailureSignals } from '@renderer/lib/manager-watch'

type InspectionPurpose = NonNullable<SecretaryChatRequest['purpose']>
const REVIEW_INTERVAL = 5 * 60_000
const reviewCache = new Map<string, { root: string; signature: string; reviewedAt: number; failures: Set<string> }>()

function watchPreference(projectId: string): boolean {
  try { return localStorage.getItem(`bikorch:manager-watch:${projectId}`) !== 'paused' } catch { return true }
}

export function useManagerProjectWatch(input: {
  project: Project
  panels: PanelDefinition[]
  ready: boolean
  busy: boolean
  inspect: (purpose: InspectionPurpose, automatic: boolean) => Promise<boolean>
}): { enabled: boolean; setEnabled: (enabled: boolean) => void; lastReviewedAt: number | null } {
  const [enabled, updateEnabled] = useState(() => watchPreference(input.project.id))
  const [lastReviewedAt, setLastReviewedAt] = useState<number | null>(null)
  const latest = useRef(input)
  latest.current = input

  useEffect(() => {
    updateEnabled(watchPreference(input.project.id))
    setLastReviewedAt(reviewCache.get(input.project.id)?.reviewedAt ?? null)
  }, [input.project.id])

  useEffect(() => {
    if (!enabled || !input.ready || !input.project.folderPath) return
    const projectId = input.project.id
    const previous = reviewCache.get(projectId)
    const cache = previous?.root === input.project.folderPath ? previous
      : { root: input.project.folderPath, signature: '', reviewedAt: 0, failures: new Set<string>() }
    reviewCache.set(projectId, cache)
    let active = true
    let checking = false
    let nextReviewCheck = 0
    let nextErrorCheck = 0
    const tick = async (): Promise<void> => {
      const current = latest.current
      if (!active || checking || current.busy || !current.ready || current.project.id !== projectId) return
      checking = true
      try {
        const terminal = useTerminalStore.getState()
        const signals = managerFailureSignals(current.panels, terminal.sessions, terminal.errors, terminal.outputTails)
        const pending = signals.filter((signal) => !cache.failures.has(signal.key))
        // Allow the same error to be diagnosed again after a session recovers.
        const liveKeys = new Set(signals.map((signal) => signal.key))
        for (const key of cache.failures) {
          const owner = current.panels.find((panel) => key.startsWith(`${panel.id}:`))
          const status = owner ? terminal.sessions[owner.id] : undefined
          if (!liveKeys.has(key) && status !== 'busy' && status !== 'starting') cache.failures.delete(key)
        }
        if (pending.length > 0 && Date.now() >= nextErrorCheck) {
          nextErrorCheck = Date.now() + 60_000
          if (await current.inspect('error-diagnosis', true)) {
            pending.forEach((signal) => cache.failures.add(signal.key))
          }
          return
        }
        if (Date.now() < nextReviewCheck) return
        nextReviewCheck = Date.now() + REVIEW_INTERVAL
        if (Date.now() - cache.reviewedAt < REVIEW_INTERVAL) return
        const git = await window.api.git.status({ projectRoot: current.project.folderPath! }).catch(() => null)
        if (!active || latest.current.busy || latest.current.project.id !== projectId) return
        const changes = [...(git?.changes ?? [])].sort((left, right) => left.path.localeCompare(right.path))
        const excerpts: string[] = []
        // Hash modified contents locally so another edit to an already-dirty file is observable.
        // Batch reads to keep large working trees from opening hundreds of requests at once.
        for (let offset = 0; offset < Math.min(changes.length, 100); offset += 6) {
          if (!active) return
          excerpts.push(...await Promise.all(changes.slice(offset, Math.min(offset + 6, 100)).map((change) =>
            window.api.git.diff({ projectRoot: current.project.folderPath!, filePath: change.path, status: change.status })
              .then((diff) => fingerprint(diff.modified)).catch(() => change.path)
          )))
        }
        const signature = fingerprint(JSON.stringify({ root: current.project.folderPath, branch: git?.branch, commit: git?.recentCommits[0]?.hash, changes, excerpts,
          largeTreeCheck: changes.length > 100 ? Math.floor(Date.now() / REVIEW_INTERVAL) : null }))
        if (!active || latest.current.busy || latest.current.project.id !== projectId || signature === cache.signature) return
        if (await latest.current.inspect('project-review', true)) {
          cache.signature = signature
          cache.reviewedAt = Date.now()
          if (active) setLastReviewedAt(cache.reviewedAt)
        }
      } catch {
        // A failed local status read can be retried on the next bounded check.
      } finally { checking = false }
    }
    const initial = window.setTimeout(() => { void tick() }, 1500)
    const timer = window.setInterval(() => { void tick() }, 5000)
    return () => { active = false; window.clearTimeout(initial); window.clearInterval(timer) }
  }, [enabled, input.ready, input.project.id, input.project.folderPath])

  const setEnabled = (next: boolean): void => {
    updateEnabled(next)
    try { localStorage.setItem(`bikorch:manager-watch:${input.project.id}`, next ? 'active' : 'paused') } catch { /* Ephemeral preference remains usable. */ }
  }
  return { enabled, setEnabled, lastReviewedAt }
}
