import type { SecretaryAssignment } from '@shared/contracts/secretary'
import { secretaryMemoryContext } from './memory-context'
import { secretarySkillContext } from './skill-context'

/** Personal and conversational facts help Manager talk to the developer, not a CLI write code. */
const CLI_IRRELEVANT_CATEGORIES = new Set(['About me', 'Communication'])
const MEMORY_LIMIT = 8
const SKILL_LIMIT = 2
const SKILL_INSTRUCTION_LIMIT = 1_200
const CONTEXT_LIMIT = 3_500

/** Respects the memory sharing switch through secretaryMemoryContext. Empty when nothing fits. */
export function secretaryCliDeveloperContext(projectId: string, assignment: Pick<SecretaryAssignment, 'title' | 'instruction'>): string {
  const query = `${assignment.title}\n${assignment.instruction}`
  try {
    const memories = secretaryMemoryContext(projectId, query)
      .filter((memory) => !CLI_IRRELEVANT_CATEGORIES.has(memory.category))
      .slice(0, MEMORY_LIMIT)
    const skills = secretarySkillContext(query)
      .filter((skill) => skill.enabled)
      .slice(0, SKILL_LIMIT)
    const sections = [
      memories.length > 0
        ? `Preferences:\n${memories.map((memory) => `- [${memory.category}] ${memory.content}`).join('\n')}`
        : '',
      ...skills.map((skill) => `Skill "${skill.name}" (${skill.description}):\n${skill.instructions.slice(0, SKILL_INSTRUCTION_LIMIT)}`)
    ].filter(Boolean)
    return sections.join('\n\n').slice(0, CONTEXT_LIMIT)
  } catch {
    // Missing developer context must never block approved CLI work.
    return ''
  }
}
