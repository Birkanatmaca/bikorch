import { join } from 'path'
import type { StorageSafety } from '@shared/contracts/storage'

/**
 * Well-known tool caches. Every entry is a cache its tool recreates on demand;
 * nothing here holds source code, settings or credentials.
 */
export interface ToolCacheLocation {
  id: string
  label: string
  detail: string
  /** Path segments under the home folder. */
  parts: string[]
  safety: StorageSafety
  platforms?: NodeJS.Platform[]
  /** Empty the folder but keep it (tools that expect the folder to exist). */
  keepFolder?: boolean
  /** Go's module cache is read-only; it needs `go clean -modcache` or a chmod first. */
  readOnly?: boolean
  /** List each child as its own item (e.g. one per iOS version). */
  perChild?: boolean
}

const MAC: NodeJS.Platform[] = ['darwin']
const UNIX: NodeJS.Platform[] = ['linux']

export const TOOL_CACHES: ToolCacheLocation[] = [
  { id: 'npm', label: 'npm download cache', detail: 'Packages npm downloaded before. npm fetches them again on the next install.', parts: ['.npm', '_cacache'], safety: 'safe' },
  { id: 'npx', label: 'npx packages', detail: 'Tools run once with npx. They download again the next time you run them.', parts: ['.npm', '_npx'], safety: 'safe' },
  { id: 'pnpm-mac', label: 'pnpm store', detail: 'Shared pnpm package store. Projects keep working; the next pnpm install downloads what is missing.', parts: ['Library', 'pnpm', 'store'], safety: 'rebuild', platforms: MAC },
  { id: 'pnpm-linux', label: 'pnpm store', detail: 'Shared pnpm package store. The next pnpm install downloads what is missing.', parts: ['.local', 'share', 'pnpm', 'store'], safety: 'rebuild', platforms: UNIX },
  { id: 'yarn-mac', label: 'Yarn cache', detail: 'Yarn 1 package cache.', parts: ['Library', 'Caches', 'Yarn'], safety: 'safe', platforms: MAC },
  { id: 'yarn-berry', label: 'Yarn Berry cache', detail: 'Yarn 2+ global package cache.', parts: ['.yarn', 'berry', 'cache'], safety: 'safe' },
  { id: 'bun', label: 'Bun install cache', detail: 'Packages bun downloaded before.', parts: ['.bun', 'install', 'cache'], safety: 'safe' },
  { id: 'go-build-mac', label: 'Go build cache', detail: 'Compiled Go packages. The next build is slower once.', parts: ['Library', 'Caches', 'go-build'], safety: 'safe', platforms: MAC, keepFolder: true },
  { id: 'go-build-linux', label: 'Go build cache', detail: 'Compiled Go packages. The next build is slower once.', parts: ['.cache', 'go-build'], safety: 'safe', platforms: UNIX, keepFolder: true },
  { id: 'go-mod', label: 'Go module cache', detail: 'Downloaded Go modules. Builds download the modules they need again.', parts: ['go', 'pkg', 'mod'], safety: 'rebuild', readOnly: true },
  { id: 'gopls-mac', label: 'gopls cache', detail: 'Go language server index.', parts: ['Library', 'Caches', 'gopls'], safety: 'safe', platforms: MAC },
  { id: 'gradle', label: 'Gradle caches', detail: 'Gradle dependencies and build caches. The next Android build downloads them again.', parts: ['.gradle', 'caches'], safety: 'rebuild' },
  { id: 'gradle-wrapper', label: 'Gradle distributions', detail: 'Downloaded Gradle versions. Each project downloads its version again when built.', parts: ['.gradle', 'wrapper', 'dists'], safety: 'rebuild', perChild: true },
  { id: 'android-cache', label: 'Android SDK cache', detail: 'Android tool downloads cache.', parts: ['.android', 'cache'], safety: 'safe' },
  { id: 'xcode-derived', label: 'Xcode DerivedData', detail: 'Xcode build products and indexes. Xcode rebuilds them.', parts: ['Library', 'Developer', 'Xcode', 'DerivedData'], safety: 'safe', platforms: MAC, keepFolder: true },
  { id: 'ios-support', label: 'iOS DeviceSupport', detail: 'Debug symbols for an iOS version. Xcode copies them again when you connect a device running it.', parts: ['Library', 'Developer', 'Xcode', 'iOS DeviceSupport'], safety: 'rebuild', platforms: MAC, perChild: true },
  { id: 'watch-support', label: 'watchOS DeviceSupport', detail: 'Debug symbols for a watchOS version.', parts: ['Library', 'Developer', 'Xcode', 'watchOS DeviceSupport'], safety: 'rebuild', platforms: MAC, perChild: true },
  { id: 'xcode-archives', label: 'Xcode archives', detail: 'Archived app builds. You need an archive to symbolicate crash reports of that release.', parts: ['Library', 'Developer', 'Xcode', 'Archives'], safety: 'caution', platforms: MAC, perChild: true },
  { id: 'sim-caches', label: 'Simulator caches', detail: 'CoreSimulator caches. Simulators rebuild them.', parts: ['Library', 'Developer', 'CoreSimulator', 'Caches'], safety: 'safe', platforms: MAC, keepFolder: true },
  { id: 'cocoapods', label: 'CocoaPods cache', detail: 'Pod downloads. pod install fetches them again.', parts: ['Library', 'Caches', 'CocoaPods'], safety: 'safe', platforms: MAC },
  { id: 'homebrew', label: 'Homebrew downloads', detail: 'Old bottle downloads. Installed formulae keep working.', parts: ['Library', 'Caches', 'Homebrew'], safety: 'safe', platforms: MAC, keepFolder: true },
  { id: 'pip-mac', label: 'pip cache', detail: 'Python packages pip downloaded before.', parts: ['Library', 'Caches', 'pip'], safety: 'safe', platforms: MAC },
  { id: 'pip-linux', label: 'pip cache', detail: 'Python packages pip downloaded before.', parts: ['.cache', 'pip'], safety: 'safe', platforms: UNIX },
  { id: 'uv', label: 'uv cache', detail: 'Python packages uv downloaded before.', parts: ['.cache', 'uv'], safety: 'safe' },
  { id: 'cargo-registry', label: 'Cargo registry cache', detail: 'Downloaded crate archives and sources. cargo fetches them again.', parts: ['.cargo', 'registry'], safety: 'rebuild' },
  { id: 'node-gyp-mac', label: 'node-gyp headers', detail: 'Node headers for native modules.', parts: ['Library', 'Caches', 'node-gyp'], safety: 'safe', platforms: MAC },
  { id: 'electron-mac', label: 'Electron downloads', detail: 'Electron binaries downloaded by npm installs.', parts: ['Library', 'Caches', 'electron'], safety: 'safe', platforms: MAC },
  { id: 'electron-builder-mac', label: 'electron-builder cache', detail: 'Packaging tools downloaded by electron-builder.', parts: ['Library', 'Caches', 'electron-builder'], safety: 'safe', platforms: MAC },
  { id: 'playwright-mac', label: 'Playwright browsers', detail: 'Test browsers. npx playwright install downloads them again.', parts: ['Library', 'Caches', 'ms-playwright'], safety: 'rebuild', platforms: MAC },
  { id: 'typescript-mac', label: 'TypeScript cache', detail: 'Type definitions editors downloaded.', parts: ['Library', 'Caches', 'typescript'], safety: 'safe', platforms: MAC },
  { id: 'dotslash-mac', label: 'dotslash cache', detail: 'Tool binaries fetched by dotslash (used by Codex). They download again on use.', parts: ['Library', 'Caches', 'dotslash'], safety: 'safe', platforms: MAC },
  { id: 'claude-cli-mac', label: 'Claude Code cache', detail: 'Claude Code logs and temporary files.', parts: ['Library', 'Caches', 'claude-cli-nodejs'], safety: 'safe', platforms: MAC },
  { id: 'codex-runtimes', label: 'Codex runtimes', detail: 'Runtime Codex downloads for itself. Close Codex sessions first; Codex downloads it again on its next start.', parts: ['.cache', 'codex-runtimes'], safety: 'caution' }
]

/** ~/Library/Caches folders already covered above, or never ours to touch. */
export function coveredCacheFolders(): Set<string> {
  const covered = new Set<string>()
  for (const location of TOOL_CACHES) {
    if (location.parts[0] === 'Library' && location.parts[1] === 'Caches' && location.parts[2]) covered.add(location.parts[2])
  }
  return covered
}

export function toolCachePath(home: string, location: ToolCacheLocation): string {
  return join(home, ...location.parts)
}

export function appliesTo(location: ToolCacheLocation, platform: NodeJS.Platform): boolean {
  return !location.platforms || location.platforms.includes(platform)
}

/**
 * Project folders that only hold generated files. The first group is always
 * generated; the second is only listed when Git ignores it and tracks nothing in it.
 */
export const GENERATED_DIRS: Record<string, { safety: StorageSafety; detail: string }> = {
  node_modules: { safety: 'rebuild', detail: 'Installed packages. Run your package manager install to restore them.' },
  '.next': { safety: 'safe', detail: 'Next.js build cache and output.' },
  '.nuxt': { safety: 'safe', detail: 'Nuxt build output.' },
  '.svelte-kit': { safety: 'safe', detail: 'SvelteKit build output.' },
  '.turbo': { safety: 'safe', detail: 'Turborepo cache.' },
  '.parcel-cache': { safety: 'safe', detail: 'Parcel cache.' },
  '.vite': { safety: 'safe', detail: 'Vite cache.' },
  '.angular': { safety: 'safe', detail: 'Angular CLI cache.' },
  '.expo': { safety: 'safe', detail: 'Expo cache.' },
  '.dart_tool': { safety: 'rebuild', detail: 'Dart and Flutter tool output. flutter pub get restores it.' },
  '.gradle': { safety: 'safe', detail: 'Project Gradle cache.' },
  '.pytest_cache': { safety: 'safe', detail: 'pytest cache.' },
  '.mypy_cache': { safety: 'safe', detail: 'mypy cache.' }
}

export const IGNORED_OUTPUT_DIRS: Record<string, { safety: StorageSafety; detail: string }> = {
  dist: { safety: 'rebuild', detail: 'Build output. Rebuild it before deploying or publishing from it.' },
  build: { safety: 'rebuild', detail: 'Build output. Rebuild it before deploying or publishing from it.' },
  out: { safety: 'rebuild', detail: 'Build output. Rebuild it before deploying or publishing from it.' },
  release: { safety: 'caution', detail: 'Release artifacts. Keep them if you still need to upload this release.' },
  target: { safety: 'rebuild', detail: 'Rust or Java build output. The next build recreates it.' },
  coverage: { safety: 'safe', detail: 'Test coverage report.' },
  Pods: { safety: 'rebuild', detail: 'CocoaPods dependencies. pod install restores them.' },
  DerivedData: { safety: 'safe', detail: 'Xcode build output.' },
  '.venv': { safety: 'caution', detail: 'Python virtual environment. Recreate it and reinstall packages afterwards.' },
  venv: { safety: 'caution', detail: 'Python virtual environment. Recreate it and reinstall packages afterwards.' }
}

/** Folders the project walk never enters. */
export const SKIP_WALK = new Set(['.git', '.hg', '.svn', '.idea', '.vscode', '.cache', 'vendor'])
