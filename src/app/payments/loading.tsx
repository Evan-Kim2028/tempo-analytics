function SkeletonCard() {
  return <div className="h-28 rounded-lg border border-tempo-border bg-tempo-card animate-pulse" />
}

export default function Loading() {
  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <div className="h-9 w-40 rounded bg-tempo-card animate-pulse" />
        <div className="h-4 w-96 max-w-full rounded bg-tempo-card animate-pulse" />
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, index) => <SkeletonCard key={index} />)}
      </div>
      <div className="h-96 rounded-lg border border-tempo-border bg-tempo-card animate-pulse" />
      <div className="grid gap-6">
        <div className="h-80 rounded-lg border border-tempo-border bg-tempo-card animate-pulse" />
        <div className="h-80 rounded-lg border border-tempo-border bg-tempo-card animate-pulse" />
        <div className="h-80 rounded-lg border border-tempo-border bg-tempo-card animate-pulse" />
      </div>
    </div>
  )
}
