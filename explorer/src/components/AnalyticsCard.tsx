interface AnalyticsCardProps {
  title: string
  description: string
  slug: string
  available: boolean
  tags?: string[]
}

export function AnalyticsCard({ title, description, slug, available, tags = [] }: AnalyticsCardProps) {
  const inner = (
    <div className={`bg-tempo-card border rounded-lg p-5 h-full transition-colors ${
      available
        ? 'border-tempo-border hover:border-tempo-blue cursor-pointer'
        : 'border-tempo-border opacity-50 cursor-not-allowed'
    }`}>
      <div className="flex items-start justify-between mb-3">
        <h3 className="text-white font-medium">{title}</h3>
        {!available && (
          <span className="text-xs text-tempo-muted bg-tempo-border px-2 py-0.5 rounded">soon</span>
        )}
      </div>
      <p className="text-tempo-muted text-sm leading-relaxed">{description}</p>
      {tags.length > 0 && (
        <div className="flex gap-2 mt-3 flex-wrap">
          {tags.map(tag => (
            <span key={tag} className="text-xs text-tempo-blue bg-tempo-blue/10 px-2 py-0.5 rounded-full">
              {tag}
            </span>
          ))}
        </div>
      )}
    </div>
  )

  if (!available) return <div>{inner}</div>
  return <a href={`/analytics/${slug}`}>{inner}</a>
}
