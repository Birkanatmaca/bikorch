import { useEffect, useState } from 'react'
import { Pencil, Plus, RefreshCw, Server, Trash2, X } from 'lucide-react'
import { sshTargetLabel, type RemoteServer, type RemoteServerDraft } from '@shared/contracts/servers'
import { OPEN_SERVERS_EVENT } from '@renderer/lib/app-events'
import { useServerStore } from '@renderer/stores/server-store'
import { useServerHealthStore, watchServerHealth } from '@renderer/stores/server-health-store'
import { HealthDot, ServerHealthDetails } from '@renderer/components/servers/ServerHealthView'
import { useWorkspaceStore } from '@renderer/stores/workspace-store'

const OPEN_KEY = 'bikorch.serverDockOpen'

const EMPTY_DRAFT: RemoteServerDraft = { name: '', user: '', host: '', port: '' }

function readDockOpen(): boolean {
  try {
    return window.localStorage.getItem(OPEN_KEY) !== '0'
  } catch {
    return true
  }
}

function writeDockOpen(open: boolean): void {
  try {
    window.localStorage.setItem(OPEN_KEY, open ? '1' : '0')
  } catch {
    // The list still works when local preference storage is blocked.
  }
}

export function ServerDock(): React.JSX.Element {
  const servers = useServerStore((state) => state.servers)
  const addServer = useServerStore((state) => state.addServer)
  const updateServer = useServerStore((state) => state.updateServer)
  const removeServer = useServerStore((state) => state.removeServer)
  const openRemoteServer = useWorkspaceStore((state) => state.openRemoteServer)
  const syncServerPanels = useWorkspaceStore((state) => state.syncServerPanels)
  const closeServerPanels = useWorkspaceStore((state) => state.closeServerPanels)
  const [open, setOpen] = useState(readDockOpen)
  const [formOpen, setFormOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<RemoteServerDraft>(EMPTY_DRAFT)
  const [error, setError] = useState<string | null>(null)
  const healthById = useServerHealthStore((state) => state.healthById)
  const checkingIds = useServerHealthStore((state) => state.checkingIds)
  const historyById = useServerHealthStore((state) => state.historyById)

  // Health is checked only while the dock is open.
  useEffect(() => (open ? watchServerHealth() : undefined), [open])

  useEffect(() => {
    const show = (): void => setOpen(true)
    window.addEventListener(OPEN_SERVERS_EVENT, show)
    return () => window.removeEventListener(OPEN_SERVERS_EVENT, show)
  }, [])

  const setDockOpen = (next: boolean): void => {
    setOpen(next)
    writeDockOpen(next)
  }

  const startCreate = (): void => {
    setEditingId(null)
    setDraft(EMPTY_DRAFT)
    setError(null)
    setFormOpen(true)
  }

  const startEdit = (server: RemoteServer): void => {
    setEditingId(server.id)
    setDraft({
      name: server.name,
      user: server.user,
      host: server.host,
      port: String(server.port)
    })
    setError(null)
    setFormOpen(true)
  }

  const save = (): void => {
    const result = editingId ? updateServer(editingId, draft) : addServer(draft)
    if (!result.ok) {
      setError(result.error)
      return
    }
    syncServerPanels(result.server)
    void useServerHealthStore.getState().check(result.server)
    setDraft(EMPTY_DRAFT)
    setEditingId(null)
    setError(null)
    setFormOpen(false)
  }

  const remove = (serverId: string): void => {
    removeServer(serverId)
    closeServerPanels(serverId)
    if (editingId === serverId) {
      setFormOpen(false)
      setEditingId(null)
      setDraft(EMPTY_DRAFT)
    }
  }

  if (!open) {
    return (
      <section className="server-dock is-collapsed app-no-drag" aria-label="Servers">
        <button
          type="button"
          className="server-dock-rail"
          onClick={() => setDockOpen(true)}
          aria-expanded={false}
          aria-label="Open servers"
        >
          <Server className="h-4 w-4" aria-hidden />
          <span>Servers</span>
        </button>
      </section>
    )
  }

  return (
    <section className="server-dock is-open app-no-drag" aria-label="Servers">
      <div className="server-dock-panel">
        <header className="server-dock-header">
          <Server className="h-4 w-4" aria-hidden />
          <strong>Servers</strong>
          {servers.length > 0 && (
            <button type="button" className="server-dock-icon" onClick={() => void useServerHealthStore.getState().checkAll()} aria-label="Check all servers" title="Check all servers">
              <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            </button>
          )}
          <button type="button" className="server-dock-icon" onClick={startCreate} aria-label="Add server">
            <Plus className="h-4 w-4" aria-hidden />
          </button>
          <button type="button" className="server-dock-icon" onClick={() => setDockOpen(false)} aria-label="Collapse servers">
            <X className="h-4 w-4" aria-hidden />
          </button>
        </header>

        {formOpen && (
          <form
            className="server-dock-form"
            onSubmit={(event) => {
              event.preventDefault()
              save()
            }}
          >
            <label>
              Name
              <input
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                placeholder="Production"
                maxLength={48}
                autoFocus
              />
            </label>
            <label>
              User
              <input
                value={draft.user}
                onChange={(event) => setDraft({ ...draft, user: event.target.value })}
                placeholder="deploy"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
              />
            </label>
            <label>
              Host
              <input
                value={draft.host}
                onChange={(event) => setDraft({ ...draft, host: event.target.value })}
                placeholder="app.example.com"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
              />
            </label>
            <label>
              Port
              <input
                value={draft.port}
                onChange={(event) => setDraft({ ...draft, port: event.target.value })}
                placeholder="22"
                inputMode="numeric"
              />
            </label>
            {error && <p role="alert">{error}</p>}
            <div className="server-dock-form-actions">
              <button type="button" onClick={() => { setFormOpen(false); setError(null) }}>
                Cancel
              </button>
              <button type="submit">{editingId ? 'Save' : 'Add server'}</button>
            </div>
          </form>
        )}

        <div className="server-dock-list">
          {servers.length === 0 && !formOpen && (
            <div className="server-dock-empty">
              <strong>No servers yet</strong>
              <p>Add each machine by name. Opening one starts an SSH session in this workspace.</p>
              <button type="button" onClick={startCreate}>Add a server</button>
            </div>
          )}
          {servers.map((server) => (
            <div key={server.id} className="server-dock-card">
            <div className="server-dock-row">
              <HealthDot health={healthById[server.id]} checking={checkingIds[server.id]} />
              <button type="button" className="server-dock-open" onClick={() => openRemoteServer(server)} title="Open an SSH terminal">
                <strong>{server.name}</strong>
                <small>{sshTargetLabel(server)}</small>
              </button>
              <button type="button" className="server-dock-icon" onClick={() => startEdit(server)} aria-label={`Rename ${server.name}`}>
                <Pencil className="h-3.5 w-3.5" aria-hidden />
              </button>
              <button type="button" className="server-dock-icon" onClick={() => remove(server.id)} aria-label={`Remove ${server.name}`}>
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>
            <ServerHealthDetails health={healthById[server.id]} history={historyById[server.id]} />
            </div>
          ))}
        </div>
        {servers.length > 0 && (
          <p className="server-dock-note">An open session keeps its connection until you close that terminal.</p>
        )}
      </div>
    </section>
  )
}
