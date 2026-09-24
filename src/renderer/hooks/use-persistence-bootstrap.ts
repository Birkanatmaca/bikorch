import { useEffect, useState } from 'react'
import { flushPersistence, hydrateFromDisk, startPersistenceSync } from '@renderer/lib/persistence-sync'
import { useWorkspaceStore, createFallbackWorkspace } from '@renderer/stores/workspace-store'
import { useResourceStore } from '@renderer/stores/resource-store'

const BOOTSTRAP_TIMEOUT_MS = 8000

async function withTimeout<T>(promise: Promise<T>, ms: number, onTimeout?: () => void): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          onTimeout?.()
          reject(new Error('Workspace load timed out'))
        }, ms)
      })
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export function usePersistenceBootstrap(): {
  isReady: boolean
  error: string | null
} {
  const [isReady, setIsReady] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true
    let hydrated = false
    let hydrationController: AbortController | null = null

    const bootstrap = async (): Promise<void> => {
      try {
        if (!window.api?.persistence) {
          throw new Error('Preload API not ready')
        }

        hydrationController = new AbortController()
        await withTimeout(
          hydrateFromDisk(hydrationController.signal),
          BOOTSTRAP_TIMEOUT_MS,
          () => hydrationController?.abort()
        )
        if (!mounted) return
        await withTimeout(useResourceStore.getState().hydrate(), 4000).catch(() => undefined)
        if (!mounted) return
        startPersistenceSync()
        hydrated = true
        setIsReady(true)
      } catch (err) {
        if (!mounted) return
        const message = err instanceof Error ? err.message : 'Failed to load workspace'
        console.error('Bootstrap failed:', err)

        // Fallback so the app still opens
        useWorkspaceStore.getState().hydrate(createFallbackWorkspace())
        await useResourceStore.getState().hydrate().catch(() => undefined)
        startPersistenceSync()
        hydrated = true
        setError(message)
        setIsReady(true)
      }
    }

    void bootstrap()

    const stopCloseFlush = window.api.persistence.onFlushRequest((token) => {
      void (async () => {
        try {
          if (hydrated) await flushPersistence()
        } catch (error) {
          console.error('Could not flush workspace state before close:', error)
        } finally {
          window.api.persistence.finishFlush(token)
        }
      })()
    })

    const handleBeforeUnload = (): void => {
      void flushPersistence().catch((error) => console.error('Could not flush workspace state:', error))
    }

    window.addEventListener('beforeunload', handleBeforeUnload)

    return () => {
      mounted = false
      hydrationController?.abort()
      stopCloseFlush()
      window.removeEventListener('beforeunload', handleBeforeUnload)
      void flushPersistence().catch((error) => console.error('Could not flush workspace state:', error))
    }
  }, [])

  return { isReady, error }
}
