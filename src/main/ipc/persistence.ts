import { ipcMain } from 'electron'
import { type PersistedSnapshot, PERSISTENCE_IPC } from '@shared/contracts/persistence'
import { loadSnapshot, saveSnapshot, createDefaultSnapshot } from '../persistence/database'

function validateSnapshot(payload: unknown): payload is PersistedSnapshot {
  if (!payload || typeof payload !== 'object') return false
  const snapshot = payload as PersistedSnapshot
  return (
    Array.isArray(snapshot.projects) &&
    typeof snapshot.workspaces === 'object' &&
    snapshot.workspaces !== null &&
    typeof snapshot.editor === 'object' &&
    snapshot.editor !== null
  )
}

export function registerPersistenceHandlers(): void {
  ipcMain.handle(PERSISTENCE_IPC.LOAD, () => {
    try {
      return loadSnapshot()
    } catch (error) {
      console.error('Failed to load snapshot:', error)
      return createDefaultSnapshot()
    }
  })

  ipcMain.handle(PERSISTENCE_IPC.SAVE, (_event, payload: unknown) => {
    if (!validateSnapshot(payload)) {
      throw new Error('Invalid persistence snapshot')
    }
    try {
      saveSnapshot(payload)
    } catch (error) {
      console.error('Failed to save snapshot:', error)
    }
  })
}
