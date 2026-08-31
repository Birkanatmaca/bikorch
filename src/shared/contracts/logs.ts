export type AppLogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface AppLogEntry {
  id: number
  timestamp: number
  level: AppLogLevel
  source: string
  message: string
}

export interface GetLogsRequest {
  limit?: number
}

export interface GetLogsResponse {
  entries: AppLogEntry[]
}

export type LogEvent =
  | { type: 'entry'; entry: AppLogEntry }
  | { type: 'clear' }

export const LOGS_IPC = {
  GET: 'logs:get',
  CLEAR: 'logs:clear',
  EVENT: 'logs:event'
} as const
