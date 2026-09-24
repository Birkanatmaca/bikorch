import { resolve, relative, isAbsolute, normalize, sep } from 'path'
import { realpath } from 'fs/promises'

export function assertPathWithinRoot(projectRoot: string, targetPath: string): string {
  const resolvedRoot = resolve(projectRoot)
  const resolvedTarget = isAbsolute(targetPath)
    ? resolve(targetPath)
    : resolve(resolvedRoot, normalize(targetPath))

  const relativePath = relative(resolvedRoot, resolvedTarget)

  if (relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
    throw new Error('Path is outside project root')
  }

  return resolvedTarget
}

/** Resolve an existing path and verify its real target remains below the real project root. */
export async function resolveExistingPathWithinRoot(
  projectRoot: string,
  targetPath: string
): Promise<{ resolvedPath: string; realPath: string }> {
  const resolvedPath = assertPathWithinRoot(projectRoot, targetPath)
  const [realRoot, realPath] = await Promise.all([
    realpath(projectRoot),
    realpath(resolvedPath)
  ])
  assertPathWithinRoot(realRoot, realPath)
  return { resolvedPath, realPath }
}

export function toProjectRelativePath(projectRoot: string, absolutePath: string): string {
  const resolved = assertPathWithinRoot(projectRoot, absolutePath)
  return relative(resolve(projectRoot), resolved).replace(/\\/g, '/')
}
