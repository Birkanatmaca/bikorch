import { describe, expect, it } from 'vitest'
import {
  SECRETARY_CHAT_RESPONSE_FORMAT,
  SECRETARY_FINAL_DECISION_RESPONSE_FORMAT,
  SECRETARY_FINAL_REPORT_RESPONSE_FORMAT,
  SECRETARY_PLAN_RESPONSE_FORMAT
} from '../response-schema'

describe('Secretary response schemas', () => {
  it('makes the planning response a closed plan object', () => {
    expect(SECRETARY_PLAN_RESPONSE_FORMAT).toMatchObject({
      name: 'secretary_plan',
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['overview', 'assumptions', 'assignments']
      }
    })
  })

  it('requires an explicit reply, CLI opening decision, and nullable plan for chat', () => {
    const schema = SECRETARY_CHAT_RESPONSE_FORMAT.schema as {
      required?: string[]
      properties?: { plan?: { anyOf?: unknown[] } }
    }
    expect(schema.required).toEqual(['reply', 'openKinds', 'plan'])
    expect(schema.properties?.plan?.anyOf).toContainEqual({ type: 'null' })
  })

  it('allows only a concise final explanation after CLI work ends', () => {
    expect(SECRETARY_FINAL_REPORT_RESPONSE_FORMAT).toMatchObject({
      name: 'secretary_final_report',
      schema: {
        additionalProperties: false,
        required: ['reply']
      }
    })
  })

  it('keeps a post-CLI follow-up behind the same plan response shape', () => {
    expect(SECRETARY_FINAL_DECISION_RESPONSE_FORMAT.schema).toBe(SECRETARY_CHAT_RESPONSE_FORMAT.schema)
  })
})
