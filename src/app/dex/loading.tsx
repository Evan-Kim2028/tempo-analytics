export default function DexLoading() {
  return (
    <main className="max-w-7xl mx-auto px-4 py-8">
      {/* Page header */}
      <div className="mb-8">
        <div className="h-8 w-32 bg-tempo-border rounded animate-pulse mb-2" />
        <div className="h-5 w-full max-w-2xl bg-tempo-border/50 rounded animate-pulse" />
      </div>

      {/* Section 1: Fee AMM */}
      <section className="mb-12">
        <div className="flex items-center gap-3 mb-3">
          <div className="h-5 w-32 bg-tempo-border rounded animate-pulse" />
          <div className="h-5 w-16 bg-tempo-border rounded-full animate-pulse" />
        </div>
        <div className="h-5 w-full max-w-2xl bg-tempo-border/50 rounded animate-pulse mb-6" />

        {/* 3 stat cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="bg-tempo-card border border-tempo-border rounded-lg p-5 h-24 animate-pulse" />
          <div className="bg-tempo-card border border-tempo-border rounded-lg p-5 h-24 animate-pulse" />
          <div className="bg-tempo-card border border-tempo-border rounded-lg p-5 h-24 animate-pulse" />
        </div>

        {/* Chart */}
        <div className="bg-tempo-card border border-tempo-border rounded-lg h-80 animate-pulse" />
      </section>

      {/* Section 2: Protocol DEX */}
      <section className="mb-12">
        <div className="flex items-center gap-3 mb-3">
          <div className="h-5 w-32 bg-tempo-border rounded animate-pulse" />
          <div className="h-5 w-16 bg-tempo-border rounded-full animate-pulse" />
        </div>
        <div className="h-5 w-full max-w-2xl bg-tempo-border/50 rounded animate-pulse mb-6" />

        {/* 3 stat cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="bg-tempo-card border border-tempo-border rounded-lg p-5 h-24 animate-pulse" />
          <div className="bg-tempo-card border border-tempo-border rounded-lg p-5 h-24 animate-pulse" />
          <div className="bg-tempo-card border border-tempo-border rounded-lg p-5 h-24 animate-pulse" />
        </div>

        {/* Chart */}
        <div className="bg-tempo-card border border-tempo-border rounded-lg h-80 animate-pulse" />
      </section>

      {/* Section 3: Community DEX */}
      <section>
        <div className="flex items-center gap-3 mb-3">
          <div className="h-5 w-32 bg-tempo-border rounded animate-pulse" />
          <div className="h-5 w-16 bg-tempo-border rounded-full animate-pulse" />
        </div>
        <div className="h-5 w-full max-w-2xl bg-tempo-border/50 rounded animate-pulse mb-6" />

        {/* 3 stat cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="bg-tempo-card border border-tempo-border rounded-lg p-5 h-24 animate-pulse" />
          <div className="bg-tempo-card border border-tempo-border rounded-lg p-5 h-24 animate-pulse" />
          <div className="bg-tempo-card border border-tempo-border rounded-lg p-5 h-24 animate-pulse" />
        </div>

        {/* Chart */}
        <div className="bg-tempo-card border border-tempo-border rounded-lg h-80 animate-pulse mb-6" />

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
      </section>
    </main>
  )
}
