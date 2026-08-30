import { resolve, relative, isAbsolute, normalize } from 'path'

export function assertPathWithinRoot(projectRoot: string, targetPath: string): string {
  const resolvedRoot = resolve(projectRoot)
  const resolvedTarget = isAbsolute(targetPath)
    ? resolve(targetPath)
    : resolve(resolvedRoot, normalize(targetPath))

  const relativePath = relative(resolvedRoot, resolvedTarget)

  if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
    throw new Error('Path is outside project root')
  }

  return resolvedTarget
}

export function toProjectRelativePath(projectRoot: string, absolutePath: string): string {
  const resolved = assertPathWithinRoot(projectRoot, absolutePath)
  return relative(resolve(projectRoot), resolved).replace(/\\/g, '/')
}
