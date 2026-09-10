import { create } from 'zustand'
import { detectLanguage } from '@renderer/lib/file-icons'
import { resolveFileChange, useGitStore } from './git-store'
import { useEditorStore } from './editor-store'
import { useWorkspaceStore } from './workspace-store'

export interface IdeTab {
  absolutePath: string
  relativePath: string
  projectId: string
  language: string
  savedValue: string
  value: string
  loading: boolean
  error: string | null
  binary: boolean
}

interface IdeStore {
  open: boolean
  tabs: IdeTab[]
  activePath: string | null
  saving: boolean

  openFile: (projectId: string, workspaceRoot: string, absolutePath: string) => Promise<void>
  setActive: (absolutePath: string) => void
  setValue: (absolutePath: string, value: string) => void
  save: (absolutePath?: string) => Promise<void>
  revert: (absolutePath?: string) => void
  reload: (absolutePath?: string) => Promise<void>
  discardGit: (absolutePath?: string) => Promise<void>
  closeTab: (absolutePath: string) => boolean
  closeTabForced: (absolutePath: string) => void
  closeIde: () => boolean
  forceClose: () => void
}

const BINARY_EXTENSIONS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'ico',
  'pdf',
  'zip',
  'gz',
  'woff',
  'woff2',
  'ttf',
  'eot',
  'mp3',
  'mp4',
  'wasm',
  'bin'
])

function toRelative(workspaceRoot: string, absolutePath: string): string {
  const root = workspaceRoot.replace(/\\/g, '/').replace(/\/+$/, '')
  const path = absolutePath.replace(/\\/g, '/')
  if (path.toLowerCase().startsWith(`${root.toLowerCase()}/`)) return path.slice(root.length + 1)
  if (path.toLowerCase() === root.toLowerCase()) return ''
  return path
}

function isBinary(filePath: string, content: string): boolean {
  const base = filePath.split(/[/\\]/).pop()?.toLowerCase() ?? ''
  const ext = base.includes('.') ? (base.split('.').pop() ?? '') : ''
  if (BINARY_EXTENSIONS.has(ext)) return true
  return content.includes('\0')
}

function workspaceRootFor(projectId: string): string | null {
  return useWorkspaceStore.getState().projects.find((project) => project.id === projectId)?.folderPath ?? null
}

export function tabIsDirty(tab: IdeTab): boolean {
  return !tab.binary && !tab.loading && tab.value !== tab.savedValue
}

export const useIdeStore = create<IdeStore>((set, get) => ({
  open: false,
  tabs: [],
  activePath: null,
  saving: false,

  openFile: async (projectId, workspaceRoot, absolutePath) => {
    const existing = get().tabs.find((tab) => tab.absolutePath === absolutePath)
    if (existing) {
      set({ open: true, activePath: absolutePath })
      useEditorStore.getState().setSelectedFile(projectId, existing.relativePath)
      return
    }

    const relativePath = toRelative(workspaceRoot, absolutePath)
    useEditorStore.getState().setSelectedFile(projectId, relativePath || absolutePath)

    const pending: IdeTab = {
      absolutePath,
      relativePath: relativePath || absolutePath,
      projectId,
      language: detectLanguage(relativePath || absolutePath),
      savedValue: '',
      value: '',
      loading: true,
      error: null,
      binary: false
    }

    set((state) => ({
      open: true,
      activePath: absolutePath,
      tabs: [...state.tabs.filter((tab) => tab.absolutePath !== absolutePath), pending]
    }))

    try {
      const result = await window.api.fs.readFile({
        projectRoot: workspaceRoot,
        filePath: absolutePath
      })
      const binary = isBinary(absolutePath, result.content)
      set((state) => ({
        tabs: state.tabs.map((tab) =>
          tab.absolutePath === absolutePath
            ? {
                ...tab,
                savedValue: result.content,
                value: result.content,
                loading: false,
                binary,
                error: binary ? 'Binary file' : null
              }
            : tab
        )
      }))
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to open file'
      set((state) => ({
        tabs: state.tabs.map((tab) =>
          tab.absolutePath === absolutePath ? { ...tab, loading: false, error: message } : tab
        )
      }))
    }
  },

  setActive: (absolutePath) => {
    const tab = get().tabs.find((item) => item.absolutePath === absolutePath)
    if (!tab) return
    set({ activePath: absolutePath, open: true })
    useEditorStore.getState().setSelectedFile(tab.projectId, tab.relativePath)
  },

  setValue: (absolutePath, value) => {
    set((state) => ({
      tabs: state.tabs.map((tab) => (tab.absolutePath === absolutePath ? { ...tab, value } : tab))
    }))
  },

  save: async (absolutePath) => {
    const path = absolutePath ?? get().activePath
    const tab = get().tabs.find((item) => item.absolutePath === path)
    if (!tab || tab.binary || tab.loading) return
    const root = workspaceRootFor(tab.projectId)
    if (!root) throw new Error('No project folder')
    set({ saving: true })
    try {
      await window.api.fs.writeFile({
        projectRoot: root,
        filePath: tab.absolutePath,
        content: tab.value
      })
      set((state) => ({
        saving: false,
        tabs: state.tabs.map((item) =>
          item.absolutePath === tab.absolutePath
            ? { ...item, savedValue: item.value, error: null }
            : item
        )
      }))
      void useGitStore.getState().refresh(tab.projectId, root)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save'
      set((state) => ({
        saving: false,
        tabs: state.tabs.map((item) =>
          item.absolutePath === tab.absolutePath ? { ...item, error: message } : item
        )
      }))
      throw error
    }
  },

  revert: (absolutePath) => {
    const path = absolutePath ?? get().activePath
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.absolutePath === path ? { ...tab, value: tab.savedValue, error: tab.binary ? tab.error : null } : tab
      )
    }))
  },

  reload: async (absolutePath) => {
    const path = absolutePath ?? get().activePath
    const tab = get().tabs.find((item) => item.absolutePath === path)
    if (!tab) return
    const root = workspaceRootFor(tab.projectId)
    if (!root) return
    set((state) => ({
      tabs: state.tabs.map((item) =>
        item.absolutePath === tab.absolutePath ? { ...item, loading: true, error: null } : item
      )
    }))
    try {
      const result = await window.api.fs.readFile({
        projectRoot: root,
        filePath: tab.absolutePath
      })
      const binary = isBinary(tab.absolutePath, result.content)
      set((state) => ({
        tabs: state.tabs.map((item) =>
          item.absolutePath === tab.absolutePath
            ? {
                ...item,
                savedValue: result.content,
                value: result.content,
                loading: false,
                binary,
                error: binary ? 'Binary file' : null
              }
            : item
        )
      }))
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to reload file'
      set((state) => ({
        tabs: state.tabs.map((item) =>
          item.absolutePath === tab.absolutePath ? { ...item, loading: false, error: message } : item
        )
      }))
    }
  },

  discardGit: async (absolutePath) => {
    const path = absolutePath ?? get().activePath
    const tab = get().tabs.find((item) => item.absolutePath === path)
    if (!tab) return
    const root = workspaceRootFor(tab.projectId)
    if (!root) throw new Error('No project folder')
    const matched = resolveFileChange(useGitStore.getState().stateByProject, tab.projectId, tab.absolutePath)
    if (!matched) {
      get().revert(tab.absolutePath)
      return
    }
    useGitStore.getState().selectRepo(tab.projectId, matched.repoRoot)
    await useGitStore.getState().discardChange(tab.projectId, root, matched.change)
    await get().reload(tab.absolutePath)
  },

  closeTab: (absolutePath) => {
    const tab = get().tabs.find((item) => item.absolutePath === absolutePath)
    if (tab && tabIsDirty(tab)) return false
    const tabs = get().tabs.filter((item) => item.absolutePath !== absolutePath)
    const activePath =
      get().activePath === absolutePath ? (tabs[tabs.length - 1]?.absolutePath ?? null) : get().activePath
    set({
      tabs,
      activePath,
      open: tabs.length > 0
    })
    return true
  },

  closeTabForced: (absolutePath) => {
    const tabs = get().tabs.filter((item) => item.absolutePath !== absolutePath)
    const activePath =
      get().activePath === absolutePath ? (tabs[tabs.length - 1]?.absolutePath ?? null) : get().activePath
    set({
      tabs,
      activePath,
      open: tabs.length > 0
    })
  },

  closeIde: () => {
    if (get().tabs.some(tabIsDirty)) return false
    set({ open: false, tabs: [], activePath: null })
    return true
  },

  forceClose: () => {
    set({ open: false, tabs: [], activePath: null, saving: false })
  }
}))
