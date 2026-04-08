export default function AnalyticsLoading() {
  return (
    <main className="max-w-7xl mx-auto px-4 py-8">
      {/* Page header */}
      <div className="mb-8">
        <div className="h-8 w-64 bg-tempo-border rounded animate-pulse mb-2" />
        <div className="h-5 w-full max-w-2xl bg-tempo-border/50 rounded animate-pulse" />
      </div>

      {/* Section 1: AA Features (2-card grid) */}
      <section className="mb-12">
        <div className="h-6 w-40 bg-tempo-border rounded animate-pulse mb-6" />

        {/* 2 stat cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          <div className="bg-tempo-card border border-tempo-border rounded-lg p-5 h-24 animate-pulse" />
          <div className="bg-tempo-card border border-tempo-border rounded-lg p-5 h-24 animate-pulse" />
        </div>

        {/* Chart */}
        <div className="bg-tempo-card border border-tempo-border rounded-lg h-80 animate-pulse" />
      </section>

      {/* Section 2: Stablecoins (3-card grid) */}
      <section className="mb-12">
        <div className="h-6 w-40 bg-tempo-border rounded animate-pulse mb-6" />

        {/* 3 stat cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="bg-tempo-card border border-tempo-border rounded-lg p-5 h-24 animate-pulse" />
          <div className="bg-tempo-card border border-tempo-border rounded-lg p-5 h-24 animate-pulse" />
          <div className="bg-tempo-card border border-tempo-border rounded-lg p-5 h-24 animate-pulse" />
        </div>

        {/* Chart */}
        <div className="bg-tempo-card border border-tempo-border rounded-lg h-80 animate-pulse" />
      </section>

      {/* Section 3: Protocol DEX (3-card grid) */}
      <section className="mb-12">
        <div className="h-6 w-40 bg-tempo-border rounded animate-pulse mb-6" />

        {/* 3 stat cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="bg-tempo-card border border-tempo-border rounded-lg p-5 h-24 animate-pulse" />
          <div className="bg-tempo-card border border-tempo-border rounded-lg p-5 h-24 animate-pulse" />
          <div className="bg-tempo-card border border-tempo-border rounded-lg p-5 h-24 animate-pulse" />
        </div>

        {/* Chart */}
        <div className="bg-tempo-card border border-tempo-border rounded-lg h-80 animate-pulse" />
      </section>

      {/* Section 4: Community DEX (2-card grid) */}
      <section>
        <div className="h-6 w-40 bg-tempo-border rounded animate-pulse mb-6" />

        {/* 2 stat cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          <div className="bg-tempo-card border border-tempo-border rounded-lg p-5 h-24 animate-pulse" />
          <div className="bg-tempo-card border border-tempo-border rounded-lg p-5 h-24 animate-pulse" />
        </div>

        {/* Chart */}
        <div className="bg-tempo-card border border-tempo-border rounded-lg h-80 animate-pulse" />
      </section>
    </main>
  )
}
