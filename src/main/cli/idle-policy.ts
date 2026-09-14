import type { ResourceProfileLimits } from '@shared/contracts/resources'

/**
 * Idle CLI auto-stop is wired but disabled on every profile (`idleCliStopMs: null`).
 * AgentRun + durable PTY reattach stay in charge of process lifetime.
 */
export function shouldAutoStopIdleCli(limits: ResourceProfileLimits, idleMs: number): boolean {
  if (limits.idleCliStopMs == null) return false
  if (!Number.isFinite(idleMs) || idleMs < 0) return false
  return idleMs >= limits.idleCliStopMs
}
