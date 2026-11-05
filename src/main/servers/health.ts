import { execFile } from 'child_process'
import { Socket } from 'net'
import { parseSshTarget, sshCommandArgs } from '@shared/contracts/servers'
import {
  REMOTE_HEALTH_SCRIPT,
  healthWarnings,
  parseServerMetrics,
  type ServerHealth
} from '@shared/contracts/server-health'
import { sshSpawnConfig } from '../cli/adapters'

const CONNECT_TIMEOUT_MS = 4_000
const SSH_TIMEOUT_MS = 12_000

/** Time to open a TCP connection to the SSH port, or null when nothing answers. */
export function measureLatency(host: string, port: number, timeoutMs = CONNECT_TIMEOUT_MS): Promise<number | null> {
  return new Promise((resolve) => {
    const started = Date.now()
    const socket = new Socket()
    const done = (value: number | null): void => {
      socket.destroy()
      resolve(value)
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => done(Date.now() - started))
    socket.once('timeout', () => done(null))
    socket.once('error', () => done(null))
    socket.connect(port, host)
  })
}

/**
 * Reads metrics with keys only (BatchMode): no password prompt, no host-key
 * prompt. A server never signed in to from a terminal reports "reachable".
 */
function readMetrics(target: { user: string; host: string; port: number }): Promise<{ output: string; error: string | null }> {
  const ssh = sshSpawnConfig(target)
  if (!ssh) return Promise.resolve({ output: '', error: 'OpenSSH is not installed on this computer.' })
  const args = [
    '-o', 'BatchMode=yes',
    '-o', `ConnectTimeout=${Math.ceil(CONNECT_TIMEOUT_MS / 1000)}`,
    '-o', 'LogLevel=ERROR',
    ...sshCommandArgs(target),
    REMOTE_HEALTH_SCRIPT
  ]
  return new Promise((resolve) => {
    execFile(ssh.command, args, { timeout: SSH_TIMEOUT_MS, maxBuffer: 64 * 1024 }, (error, stdout, stderr) => {
      resolve({ output: String(stdout ?? ''), error: error ? String(stderr || error.message).trim() : null })
    })
  })
}

function sshProblem(error: string): string {
  if (/permission denied/i.test(error)) return 'Add your SSH key to this server to see its metrics.'
  if (/host key verification failed|no matching host key|REMOTE HOST IDENTIFICATION/i.test(error)) {
    return 'Open this server once in a terminal to confirm its host key.'
  }
  return 'Metrics unavailable over SSH.'
}

export async function checkServerHealth(serverId: string, raw: unknown): Promise<ServerHealth> {
  const target = parseSshTarget(raw)
  const base = { serverId, checkedAt: Date.now(), metrics: null }
  if (!target) return { ...base, state: 'down', latencyMs: null, note: 'This server address is not valid.' }
  const latencyMs = await measureLatency(target.host, target.port)
  if (latencyMs === null) return { ...base, state: 'down', latencyMs, note: `Nothing answers on port ${target.port}.` }
  const { output, error } = await readMetrics(target)
  const metrics = parseServerMetrics(output)
  if (!metrics) {
    return { ...base, state: 'reachable', latencyMs, note: error ? sshProblem(error) : 'Metrics need a Linux server.' }
  }
  const warnings = healthWarnings(metrics)
  return {
    ...base,
    checkedAt: Date.now(),
    state: warnings.length > 0 ? 'warning' : 'healthy',
    latencyMs,
    metrics,
    note: warnings.length > 0 ? warnings.join(' · ') : null
  }
}
