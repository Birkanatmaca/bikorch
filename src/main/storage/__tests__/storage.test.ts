import { execFileSync } from 'child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp/bikorch-test' }, session: {} }))
vi.mock('../../persistence/database', () => ({ listPersistedProjectFolders: () => [] }))

const { isRemovablePath } = await import('../clean')
const { findProjectOutputs, discoverNearbyProjects } = await import('../projects')

describe('isRemovablePath', () => {
  const home = '/Users/dev'
  it('allows folders at least two levels inside home', () => {
    expect(isRemovablePath('/Users/dev/.npm/_cacache', home)).toBe(true)
    expect(isRemovablePath('/Users/dev/app/node_modules', home)).toBe(true)
  })
  it('refuses home, its direct children, outside paths and traversal', () => {
    expect(isRemovablePath('/Users/dev', home)).toBe(false)
    expect(isRemovablePath('/Users/dev/Library', home)).toBe(false)
    expect(isRemovablePath('/etc/hosts', home)).toBe(false)
    expect(isRemovablePath('/Users/dev/app/../..', home)).toBe(false)
    expect(isRemovablePath('relative/path', home)).toBe(false)
  })
  it('refuses a protected project folder itself', () => {
    expect(isRemovablePath('/Users/dev/work/app', home, ['/Users/dev/work/app'])).toBe(false)
  })
})

describe('findProjectOutputs', () => {
  let root = ''
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true })
  })

  function repo(): string {
    root = mkdtempSync(join(tmpdir(), 'storage-scan-'))
    execFileSync('git', ['init', '-q'], { cwd: root })
    return root
  }

  it('lists dependencies and ignored build output, never tracked folders', async () => {
    const dir = repo()
    writeFileSync(join(dir, '.gitignore'), 'node_modules\ndist\n')
    mkdirSync(join(dir, 'node_modules', 'left-pad'), { recursive: true })
    mkdirSync(join(dir, 'dist'))
    writeFileSync(join(dir, 'dist', 'app.js'), '')
    // "build" holds source and is tracked: it must not be offered.
    mkdirSync(join(dir, 'build'))
    writeFileSync(join(dir, 'build', 'script.sh'), 'echo hi')
    // "out" is neither ignored nor tracked: not offered either.
    mkdirSync(join(dir, 'out'))
    mkdirSync(join(dir, 'apps', 'web', 'node_modules'), { recursive: true })
    execFileSync('git', ['add', '.gitignore', 'build/script.sh'], { cwd: dir })

    const names = (await findProjectOutputs(dir)).map((item) => item.path.slice(dir.length + 1)).sort()
    expect(names).toEqual(['apps/web/node_modules', 'dist', 'node_modules'])
  })

  it('does not enter node_modules to find nested ones', async () => {
    const dir = repo()
    mkdirSync(join(dir, 'node_modules', 'pkg', 'node_modules'), { recursive: true })
    const found = await findProjectOutputs(dir)
    expect(found).toHaveLength(1)
  })

  it('offers only always-generated folders outside Git', async () => {
    root = mkdtempSync(join(tmpdir(), 'storage-scan-'))
    mkdirSync(join(root, 'node_modules'))
    mkdirSync(join(root, 'dist'))
    expect((await findProjectOutputs(root)).map((item) => item.name)).toEqual(['node_modules'])
  })

  it('finds sibling projects next to an opened one', async () => {
    root = mkdtempSync(join(tmpdir(), 'storage-near-'))
    for (const name of ['opened', 'other', 'notes']) mkdirSync(join(root, name))
    writeFileSync(join(root, 'other', 'package.json'), '{}')
    mkdirSync(join(root, 'notes', 'nested'))
    writeFileSync(join(root, 'notes', 'nested', 'go.mod'), 'module x')
    const found = await discoverNearbyProjects([join(root, 'opened')], tmpdir())
    expect(found.sort()).toEqual([join(root, 'notes', 'nested'), join(root, 'other')])
  })
})
