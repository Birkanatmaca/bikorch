import { execFile } from 'child_process'
import { mkdir, mkdtemp, readFile, rm } from 'fs/promises'
import { homedir } from 'os'
import { join, resolve, sep } from 'path'
import { promisify } from 'util'
import { terminalUserEnv } from './adapters'
import { managedCliPaths } from './managed-paths'
import { replaceDirectory } from './atomic-directory'

const execFileAsync = promisify(execFile)

export async function installManagedPackage(kind: 'gemini' | 'codex', onVerifying: () => void): Promise<void> {
  const paths = managedCliPaths(kind)
  await mkdir(join(paths.root, 'packages'), { recursive: true })
  const staging = await mkdtemp(join(paths.root, `${kind}-install-`))
  const packageName = kind === 'gemini' ? '@google/gemini-cli' : '@openai/codex'
  const options = { cwd: homedir(), env: terminalUserEnv(), windowsHide: true, timeout: 10 * 60 * 1000, maxBuffer: 4 * 1024 * 1024 }
  try {
    await execFileAsync(paths.node, [paths.npm, 'install', '--global', '--prefix', staging,
      '--registry=https://registry.npmjs.org', '--no-audit', '--no-fund', packageName], options)
    onVerifying()
    const packageRoot = join(staging, ...(process.platform === 'win32' ? [] : ['lib']), 'node_modules', packageName)
    const manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'))
    const bin = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.[kind]
    if (typeof bin !== 'string') throw new Error('The CLI package does not contain its launcher')
    const entry = resolve(packageRoot, bin)
    if (!entry.startsWith(resolve(packageRoot) + sep)) throw new Error('Invalid CLI launcher path')
    const { stdout, stderr } = await execFileAsync(paths.node, [entry, '--version'], { ...options, timeout: 30_000 })
    if (!/\d+\.\d+/.test(`${stdout}\n${stderr}`)) throw new Error('The downloaded CLI could not be verified')
    await replaceDirectory(staging, paths.prefix)
  } finally {
    if (resolve(staging).startsWith(resolve(paths.root) + sep)) await rm(staging, { recursive: true, force: true }).catch(() => undefined)
  }
}
