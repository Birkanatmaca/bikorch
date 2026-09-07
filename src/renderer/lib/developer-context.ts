import type { MemoryContextPackage } from '@shared/contracts/developer-intelligence'

/** Formats a ranked memory package for optional CLI prompt injection. */
export function formatMemoryContextBlock(pkg: MemoryContextPackage): string {
  if (!pkg.injectionEnabled || pkg.memories.length === 0) return ''
  const lines = pkg.memories.map((item) => `- [${item.category}] ${item.content}`)
  return `# Bikorch developer context\n${lines.join('\n')}\n\n`
}
