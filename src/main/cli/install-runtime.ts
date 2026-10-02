import { execFile } from 'child_process'
import { createHash } from 'crypto'
import { createReadStream, createWriteStream, existsSync } from 'fs'
import { mkdir, mkdtemp, rm } from 'fs/promises'
import { join, resolve, sep } from 'path'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'
import { promisify } from 'util'
import { managedCliPaths } from './managed-paths'
import { terminalUserEnv } from './adapters'
import { recoverDirectory, replaceDirectory } from './atomic-directory'

const execFileAsync = promisify(execFile)
const NODE_RELEASE_URL = 'https://nodejs.org/dist/latest-v22.x/'
let pendingRuntime: Promise<void> | null = null

export function selectNodeArchive(manifest: string, platform: string, arch: string) {
  if (!['win32', 'darwin', 'linux'].includes(platform) || !['x64', 'arm64'].includes(arch)) {
    throw new Error(`Automatic Node.js installation is unavailable for ${platform}/${arch}`)
  }
  const suffix = `${platform === 'win32' ? 'win' : platform}-${arch}.${platform === 'win32' ? 'zip' : 'tar.gz'}`
  const entry = manifest.split(/\r?\n/).map((line) => line.trim().split(/\s+/)).find(
    ([hash, name]) => /^[a-f0-9]{64}$/i.test(hash ?? '') &&
      /^node-v22\.\d+\.\d+-[a-z0-9.-]+$/.test(name ?? '') && name.endsWith(suffix)
  )
  if (!entry) throw new Error('The official Node.js download manifest does not contain this platform')
  return { sha256: entry[0].toLowerCase(), name: entry[1] }
}

async function fetchOfficial(url: string): Promise<Response> {
  const response = await fetch(url, { signal: AbortSignal.timeout(10 * 60 * 1000), redirect: 'error' })
  if (!response.ok) throw new Error(`Node.js download failed (HTTP ${response.status})`)
  return response
}

async function installRuntime(): Promise<void> {
  const paths = managedCliPaths()
  recoverDirectory(paths.runtime)
  if (existsSync(paths.node) && existsSync(paths.npm)) {
    try {
      const { stdout } = await execFileAsync(paths.node, ['--version'], { windowsHide: true, timeout: 10_000, env: terminalUserEnv() })
      if (!/^v22\./.test(stdout.trim())) throw new Error('Unsupported managed Node.js version')
      await execFileAsync(paths.node, [paths.npm, '--version'], { windowsHide: true, timeout: 10_000, env: terminalUserEnv() })
      return
    } catch {
      // Repair a partial or broken runtime using a verified replacement.
    }
  }
  const manifest = await (await fetchOfficial(`${NODE_RELEASE_URL}SHASUMS256.txt`)).text()
  const artifact = selectNodeArchive(manifest, process.platform, process.arch)
  await mkdir(paths.root, { recursive: true })
  const staging = await mkdtemp(join(paths.root, 'node-install-'))
  try {
    const archive = join(staging, artifact.name)
    const response = await fetchOfficial(`${NODE_RELEASE_URL}${artifact.name}`)
    if (!response.body) throw new Error('Node.js download was empty')
    await pipeline(Readable.fromWeb(response.body as import('stream/web').ReadableStream), createWriteStream(archive))
    const hash = createHash('sha256')
    for await (const chunk of createReadStream(archive)) hash.update(chunk)
    if (hash.digest('hex') !== artifact.sha256) throw new Error('Node.js download checksum verification failed. Try again.')
    const env = terminalUserEnv()
    if (process.platform === 'win32') {
      await execFileAsync('powershell.exe', [
        '-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
        "$ErrorActionPreference = 'Stop'; Expand-Archive -LiteralPath $env:BIKORCH_NODE_ARCHIVE -DestinationPath $env:BIKORCH_NODE_STAGING"
      ], { env: { ...env, BIKORCH_NODE_ARCHIVE: archive, BIKORCH_NODE_STAGING: staging }, windowsHide: true, timeout: 120_000 })
    } else {
      await execFileAsync('/usr/bin/tar', ['-xzf', archive, '-C', staging], { env, timeout: 120_000 })
    }
    const extracted = join(staging, artifact.name.replace(/\.(zip|tar\.gz)$/, ''))
    const node = process.platform === 'win32' ? join(extracted, 'node.exe') : join(extracted, 'bin', 'node')
    const npm = process.platform === 'win32' ? join(extracted, 'node_modules', 'npm', 'bin', 'npm-cli.js') : join(extracted, 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')
    const { stdout } = await execFileAsync(node, ['--version'], { env, windowsHide: true, timeout: 10_000 })
    if (!/^v22\./.test(stdout.trim())) throw new Error('Downloaded Node.js could not be verified')
    await execFileAsync(node, [npm, '--version'], { env, windowsHide: true, timeout: 10_000 })
    await replaceDirectory(extracted, paths.runtime)
  } finally {
    if (resolve(staging).startsWith(resolve(paths.root) + sep)) {
      await rm(staging, { recursive: true, force: true })
    }
  }
}

export async function ensureManagedNode(): Promise<void> {
  if (!pendingRuntime) pendingRuntime = installRuntime().finally(() => { pendingRuntime = null })
  await pendingRuntime
}
