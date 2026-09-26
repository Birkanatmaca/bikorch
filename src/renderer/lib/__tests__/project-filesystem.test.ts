import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { describeFileError, projectFiles, trackProjectPersistence } from '../project-filesystem'

function deferred() {
  let resolve!: () => void
  let reject!: (error: Error) => void
  const promise = new Promise<void>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}

const readDirectory = vi.fn().mockResolvedValue({ entries: [] })
const readFile = vi.fn().mockResolvedValue({ content: '', path: '/project/file' })
const writeFile = vi.fn().mockResolvedValue({ path: '/project/file' })
const search = vi.fn().mockResolvedValue({ entries: [] })

beforeEach(() => {
  vi.clearAllMocks()
  trackProjectPersistence(Promise.resolve())
  vi.stubGlobal('window', { api: { fs: { readDirectory, readFile, writeFile, search } } })
})
afterEach(() => { vi.unstubAllGlobals() })

describe('project filesystem registration barrier', () => {
  it('waits for registration before any read, search or write', async () => {
    const save = deferred()
    trackProjectPersistence(save.promise)
    const work = [
      projectFiles.readDirectory({ projectId: 'new', directoryPath: '/project' }),
      projectFiles.readFile({ projectId: 'new', filePath: '/project/file' }),
      projectFiles.writeFile({ projectId: 'new', filePath: '/project/file', content: 'hello' }),
      projectFiles.search({ projectId: 'new', query: 'file' })
    ]
    await Promise.resolve()
    for (const method of [readDirectory, readFile, writeFile, search]) expect(method).not.toHaveBeenCalled()
    save.resolve()
    await Promise.all(work)
    for (const method of [readDirectory, readFile, writeFile, search]) expect(method).toHaveBeenCalledOnce()
    expect(readDirectory).toHaveBeenCalledWith({ projectId: 'new', directoryPath: '/project' })
  })

  it('waits for a newer root change arriving during a pending save', async () => {
    const first = deferred()
    const second = deferred()
    trackProjectPersistence(first.promise)
    const read = projectFiles.readDirectory({ projectId: 'new', directoryPath: '/other' })
    trackProjectPersistence(second.promise)
    first.resolve()
    await Promise.resolve()
    await Promise.resolve()
    expect(readDirectory).not.toHaveBeenCalled()
    second.resolve()
    await read
    expect(readDirectory).toHaveBeenCalledOnce()
  })

  it('does not access files when saving fails, and recovers after a successful retry', async () => {
    const save = deferred()
    trackProjectPersistence(save.promise)
    const read = projectFiles.readDirectory({ projectId: 'new', directoryPath: '/project' })
    const rejected = expect(read).rejects.toThrow('disk unavailable')
    save.reject(new Error('disk unavailable'))
    await rejected
    expect(readDirectory).not.toHaveBeenCalled()
    trackProjectPersistence(Promise.resolve())
    await projectFiles.readDirectory({ projectId: 'new', directoryPath: '/project' })
    expect(readDirectory).toHaveBeenCalledOnce()
  })
})

describe('filesystem error messages', () => {
  it('explains missing projects and paths without exposing the IPC wrapper', () => {
    expect(describeFileError(new Error("Error invoking remote method 'fs:readDirectory': Error: The requested project is not available"))).toMatch(/Open its folder again/)
    expect(describeFileError(new Error('ENOENT: no such file'))).toMatch(/may have moved/)
    expect(describeFileError(new Error('EACCES'))).toMatch(/permissions/)
    expect(describeFileError(new Error("Error invoking remote method 'fs:readFile': Error: File is too large to read"))).toBe('File is too large to read')
  })
})
