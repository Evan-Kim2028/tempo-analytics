'use client'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'

const OPTIONS: { label: string; days: number }[] = [
  { label: '1d',  days: 1  },
  { label: '7d',  days: 7  },
  { label: '30d', days: 30 },
]

export function PeriodToggle({ currentDays }: { currentDays: number }) {
  const params = useSearchParams()

  return (
    <div className="flex rounded overflow-hidden border border-tempo-border text-xs">
      {OPTIONS.map(o => {
        const next = new URLSearchParams(params.toString())
        next.set('days', String(o.days))
        const active = currentDays === o.days
        return (
          <Link
            key={o.days}
            href={`?${next.toString()}`}
            className={`px-3 py-1 transition-colors ${
              active ? 'bg-tempo-border text-white' : 'text-tempo-muted hover:text-white'
            }`}
          >
            {o.label}
          </Link>
        )
      })}
    </div>
  )
}
