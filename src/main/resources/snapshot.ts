import { app } from 'electron'
import { ptyManager } from '../cli/pty-manager'
import { ptyHostClient } from '../cli/pty-host/client'
import type { ResourceElectronProcess, ResourceProcessSnapshot } from '@shared/contracts/resources'
import { getResourceProfile } from './settings'
import { getPersistenceDiskUsage } from '../persistence/database'

function readMetrics(): ResourceElectronProcess[] {
  try {
    return app.getAppMetrics().map((metric) => ({
      pid: metric.pid,
      type: metric.type,
      ...(metric.serviceName ? { name: metric.serviceName } : {}),
      workingSetKb: metric.memory?.workingSetSize ?? 0,
      cpuPercent: metric.cpu?.percentCPUUsage ?? 0
    }))
  } catch {
    return []
  }
}

export function collectResourceSnapshot(): ResourceProcessSnapshot {
  const electronProcesses = readMetrics()
  const electronWorkingSetKb = electronProcesses.reduce((sum, item) => sum + item.workingSetKb, 0)
  const stats = ptyManager.runtimeStats()
  return {
    collectedAt: Date.now(),
    profile: getResourceProfile(),
    electronProcesses,
    electronWorkingSetKb,
    workspaceDatabase: getPersistenceDiskUsage(),
    ptyHost: {
      connected: ptyHostClient.isConnected(),
      alive: ptyHostClient.isHostAlive(),
      pid: ptyHostClient.hostPid(),
      runningSessions: ptyHostClient.runningSessionCount()
    },
    ptyManager: {
      boundSessions: stats.bound,
      durableSessions: stats.durable,
      inProcessSessions: stats.inProcess
    }
  }
}
