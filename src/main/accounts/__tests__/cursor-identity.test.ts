import { describe, expect, it } from 'vitest'
import {
  cursorIdentitiesMatch,
  identityFromCursorJwt,
  looksLikeEmail
} from '../cursor-identity'

function jwt(payload: Record<string, unknown>): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `header.${encoded}.sig`
}

describe('cursor token identity', () => {
  it('does not treat a username as an email', () => {
    const identity = identityFromCursorJwt(
      jwt({
        preferred_username: 'birkanatmacaa',
        email: 'birkan.atmaca@priente.com',
        name: 'birkanatmacaa',
        sub: 'user_1'
      })
    )
    expect(identity?.email).toBe('birkan.atmaca@priente.com')
    expect(identity?.name).toBe('birkanatmacaa')
    expect(identity?.subject).toBe('user_1')
  })

  it('ignores preferred_username when there is no email', () => {
    const identity = identityFromCursorJwt(jwt({ preferred_username: 'birkanatmacaa', sub: 'user_1' }))
    expect(identity?.email).toBeUndefined()
    expect(identity?.name).toBe('birkanatmacaa')
  })

  it('matches the same Cursor user by subject even when labels differ', () => {
    expect(
      cursorIdentitiesMatch(
        { email: 'birkan.atmaca@priente.com', name: 'Work', subject: 'user_1' },
        { email: 'unused@example.com', name: 'birkanatmacaa', subject: 'user_1' }
      )
    ).toBe(true)
  })

  it('does not match different Cursor users that happen to share an email fallback', () => {
    expect(
      cursorIdentitiesMatch(
        { email: 'birkan.atmaca@priente.com', subject: 'user_work' },
        { email: 'birkan.atmaca@priente.com', subject: 'user_personal' }
      )
    ).toBe(false)
  })

  it('recognizes emails', () => {
    expect(looksLikeEmail('birkan.atmaca@priente.com')).toBe(true)
    expect(looksLikeEmail('birkanatmacaa')).toBe(false)
  })
})
