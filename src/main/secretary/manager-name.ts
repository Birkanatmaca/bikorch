import { readMetaValue } from '../persistence/database'

export const DEFAULT_MANAGER_NAME = 'Bikorch Manager'
export const MANAGER_NAME_META_KEY = 'developer_secretary_display_name'

export function sanitizeManagerName(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const name = value.replace(/\s+/g, ' ').trim()
  if (!name || name.length > 40) return null
  if (!/^[\p{L}\p{N}][\p{L}\p{N} .'-]*$/u.test(name)) return null
  return name
}

export function readManagerDisplayName(): string {
  return sanitizeManagerName(readMetaValue(MANAGER_NAME_META_KEY)) ?? DEFAULT_MANAGER_NAME
}

export function managerIdentityLine(name: string): string {
  return `Your name is ${name}. Use that name when you refer to yourself. You run this workspace for the developer: plan the work, watch the CLIs you opened, and report what they did.`
}
