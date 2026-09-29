import { useEffect, useState } from 'react'
import type { DailyLearnView } from '@shared/contracts/secretary'
import { useDeveloperIntelligenceStore } from '@renderer/stores/developer-intelligence-store'
import { useSecretaryStore } from '@renderer/stores/secretary-store'

export function DailyLearnCard({ active }: { active: boolean }): React.JSX.Element {
  const configured = useSecretaryStore((state) => state.settings.configured)
  const includeMemory = useDeveloperIntelligenceStore((state) => state.settings.includeMemoryInPrompts)
  const memoryCount = useDeveloperIntelligenceStore((state) => state.memories.length)
  const [view, setView] = useState<DailyLearnView | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!active || !configured) return
    let current = true
    setLoading(true)
    void window.api.secretary.getDailyLearn().then((result) => {
      if (current) setView(result)
    }).catch(() => {
      if (current) setView({ status: 'unavailable', lesson: null })
    }).finally(() => {
      if (current) setLoading(false)
    })
    return () => { current = false }
  }, [active, configured, includeMemory, memoryCount])

  return (
    <section className="intelligence-daily" aria-label="Daily Learn">
      <span>DAILY LEARN{view?.lesson ? ` · ${view.lesson.basis}` : ''}</span>
      {configured && view?.status === 'ready' && view.lesson ? (
        <>
          <strong>{view.lesson.topic}</strong>
          <p>{view.lesson.body}</p>
        </>
      ) : (
        <p>
          {!configured
            ? 'A Manager model connection in Settings is needed for generated lessons.'
            : loading || !view
              ? "Preparing today's lesson…"
              : view.status === 'memory-off'
                ? 'Share memory with Manager to generate a lesson.'
                : view.status === 'empty'
                  ? 'Daily Learn starts once memory knows how you work.'
                  : "Today's lesson is not ready. It will try again tomorrow."}
        </p>
      )}
    </section>
  )
}
