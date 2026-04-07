interface StatCardProps {
  label: string
  value: string | number
  sub?: string
  mono?: boolean
}

export function StatCard({ label, value, sub, mono = false }: StatCardProps) {
  return (
    <div className="bg-tempo-card border border-tempo-border rounded-lg p-5">
      <p className="text-tempo-muted text-xs uppercase tracking-wider mb-2">{label}</p>
      <p className={`text-2xl font-semibold text-white ${mono ? 'font-mono' : ''}`}>
        {value}
      </p>
      {sub && <p className="text-tempo-muted text-xs mt-1">{sub}</p>}
    </div>
  )
}
