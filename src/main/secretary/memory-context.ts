import { getMemoryContext } from '../developer-intelligence/service'
import { sanitizeSecretaryModelText } from './input-sanitizer'

export interface SecretaryMemoryFact {
  category: string
  content: string
  scope: string
}

/** The context preview API returns candidates even when injection is off; gate here. */
export function secretaryMemoryContext(projectId: string, query: string): SecretaryMemoryFact[] {
  const context = getMemoryContext({ projectId, query, limit: 8 })
  if (!context.injectionEnabled) return []
  return context.memories.map((item) => ({
    category: sanitizeSecretaryModelText(item.category, 80),
    content: sanitizeSecretaryModelText(item.content, 500),
    scope: item.scope
  }))
}
