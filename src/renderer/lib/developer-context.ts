import type { MemoryContextPackage } from '@shared/contracts/developer-intelligence'

/** Inline only: a newline here would submit a CLI prompt before the user's Enter. */
export function formatMemoryContextInline(pkg: MemoryContextPackage): string {
  if (!pkg.injectionEnabled || pkg.memories.length === 0) return ''
  const clean = (value: string): string => value.replace(/[\x00-\x1f\x7f-\x9f]/g, ' ').replace(/\s+/g, ' ').trim()
  const facts = pkg.memories.slice(0, 5)
    .map((item) => `${clean(item.category).slice(0, 32)}: ${clean(item.content).slice(0, 160)}`)
    .join('; ')
    .slice(0, 850)
  return facts ? ` [Bikorch developer context: ${facts}]` : ''
}
