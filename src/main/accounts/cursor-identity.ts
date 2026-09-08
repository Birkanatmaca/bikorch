export interface CursorTokenIdentity {
  email?: string
  name?: string
  subject?: string
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function pickString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = asString(record[key])
    if (value) return value
  }
  return undefined
}

export function looksLikeEmail(value: string | undefined): value is string {
  return Boolean(value && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))
}

export function identityFromCursorJwt(token: string): CursorTokenIdentity | undefined {
  const encoded = token.split('.')[1]
  if (!encoded) return undefined
  try {
    const normalized = encoded.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
    const payload = asRecord(JSON.parse(Buffer.from(padded, 'base64').toString('utf8')))
    if (!payload) return undefined
    const rawEmail = pickString(payload, ['email', 'email_address'])
    const subject = asString(payload.sub)
    const email = looksLikeEmail(rawEmail)
      ? rawEmail
      : looksLikeEmail(subject)
        ? subject
        : undefined
    const name = pickString(payload, ['name', 'displayName', 'given_name', 'preferred_username'])
    if (!email && !name && !subject) return undefined
    return {
      ...(email ? { email } : {}),
      ...(name ? { name } : {}),
      ...(subject ? { subject } : {})
    }
  } catch {
    return undefined
  }
}

export function cursorIdentitiesMatch(
  left: CursorTokenIdentity | undefined,
  right: CursorTokenIdentity | undefined
): boolean {
  if (!left || !right) return false
  if (left.subject && right.subject) return left.subject === right.subject
  if (looksLikeEmail(left.email) && looksLikeEmail(right.email)) {
    return left.email.toLowerCase() === right.email.toLowerCase()
  }
  return false
}
