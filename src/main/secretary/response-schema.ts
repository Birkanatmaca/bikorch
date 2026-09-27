import { AI_ACCOUNT_KINDS } from '@shared/contracts/accounts'
import { MANAGER_APP_ACTIONS, SECRETARY_ASSIGNMENT_MODES } from '@shared/contracts/secretary'

export interface SecretaryResponseFormat {
  name: string
  schema: Record<string, unknown>
}

const assignmentSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['panelId', 'kind', 'mode', 'title', 'instruction', 'expectedResult', 'rationale', 'usageNote', 'dependsOn'],
  properties: {
    panelId: { type: ['string', 'null'] },
    kind: { type: 'string', enum: AI_ACCOUNT_KINDS },
    mode: { type: 'string', enum: SECRETARY_ASSIGNMENT_MODES },
    title: { type: 'string' },
    instruction: { type: 'string' },
    expectedResult: { type: 'string' },
    rationale: { type: 'string' },
    usageNote: { type: 'string' },
    dependsOn: {
      type: 'array',
      items: { type: 'integer', minimum: 0, maximum: 7 }
    }
  }
} as const

const planSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['overview', 'assumptions', 'assignments'],
  properties: {
    overview: { type: 'string' },
    assumptions: {
      type: 'array',
      items: { type: 'string' }
    },
    assignments: {
      type: 'array',
      items: assignmentSchema
    }
  }
} as const

/** Strict response shape for the dedicated planning endpoint. */
export const SECRETARY_PLAN_RESPONSE_FORMAT: SecretaryResponseFormat = {
  name: 'secretary_plan',
  schema: planSchema
}

/** Strict response shape for an ordinary Secretary conversation turn. */
export const SECRETARY_CHAT_RESPONSE_FORMAT: SecretaryResponseFormat = {
  name: 'secretary_chat',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['reply', 'openKinds', 'plan', 'contextSummary', 'skills', 'actions'],
    properties: {
      reply: { type: 'string' },
      contextSummary: { type: 'string' },
      actions: {
        type: 'array',
        items: { type: 'string', enum: MANAGER_APP_ACTIONS }
      },
      skills: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'description', 'instructions'],
          properties: {
            name: { type: 'string' },
            description: { type: 'string' },
            instructions: { type: 'string' }
          }
        }
      },
      openKinds: {
        type: 'array',
        items: { type: 'string', enum: AI_ACCOUNT_KINDS }
      },
      plan: {
        anyOf: [
          planSchema,
          { type: 'null' }
        ]
      }
    }
  }
}

/** Strict shape for the final user-facing explanation after CLI work ends. */
export const SECRETARY_FINAL_REPORT_RESPONSE_FORMAT: SecretaryResponseFormat = {
  name: 'secretary_final_report',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['reply'],
    properties: {
      reply: { type: 'string' }
    }
  }
}

/** The post-CLI decision may either finish or create one more approval-gated plan. */
export const SECRETARY_FINAL_DECISION_RESPONSE_FORMAT: SecretaryResponseFormat = {
  name: 'secretary_final_decision',
  schema: SECRETARY_CHAT_RESPONSE_FORMAT.schema
}
