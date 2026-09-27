import { redactSecrets } from './redaction'
import type { DeveloperSkill, SkillDraft } from '@shared/contracts/developer-intelligence'

export const SKILL_NAME_MAX = 80
export const SKILL_DESCRIPTION_MAX = 280
export const SKILL_INSTRUCTIONS_MAX = 4_000
export const SKILL_CONTEXT_LIMIT = 12
const SKILL_IMPORT_LIMIT = 20

export function messageMentionsSkills(message: string): boolean {
  return /\bskills?\b|yetenek/i.test(message.trim())
}

export function messageRequestsSkill(message: string): boolean {
  const text = message.trim()
  if (!messageMentionsSkills(text)) return false
  return /\b(save|add|create|remember|update|keep|store|make|define|edit|improve|revise|rewrite)\b|kaydet|ekle|oluştur|hatırla|güncelle|tanımla|geliştir|düzenle|iyileştir|\byap\b/i.test(text)
}

export function normalizeSkillDraft(input: unknown): SkillDraft | null {
  if (!input || typeof input !== 'object') return null
  const draft = input as Partial<SkillDraft>
  const name = clean(draft.name, SKILL_NAME_MAX)
  const instructions = clean(draft.instructions, SKILL_INSTRUCTIONS_MAX, true)
  if (!name || name.length < 2 || !instructions || instructions.length < 8) return null
  const description = clean(draft.description, SKILL_DESCRIPTION_MAX) || name
  return { name, description, instructions }
}

export function parseSkillDocument(text: string): SkillDraft[] {
  const trimmed = text.trim()
  if (!trimmed || trimmed.length > 100_000) return []
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return parseSkillJson(JSON.parse(trimmed) as unknown).slice(0, SKILL_IMPORT_LIMIT)
    } catch {
      return []
    }
  }
  const fromFrontmatter = parseFrontmatterSkill(trimmed)
  return fromFrontmatter ? [fromFrontmatter] : []
}

export function skillsForContext(skills: DeveloperSkill[], query: string): DeveloperSkill[] {
  const enabled = skills.filter((skill) => skill.enabled)
  const tokens = new Set(query.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 2))
  const ranked = enabled
    .map((skill) => ({
      skill,
      score: skillScore(skill, tokens)
    }))
    .sort((left, right) => right.score - left.score || right.skill.updatedAt - left.skill.updatedAt)
  return ranked.slice(0, SKILL_CONTEXT_LIMIT).map((item) => item.skill)
}

function skillScore(skill: DeveloperSkill, tokens: Set<string>): number {
  if (tokens.size === 0) return 0
  const haystack = `${skill.name} ${skill.description}`.toLowerCase()
  let score = 0
  for (const token of tokens) {
    if (haystack.includes(token)) score += 2
  }
  return score
}

function parseSkillJson(value: unknown): SkillDraft[] {
  if (Array.isArray(value)) return value.flatMap((item) => {
    const draft = normalizeSkillDraft(item)
    return draft ? [draft] : []
  })
  if (!value || typeof value !== 'object') return []
  const body = value as { skills?: unknown; name?: unknown; instructions?: unknown }
  if (Array.isArray(body.skills)) return parseSkillJson(body.skills)
  const draft = normalizeSkillDraft(body)
  return draft ? [draft] : []
}

function parseFrontmatterSkill(text: string): SkillDraft | null {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!match?.[1] || match[2] === undefined) return null
  const meta: Record<string, string> = {}
  for (const line of match[1].split('\n')) {
    const index = line.indexOf(':')
    if (index <= 0) continue
    const key = line.slice(0, index).trim().toLowerCase()
    const value = line.slice(index + 1).trim().replace(/^["']|["']$/g, '')
    if (key && value) meta[key] = value
  }
  const body = match[2].trim()
  return normalizeSkillDraft({
    name: meta.name,
    description: meta.description,
    instructions: body
  })
}

function clean(value: unknown, max: number, preserveLines = false): string {
  if (typeof value !== 'string') return ''
  const text = redactSecrets(value).text.trim()
  const normalized = preserveLines
    ? text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n')
    : text.replace(/\s+/g, ' ')
  return normalized.trim().slice(0, max)
}
