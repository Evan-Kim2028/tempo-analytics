export default function StablecoinsLoading() {
  return (
    <main className="max-w-7xl mx-auto px-4 py-8">
      {/* Page header */}
      <div className="mb-8">
        <div className="h-8 w-48 bg-tempo-border rounded animate-pulse mb-2" />
        <div className="h-5 w-96 bg-tempo-border/50 rounded animate-pulse" />
      </div>

      {/* Summary cards - 3 card grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <div className="bg-tempo-card border border-tempo-border rounded-lg p-5 h-24 animate-pulse" />
        <div className="bg-tempo-card border border-tempo-border rounded-lg p-5 h-24 animate-pulse" />
        <div className="bg-tempo-card border border-tempo-border rounded-lg p-5 h-24 animate-pulse" />
      </div>

      {/* Supply chart */}
      <div className="bg-tempo-card border border-tempo-border rounded-lg h-[340px] animate-pulse mb-8" />

      {/* Volume chart */}
      <div className="bg-tempo-card border border-tempo-border rounded-lg h-[340px] animate-pulse mb-8" />

      {/* Table */}
      <div className="bg-tempo-card border border-tempo-border rounded-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-tempo-border">
          <div className="h-5 w-32 bg-tempo-border rounded animate-pulse" />
        </div>
        <div className="space-y-px">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-12 bg-tempo-border/50 rounded animate-pulse" />
          ))}
        </div>
      </div>
    </main>
  )
}
