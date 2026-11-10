import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp/bikorch-test' }, session: {} }))
vi.mock('../../persistence/database', () => ({ listPersistedProjectFolders: () => [] }))

const { OLD_CONVERSATION_DAYS, oldClaudeVersionItems, oldConversationItems } = await import('../scan')

const DAY = 86_400_000
const NOW = Date.now()
const SESSION = '5b467337-a6d1-4985-a0ae-736103963a93'
const OTHER = '32012749-f9fd-49bd-a197-bd2bab7e7df7'

let root = ''
afterEach(() => { if (root) rmSync(root, { recursive: true, force: true }) })

function age(path: string, days: number): void {
  const at = new Date(NOW - days * DAY)
  utimesSync(path, at, at)
}

describe('old Claude conversations', () => {
  it('lists only session logs older than the cutoff and never memory or other files', async () => {
    root = mkdtempSync(join(tmpdir(), 'claude-convos-'))
    const home = join(root, 'home')
    const userData = join(root, 'data')
    const project = join(home, '.claude', 'projects', '-Users-me-app')
    mkdirSync(join(project, SESSION), { recursive: true })
    mkdirSync(join(project, 'memory'), { recursive: true })
    writeFileSync(join(project, `${SESSION}.jsonl`), 'x'.repeat(4096))
    writeFileSync(join(project, `${OTHER}.jsonl`), 'recent')
    writeFileSync(join(project, `${SESSION}.desktop-released.json`), '{}')
    writeFileSync(join(project, 'memory', 'MEMORY.md'), 'keep me')
    for (const name of [`${SESSION}.jsonl`, SESSION, 'memory', `${SESSION}.desktop-released.json`]) {
      age(join(project, name), OLD_CONVERSATION_DAYS + 5)
    }
    const profileProject = join(userData, 'cli-profiles', 'claude', 'acct1', 'projects', '-Users-me-app')
    mkdirSync(profileProject, { recursive: true })
    writeFileSync(join(profileProject, `${OTHER}.jsonl`), 'old')
    age(join(profileProject, `${OTHER}.jsonl`), OLD_CONVERSATION_DAYS + 1)

    const items = await oldConversationItems(home, userData, NOW)
    expect(items).toHaveLength(2)
    const own = items.find((item) => item.label === 'Old Claude Code conversations')
    expect(own?.plan).toEqual({ type: 'remove', paths: expect.arrayContaining([join(project, `${SESSION}.jsonl`), join(project, SESSION)]) })
    const ownPaths = own?.plan.type === 'remove' ? own.plan.paths : []
    expect(ownPaths).toHaveLength(2)
    expect(ownPaths.some((path) => path.includes('memory') || path.endsWith('.json'))).toBe(false)
    expect(own?.safety).toBe('caution')
    const bikorch = items.find((item) => item.label === 'Old Claude conversations in Bikorch')
    expect(bikorch?.plan).toEqual({ type: 'remove', paths: [join(profileProject, `${OTHER}.jsonl`)] })
  })
})

describe('old Claude Code versions', () => {
  function setup(): { home: string; versions: string } {
    root = mkdtempSync(join(tmpdir(), 'claude-versions-'))
    const home = join(root, 'home')
    const versions = join(home, '.local', 'share', 'claude', 'versions')
    mkdirSync(versions, { recursive: true })
    mkdirSync(join(home, '.local', 'bin'), { recursive: true })
    for (const [name, days] of [['2.1.311', 14], ['2.1.318', 5], ['2.1.319', 4], ['2.1.322', 0]] as const) {
      writeFileSync(join(versions, name), name)
      age(join(versions, name), days)
    }
    return { home, versions }
  }

  it('keeps the version in use and the newest', async () => {
    const { home, versions } = setup()
    symlinkSync(join(versions, '2.1.319'), join(home, '.local', 'bin', 'claude'))
    const [item] = await oldClaudeVersionItems(home)
    const paths = item.plan.type === 'remove' ? item.plan.paths.sort() : []
    const real = realpathSync(versions)
    expect(paths).toEqual([join(real, '2.1.311'), join(real, '2.1.318')])
  })

  it('lists nothing when it cannot tell which version runs', async () => {
    const { home } = setup()
    expect(await oldClaudeVersionItems(home)).toEqual([])
  })
})
