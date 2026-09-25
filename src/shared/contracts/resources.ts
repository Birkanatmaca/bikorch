export const RESOURCE_PROFILES = ['performance', 'balanced', 'memory-saver'] as const

export type ResourceProfile = (typeof RESOURCE_PROFILES)[number]

export const DEFAULT_RESOURCE_PROFILE: ResourceProfile = 'balanced'

export interface ResourceProfileLimits {
  /** Destroy a detached ChatGPT/Claude webview after this idle period. */
  webChatIdleMs: number
  /**
   * Destroy a mounted-but-not-visible browser guest after this idle period.
   * `0` means keep the guest while the panel stays mounted.
   */
  browserIdleMs: number
  terminalScrollback: number
  cliTerminalScrollback: number
  /** Extra inactive projects whose large diff payloads may stay in RAM. */
  inactiveDiffCacheProjects: number
  /** Soft cap for isolation repo states in the main-process memory map. */
  isolationMemoryRepos: number
  /** Multiply non-critical UI poll intervals while the window is hidden. */
  hiddenPollMultiplier: number
  /**
   * Future idle-CLI stop delay. `null` disables auto-stop so AgentRun work
   * cannot be killed by a memory profile.
   */
  idleCliStopMs: number | null
}

export const RESOURCE_PROFILE_LIMITS: Record<ResourceProfile, ResourceProfileLimits> = {
  performance: {
    webChatIdleMs: 15 * 60_000,
    browserIdleMs: 0,
    terminalScrollback: 8000,
    cliTerminalScrollback: 8000,
    inactiveDiffCacheProjects: 6,
    isolationMemoryRepos: 24,
    hiddenPollMultiplier: 1,
    idleCliStopMs: null
  },
  balanced: {
    webChatIdleMs: 60_000,
    browserIdleMs: 120_000,
    terminalScrollback: 4000,
    cliTerminalScrollback: 4000,
    inactiveDiffCacheProjects: 2,
    isolationMemoryRepos: 8,
    hiddenPollMultiplier: 3,
    idleCliStopMs: null
  },
  'memory-saver': {
    webChatIdleMs: 15_000,
    browserIdleMs: 30_000,
    terminalScrollback: 2000,
    cliTerminalScrollback: 1500,
    inactiveDiffCacheProjects: 1,
    isolationMemoryRepos: 4,
    hiddenPollMultiplier: 6,
    idleCliStopMs: null
  }
}

export const RESOURCE_PROFILE_COPY: Record<
  ResourceProfile,
  { label: string; description: string }
> = {
  performance: {
    label: 'Performance',
    description: 'Keep webviews and terminals ready. Highest memory use.'
  },
  balanced: {
    label: 'Balanced',
    description: 'Idle ChatGPT/Claude guests and unused caches are released after a short wait.'
  },
  'memory-saver': {
    label: 'Memory Saver',
    description: 'Aggressively free hidden browser, chat, and diff caches. Live CLI processes stay running.'
  }
}

export function isResourceProfile(value: unknown): value is ResourceProfile {
  return value === 'performance' || value === 'balanced' || value === 'memory-saver'
}

export function parseResourceProfile(value: unknown): ResourceProfile {
  return isResourceProfile(value) ? value : DEFAULT_RESOURCE_PROFILE
}

export function resourceLimitsFor(profile: ResourceProfile): ResourceProfileLimits {
  return RESOURCE_PROFILE_LIMITS[profile]
}

export const RESOURCES_IPC = {
  GET_PROFILE: 'resources:get-profile',
  SET_PROFILE: 'resources:set-profile',
  SNAPSHOT: 'resources:snapshot',
  DISK_SNAPSHOT: 'resources:disk-snapshot',
  CLEAR_BROWSER_CACHE: 'resources:clear-browser-cache'
} as const

export interface ResourceDiskSnapshot {
  collectedAt: number
  appDataBytes: number
  accountProfilesBytes: number
  browserSessionBytes: number
  musicBytes: number
  otherBytes: number
  browserCacheBytes: number
}

export interface ResourceElectronProcess {
  pid: number
  type: string
  name?: string
  workingSetKb: number
  cpuPercent: number
}

export interface ResourceProcessSnapshot {
  collectedAt: number
  profile: ResourceProfile
  electronProcesses: ResourceElectronProcess[]
  electronWorkingSetKb: number
  workspaceDatabase: { bytes: number | null; pendingChanges: boolean }
  ptyHost: {
    connected: boolean
    alive: boolean
    pid: number | null
    runningSessions: number
  }
  ptyManager: {
    boundSessions: number
    durableSessions: number
    inProcessSessions: number
  }
}
