import { copyFile, link, stat } from 'fs/promises'
import { assertPathInside } from './downloader/filenames'

/** Keep the download's name and the library's stable path without storing the bytes twice. */
export async function storeManagedDownload(
  source: string,
  destination: string,
  downloadRoot: string
): Promise<void> {
  try {
    const safeSource = assertPathInside(downloadRoot, source)
    if ((await stat(safeSource)).isFile()) {
      await link(safeSource, destination)
      return
    }
  } catch {
    // Cross-volume files, unsupported filesystems and external imports use a copy.
  }
  await copyFile(source, destination)
}
