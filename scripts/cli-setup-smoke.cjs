// Downloads real Node.js and npm-based CLIs into a disposable directory. Does not sign in.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const esbuild = require('esbuild')
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bikorch-cli-smoke-'))
const toolRoot = path.join(root, 'User Name ü', 'cli')
console.log('Isolated CLI setup: ' + root)

async function main() {
  const entry = path.join(root, 'entry.ts')
  const sourceRoot = path.resolve(__dirname, '../src/main/cli').replaceAll('\\', '/')
  fs.writeFileSync(entry, `export { ensureManagedNode } from '${sourceRoot}/install-runtime'; export { installManagedPackage } from '${sourceRoot}/install-package'; export { managedCliPaths } from '${sourceRoot}/managed-paths'; export { inspectCli } from '${sourceRoot}/health';`)
  const out = path.join(root, 'setup.cjs')
  await esbuild.build({ entryPoints: [entry], outfile: out, bundle: true, platform: 'node', format: 'cjs',
    tsconfig: path.resolve(__dirname, '../tsconfig.node.json'),
    plugins: [{ name: 'isolated-managed-tools', setup(build) {
      build.onLoad({ filter: /[\\/]managed-paths\.ts$/ }, async (args) => ({
        contents: fs.readFileSync(args.path, 'utf8').replace("join(homedir(), '.bikorch', 'cli')", JSON.stringify(toolRoot)), loader: 'ts'
      }))
    } }]
  })
  const setup = require(out)
  const paths = setup.managedCliPaths()
  // Begin with a partial runtime to exercise repair as well as the bootstrap path.
  fs.mkdirSync(path.dirname(paths.node), { recursive: true })
  fs.mkdirSync(path.dirname(paths.npm), { recursive: true })
  fs.writeFileSync(paths.node, 'interrupted download')
  fs.writeFileSync(paths.npm, 'interrupted download')
  const npmConfig = path.join(root, 'npmrc')
  fs.writeFileSync(npmConfig, '')
  process.env.NPM_CONFIG_USERCONFIG = npmConfig
  process.env.NPM_CONFIG_CACHE = path.join(root, 'npm-cache')
  console.log('Repairing Node.js from its official checksum-verified archive…')
  await setup.ensureManagedNode()
  for (const kind of ['codex', 'gemini']) {
    console.log('Installing ' + kind + ' into an isolated package prefix…')
    await setup.installManagedPackage(kind, () => console.log('Verifying downloaded ' + kind + ' before replacement…'))
    const health = await setup.inspectCli(kind)
    assert.equal(health.installed, true, health.error)
    assert.ok(health.command.includes(toolRoot), 'must run the isolated CLI, not an existing system installation')
  }
  await setup.ensureManagedNode()
  console.log('CLI setup smoke passed: runtime repair, Node/npm health, staged npm installation, relocated launcher and paths with spaces/Unicode.')
}

main().catch((error) => { console.error(error); process.exitCode = 1 }).finally(() => {
  const resolved = path.resolve(root)
  if (resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(resolved).startsWith('bikorch-cli-smoke-')) fs.rmSync(resolved, { recursive: true, force: true })
})
