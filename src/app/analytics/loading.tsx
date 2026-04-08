export default function AnalyticsLoading() {
  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      {/* Page header */}
      <div className="mb-8">
        <div className="h-7 w-32 bg-tempo-border rounded animate-pulse mb-1" />
        <div className="h-4 w-64 bg-tempo-border/50 rounded animate-pulse mt-1" />
      </div>

      {/* Section 1: AA Features (2-card grid, no badge) */}
      <section className="mb-12">
        <div className="h-5 w-36 bg-tempo-border rounded animate-pulse mb-3" />

        {/* 2 stat cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
          <div className="bg-tempo-card border border-tempo-border rounded-lg p-5 h-24 animate-pulse" />
          <div className="bg-tempo-card border border-tempo-border rounded-lg p-5 h-24 animate-pulse" />
        </div>

        {/* Chart */}
        <div className="bg-tempo-card border border-tempo-border rounded-lg h-[340px] animate-pulse" />
      </section>

      {/* Section 2: Stablecoins (3-card grid, no badge) */}
      <section className="mb-12">
        <div className="h-5 w-36 bg-tempo-border rounded animate-pulse mb-3" />

        {/* 3 stat cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="bg-tempo-card border border-tempo-border rounded-lg p-5 h-24 animate-pulse" />
          <div className="bg-tempo-card border border-tempo-border rounded-lg p-5 h-24 animate-pulse" />
          <div className="bg-tempo-card border border-tempo-border rounded-lg p-5 h-24 animate-pulse" />
        </div>

        {/* Chart */}
        <div className="bg-tempo-card border border-tempo-border rounded-lg h-[340px] animate-pulse mb-4" />

        {/* Link row */}
        <div className="h-4 w-32 bg-tempo-border/50 rounded animate-pulse" />
      </section>

      {/* Section 3: Protocol DEX (3-card grid, with badge) */}
      <section className="mb-12">
        <div className="flex items-center gap-3 mb-3">
          <div className="h-5 w-36 bg-tempo-border rounded animate-pulse" />
          <div className="h-5 w-16 bg-tempo-border rounded-full animate-pulse" />
        </div>

        {/* 3 stat cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="bg-tempo-card border border-tempo-border rounded-lg p-5 h-24 animate-pulse" />
          <div className="bg-tempo-card border border-tempo-border rounded-lg p-5 h-24 animate-pulse" />
          <div className="bg-tempo-card border border-tempo-border rounded-lg p-5 h-24 animate-pulse" />
        </div>

        {/* Chart */}
        <div className="bg-tempo-card border border-tempo-border rounded-lg h-[340px] animate-pulse mb-4" />

        {/* Link row */}
        <div className="h-4 w-32 bg-tempo-border/50 rounded animate-pulse" />
      </section>

      {/* Section 4: Community DEX (2-card grid, with badge) */}
      <section className="mb-12">
        <div className="flex items-center gap-3 mb-3">
          <div className="h-5 w-36 bg-tempo-border rounded animate-pulse" />
          <div className="h-5 w-16 bg-tempo-border rounded-full animate-pulse" />
        </div>

        {/* 2 stat cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
          <div className="bg-tempo-card border border-tempo-border rounded-lg p-5 h-24 animate-pulse" />
          <div className="bg-tempo-card border border-tempo-border rounded-lg p-5 h-24 animate-pulse" />
        </div>

        {/* Chart */}
        <div className="bg-tempo-card border border-tempo-border rounded-lg h-[340px] animate-pulse mb-4" />

        {/* Link row */}
        <div className="h-4 w-32 bg-tempo-border/50 rounded animate-pulse" />
      </section>
    </div>
  )
}
