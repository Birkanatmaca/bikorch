import { existsSync } from 'fs'
import { unlink } from 'fs/promises'
import { assertPathInside, tempSidecars } from './downloader/filenames'
import { musicRootDir } from './paths'

export function assertManagedMusicFile(filePath: string, root = musicRootDir()): string {
  return assertPathInside(root, filePath)
}

export async function permanentlyDeleteManagedMusicFile(
  filePath: string,
  root = musicRootDir()
): Promise<void> {
  const target = assertManagedMusicFile(filePath, root)
  const extras = tempSidecars(target)
  if (existsSync(target)) {
    await unlink(target)
  }
  for (const extra of extras) {
    try {
      if (existsSync(extra)) await unlink(extra)
    } catch {
      // leftover sidecar
    }
  }
}
