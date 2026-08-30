import { useEffect, useState } from 'react'
import { flushPersistence, hydrateFromDisk, startPersistenceSync } from '@renderer/lib/persistence-sync'
import { useWorkspaceStore, createFallbackWorkspace } from '@renderer/stores/workspace-store'

const BOOTSTRAP_TIMEOUT_MS = 8000

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error('Workspace load timed out')), ms)
    })
  ])
}

export function usePersistenceBootstrap(): {
  isReady: boolean
  error: string | null
} {
  const [isReady, setIsReady] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true

    const bootstrap = async (): Promise<void> => {
      try {
        if (!window.api?.persistence) {
          throw new Error('Preload API not ready')
        }

        await withTimeout(hydrateFromDisk(), BOOTSTRAP_TIMEOUT_MS)
        if (!mounted) return
        startPersistenceSync()
        setIsReady(true)
      } catch (err) {
        if (!mounted) return
        const message = err instanceof Error ? err.message : 'Failed to load workspace'
        console.error('Bootstrap failed:', err)

        // Fallback so the app still opens
        useWorkspaceStore.getState().hydrate(createFallbackWorkspace())
        startPersistenceSync()
        setError(message)
        setIsReady(true)
      }
    }

    void bootstrap()

    const handleBeforeUnload = (): void => {
      void flushPersistence()
    }

    window.addEventListener('beforeunload', handleBeforeUnload)

    return () => {
      mounted = false
      window.removeEventListener('beforeunload', handleBeforeUnload)
      void flushPersistence()
    }
  }, [])

  return { isReady, error }
}
