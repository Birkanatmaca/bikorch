import type { CliUsageKind } from './usage'

export interface AuthProfileRequest {
  kind: CliUsageKind
  accountId: string
  email?: string
}

export interface AuthProfileIdentity {
  email: string
  name: string
}

export interface AuthProfileResult {
  ok: boolean
  ready: boolean
  identity?: AuthProfileIdentity
  error?: string
}

export const AUTH_PROFILES_IPC = {
  IMPORT_CURRENT: 'auth-profiles:import-current',
  ACTIVATE: 'auth-profiles:activate',
  INSPECT: 'auth-profiles:inspect',
  REMOVE: 'auth-profiles:remove'
} as const
