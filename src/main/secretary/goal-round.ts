import type {
  SecretaryGoal,
  SecretaryGoalCriterion,
  SecretaryGoalStatus,
  SecretaryGoalVerification,
  SecretaryRunNotice
} from '@shared/contracts/secretary'
import { verificationPassed } from './goal-verify'

export type GoalModelStatus = 'met' | 'continue' | 'blocked' | null

export interface GoalRoundDecision {
  /** 'active' means another round starts. */
  status: Extract<SecretaryGoalStatus, 'active' | 'met' | 'blocked' | 'exhausted'>
  reason: string
}

/**
 * The model proposes; the code decides. A goal is only met when the model says
 * so and every check Bikorch ran passed. Failing checks force another round
 * until the round limit.
 */
export function decideGoalRound(input: {
  goal: Pick<SecretaryGoal, 'round' | 'maxRounds'>
  modelStatus: GoalModelStatus
  verification: SecretaryGoalVerification[]
  hasNextPlan: boolean
}): GoalRoundDecision {
  const passed = verificationPassed(input.verification)
  if (input.modelStatus === 'met' && passed) return { status: 'met', reason: 'All criteria met and every check passed.' }
  if (input.modelStatus === 'blocked') return { status: 'blocked', reason: 'The Manager needs a decision or change from you.' }
  if (input.goal.round >= input.goal.maxRounds) {
    return { status: 'exhausted', reason: `Stopped after ${input.goal.maxRounds} rounds without meeting every criterion.` }
  }
  if (!input.hasNextPlan) return { status: 'blocked', reason: 'The Manager found no next step a CLI can take.' }
  return {
    status: 'active',
    reason: input.modelStatus === 'met' ? 'The Manager called it done, but a check failed; trying again.' : 'Work remains; starting the next round.'
  }
}

/** Reads the model's per-criterion verdicts, keeping only known criteria. */
export function readCriteria(raw: unknown, criteria: string[]): SecretaryGoalCriterion[] {
  const list = Array.isArray(raw) ? raw : []
  return criteria.map((criterion, index) => {
    const match = list.find((item) => item && typeof item === 'object' && (item as Record<string, unknown>).criterion === criterion)
      ?? list[index]
    const body = match && typeof match === 'object' ? (match as Record<string, unknown>) : {}
    return {
      criterion,
      met: body.met === true,
      evidence: typeof body.evidence === 'string' ? body.evidence.replace(/\s+/g, ' ').trim().slice(0, 240) : ''
    }
  })
}

/** The completion notice for a goal round: a checklist instead of free text. */
export function goalNotice(input: {
  goal: Pick<SecretaryGoal, 'objective' | 'round' | 'maxRounds'>
  decision: GoalRoundDecision
  criteria: SecretaryGoalCriterion[]
  verification: SecretaryGoalVerification[]
  summary: string
  modelNotice: SecretaryRunNotice
}): SecretaryRunNotice {
  const checks = input.verification
    .filter((item) => !item.skipped)
    .map((item) => `${item.exitCode === 0 ? '✓' : '✗'} ${item.command} → exit ${item.exitCode ?? '?'}`)
  const checklist = input.criteria.map((item) => `${item.met ? '✓' : '✗'} ${item.criterion}`)
  const items = [...checklist, ...checks].slice(0, 6)
  const objective = input.goal.objective.length > 70 ? `${input.goal.objective.slice(0, 69)}…` : input.goal.objective
  if (input.decision.status === 'met') {
    return { headline: `Goal done: ${objective}`, highlights: items }
  }
  if (input.decision.status === 'active') {
    return {
      headline: `Round ${input.goal.round + 1}/${input.goal.maxRounds} started: ${input.summary || input.decision.reason}`,
      highlights: items
    }
  }
  return {
    headline: input.decision.status === 'exhausted'
      ? `Goal not finished after ${input.goal.maxRounds} rounds: ${objective}`
      : `Goal paused: ${input.summary || input.decision.reason}`,
    highlights: items.length > 0 ? items : input.modelNotice.highlights
  }
}
