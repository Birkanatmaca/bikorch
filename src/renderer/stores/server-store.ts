import { normalizeServerDraft, parseRemoteServers, type RemoteServer } from '@shared/contracts/servers'
import { create } from 'zustand'
import { v4 as uuidv4 } from 'uuid'

interface ServerState {
  servers: RemoteServer[]
  hydrate: (servers: RemoteServer[]) => void
  addServer: (draft: {
    name: string
    user: string
    host: string
    port: string
  }) => { ok: true; server: RemoteServer } | { ok: false; error: string }
  updateServer: (
    id: string,
    draft: { name: string; user: string; host: string; port: string }
  ) => { ok: true; server: RemoteServer } | { ok: false; error: string }
  removeServer: (id: string) => void
}

export const useServerStore = create<ServerState>((set, get) => ({
  servers: [],

  hydrate: (servers) => set({ servers: parseRemoteServers(servers) }),

  addServer: (draft) => {
    const result = normalizeServerDraft(draft, uuidv4())
    if (!result.ok) return result
    set({ servers: [...get().servers, result.server] })
    return result
  },

  updateServer: (id, draft) => {
    if (!get().servers.some((server) => server.id === id)) {
      return { ok: false, error: 'That server is no longer in the list.' }
    }
    const result = normalizeServerDraft(draft, id)
    if (!result.ok) return result
    set({
      servers: get().servers.map((server) => (server.id === id ? result.server : server))
    })
    return result
  },

  removeServer: (id) => set({ servers: get().servers.filter((server) => server.id !== id) })
}))
