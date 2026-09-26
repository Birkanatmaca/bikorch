// Project roots are authorized in main from the persisted snapshot. Never send a
// filesystem request until the latest project registration has reached main.
let pendingSave: Promise<void> = Promise.resolve()

export function trackProjectPersistence(save: Promise<void>): Promise<void> {
  pendingSave = save
  return save
}

export async function waitForProjectPersistence(): Promise<void> {
  let observed: Promise<void>
  do {
    observed = pendingSave
    try {
      await observed
    } catch (error) {
      if (observed === pendingSave) throw error
    }
  } while (observed !== pendingSave)
}

type FileSystemApi = Window['api']['fs']

export const projectFiles: FileSystemApi = {
  async readDirectory(request) {
    await waitForProjectPersistence()
    return window.api.fs.readDirectory(request)
  },
  async readFile(request) {
    await waitForProjectPersistence()
    return window.api.fs.readFile(request)
  },
  async writeFile(request) {
    await waitForProjectPersistence()
    return window.api.fs.writeFile(request)
  },
  async search(request) {
    await waitForProjectPersistence()
    return window.api.fs.search(request)
  }
}

export function describeFileError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (message.includes('requested project is not available')) {
    return 'This project is no longer available. Open its folder again to reconnect.'
  }
  if (/ENOENT|no such file|not a directory/i.test(message)) {
    return 'This folder or file may have moved. Open the project folder again or refresh to retry.'
  }
  if (/EACCES|EPERM|permission denied/i.test(message)) {
    return 'Access was denied. Check the folder permissions, then try again.'
  }
  return message.replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, '')
}
