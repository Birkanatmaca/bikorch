import { useEffect, useMemo, useRef, useState } from 'react'
import { cn } from '@renderer/lib/utils'

export function compactNumber(value: number): string {
  if (value >= 1e9) return `${(value / 1e9).toFixed(1)}B`
  if (value >= 1e6) return `${(value / 1e6).toFixed(value >= 1e7 ? 0 : 1)}M`
  if (value >= 1e3) return `${(value / 1e3).toFixed(value >= 1e4 ? 0 : 1)}K`
  return String(Math.round(value))
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 4) return `${(bytes / 1024 ** 4).toFixed(1)} TB`
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(bytes >= 10 * 1024 ** 3 ? 0 : 1)} GB`
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`
  return `${Math.round(bytes / 1024)} KB`
}

/** Local YYYY-MM-DD for a date. */
export function dayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/** A progress ring with the value in the middle. */
export function Ring({
  value,
  label,
  sublabel,
  size = 88,
  tone = 'violet'
}: {
  value: number
  label: string
  sublabel?: string
  size?: number
  tone?: 'violet' | 'teal' | 'amber' | 'rose' | 'sky'
}): React.JSX.Element {
  const clamped = Math.max(0, Math.min(100, value))
  // Drawn on a fixed 100-unit box; CSS sizes the ring to its widget.
  const box = 100
  const stroke = 8
  const radius = (box - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const hot = clamped >= 90 ? 'rose' : clamped >= 75 ? 'amber' : tone
  return (
    <div className={cn('home-ring', `tone-${hot}`)} style={{ ['--ring-size' as string]: `${size}px` }}>
      <svg width="100%" height="100%" viewBox={`0 0 ${box} ${box}`} aria-hidden>
        <circle className="home-ring-track" cx={box / 2} cy={box / 2} r={radius} strokeWidth={stroke} fill="none" />
        <circle
          className="home-ring-value"
          cx={box / 2}
          cy={box / 2}
          r={radius}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - clamped / 100)}
          transform={`rotate(-90 ${box / 2} ${box / 2})`}
        />
      </svg>
      <span className="home-ring-text">
        <strong>{label}</strong>
        {sublabel && <small>{sublabel}</small>}
      </span>
    </div>
  )
}

export interface BarDatum {
  key: string
  label: string
  values: number[]
}

/** Stacked daily bars with a hover readout. */
export function StackedBars({
  data,
  series
}: {
  data: BarDatum[]
  series: Array<{ name: string; className: string }>
}): React.JSX.Element {
  const [hover, setHover] = useState<number | null>(null)
  const max = Math.max(1, ...data.map((item) => item.values.reduce((a, b) => a + b, 0)))
  const active = hover !== null ? data[hover] : null
  return (
    <div className="home-bars" onMouseLeave={() => setHover(null)}>
      <div className="home-bars-plot">
        {data.map((item, index) => {
          const total = item.values.reduce((a, b) => a + b, 0)
          return (
            <div key={item.key} className={cn('home-bar', hover === index && 'is-hover')} onMouseEnter={() => setHover(index)}>
              <div className="home-bar-stack" style={{ height: `${(total / max) * 100}%` }}>
                {item.values.map((value, seriesIndex) => (
                  <span
                    key={seriesIndex}
                    className={series[seriesIndex]?.className}
                    style={{ flexGrow: value }}
                  />
                ))}
              </div>
            </div>
          )
        })}
      </div>
      <div className="home-bars-readout">
        {active ? (
          <>
            <span>{active.label}</span>
            {series.map((entry, index) => (
              <span key={entry.name} className="home-bars-key">
                <i className={entry.className} />
                {entry.name} {compactNumber(active.values[index] ?? 0)}
              </span>
            ))}
          </>
        ) : (
          series.map((entry) => (
            <span key={entry.name} className="home-bars-key">
              <i className={entry.className} />
              {entry.name}
            </span>
          ))
        )}
      </div>
    </div>
  )
}

/** GitHub-style contribution map for the last 53 weeks, Monday first. */
/** Weeks that fit `width` with cells no smaller than `minCell` px. */
export function weeksThatFit(width: number, minCell = 9, gap = 3): number {
  return Math.max(8, Math.min(53, Math.floor((width + gap) / (minCell + gap))))
}

export function ContributionMap({ days, unit = 'commit' }: { days: Record<string, number>; unit?: string }): React.JSX.Element {
  const [hover, setHover] = useState<{ date: string; count: number } | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const [fit, setFit] = useState({ weeks: 53, cell: 12 })
  // Narrow widgets show the most recent weeks instead of shrinking cells to dots;
  // short widgets size cells by height so the map never overflows.
  useEffect(() => {
    const node = rootRef.current
    if (!node) return
    const measure = (): void => {
      const { width, height } = node.getBoundingClientRect()
      const byHeight = Math.max(6, Math.floor((height - 40 - 6 * 3) / 7))
      const cell = Math.min(16, byHeight)
      setFit({ weeks: weeksThatFit(width, Math.min(cell, 12)), cell })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])
  const allWeeks = useMemo(() => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const start = new Date(today)
    // Start on the Monday 52 weeks back so the last column holds this week.
    start.setDate(start.getDate() - 52 * 7 - ((today.getDay() + 6) % 7))
    const columns: Array<Array<{ date: string; count: number; future: boolean }>> = []
    const cursor = new Date(start)
    while (cursor <= today || columns.length === 0 || columns[columns.length - 1].length < 7) {
      if (columns.length === 0 || columns[columns.length - 1].length === 7) columns.push([])
      const key = dayKey(cursor)
      columns[columns.length - 1].push({ date: key, count: days[key] ?? 0, future: cursor > today })
      cursor.setDate(cursor.getDate() + 1)
      if (columns.length > 54) break
    }
    return columns
  }, [days])
  const weeks = allWeeks.slice(-fit.weeks)
  const max = Math.max(1, ...Object.values(days))
  const level = (count: number): number => (count === 0 ? 0 : Math.min(4, Math.ceil((count / max) * 4)))
  const months = weeks.map((week, index) => {
    const first = new Date(week[0].date)
    const previous = index > 0 ? new Date(weeks[index - 1][0].date) : null
    return !previous || previous.getMonth() !== first.getMonth() ? first.toLocaleString(undefined, { month: 'short' }) : ''
  })
  return (
    <div ref={rootRef} className="home-map" style={{ ['--cell' as string]: `${fit.cell}px` }} onMouseLeave={() => setHover(null)}>
      <div className="home-map-months" style={{ gridTemplateColumns: `repeat(${weeks.length}, minmax(0, var(--cell)))` }}>
        {months.map((month, index) => <span key={index}>{month}</span>)}
      </div>
      <div className="home-map-grid" style={{ gridTemplateColumns: `repeat(${weeks.length}, minmax(0, var(--cell)))` }}>
        {weeks.map((week, column) => (
          <div key={column} className="home-map-week">
            {week.map((day) => (
              <span
                key={day.date}
                className={cn('home-map-cell', `level-${level(day.count)}`, day.future && 'is-future')}
                onMouseEnter={() => setHover(day)}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="home-map-foot">
        <span>
          {hover
            ? `${hover.count} ${unit}${hover.count === 1 ? '' : 's'} on ${new Date(hover.date).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}`
            : 'Hover a day for details'}
        </span>
        <span className="home-map-legend">
          Less
          {[0, 1, 2, 3, 4].map((value) => <i key={value} className={cn('home-map-cell', `level-${value}`)} />)}
          More
        </span>
      </div>
    </div>
  )
}

/** Current and longest run of consecutive active days ending today or yesterday. */
export function streaks(days: Record<string, number>): { current: number; longest: number } {
  const active = new Set(Object.entries(days).filter(([, count]) => count > 0).map(([date]) => date))
  const cursor = new Date()
  if (!active.has(dayKey(cursor))) cursor.setDate(cursor.getDate() - 1)
  let current = 0
  while (active.has(dayKey(cursor))) {
    current += 1
    cursor.setDate(cursor.getDate() - 1)
  }
  let longest = 0
  let run = 0
  let previous: number | null = null
  for (const date of [...active].sort()) {
    const time = new Date(`${date}T12:00:00`).getTime()
    run = previous !== null && Math.round((time - previous) / 86_400_000) === 1 ? run + 1 : 1
    longest = Math.max(longest, run)
    previous = time
  }
  return { current, longest }
}
