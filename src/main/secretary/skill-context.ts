import type { DeveloperSkill, SkillDraft } from '@shared/contracts/developer-intelligence'
import { createSkill, listSkills, listSkillsForManager } from '../developer-intelligence/service'
import { messageMentionsSkills, messageRequestsSkill } from '../developer-intelligence/skills'
import { sanitizeSecretaryModelText } from './input-sanitizer'

export interface SecretarySkillGuide {
  name: string
  description: string
  instructions: string
  enabled: boolean
}

/** Matching skills for ordinary work. The full library when this turn is about skills. */
export function secretarySkillContext(query: string, message = ''): SecretarySkillGuide[] {
  const library = messageMentionsSkills(message) ? listSkills().slice(0, 24) : listSkillsForManager(query)
  return library.map((skill) => ({
    name: sanitizeSecretaryModelText(skill.name, 80),
    description: sanitizeSecretaryModelText(skill.description, 280),
    instructions: sanitizeSecretaryModelText(skill.instructions, 2000),
    enabled: skill.enabled
  }))
}

/** Create or revise skills only when this turn asked to write them. */
export function saveManagerSkills(message: string, raw: unknown): DeveloperSkill[] {
  if (!messageRequestsSkill(message)) return []
  const items = Array.isArray(raw) ? raw : []
  const saved: DeveloperSkill[] = []
  for (const item of items.slice(0, 8)) {
    if (!item || typeof item !== 'object') continue
    const skill = createSkill(item as SkillDraft, 'manager')
    if (skill) saved.push(skill)
  }
  return saved
}
