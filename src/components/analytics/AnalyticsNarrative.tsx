import type { ReactNode } from 'react'
import {
  type FeeTokenMixChartData,
  type SponsorConcentrationPoint,
  type TempoFeatureAdoptionPoint,
  type TempoTxSharePoint,
  type TopSponsorRow,
  type WebauthnUsagePoint,
} from '@/lib/tempoAnalytics'
import { FeeTokenMixChart } from '@/components/charts/FeeTokenMixChart'
import { SponsorConcentrationChart } from '@/components/charts/SponsorConcentrationChart'
import { TempoFeatureAdoptionChart } from '@/components/charts/TempoFeatureAdoptionChart'
import { TempoTxShareChart } from '@/components/charts/TempoTxShareChart'
import { WebauthnUsageChart } from '@/components/charts/WebauthnUsageChart'
import { TopSponsorsTable } from '@/components/analytics/TopSponsorsTable'

interface AnalyticsNarrativeProps {
  tempoShare: TempoTxSharePoint[]
  featureAdoption: TempoFeatureAdoptionPoint[]
  feeTokenMix: FeeTokenMixChartData
  sponsorConcentration: SponsorConcentrationPoint[]
  topSponsors: TopSponsorRow[]
  webauthnUsage: WebauthnUsagePoint[]
}

function ChartCard({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
  return (
    <section className="bg-tempo-card border border-tempo-border rounded-lg p-5">
      <h2 className="text-lg font-medium text-white mb-4">{title}</h2>
      {children}
    </section>
  )
}

export function AnalyticsNarrative({
  tempoShare,
  featureAdoption,
  feeTokenMix,
  sponsorConcentration,
  topSponsors,
  webauthnUsage,
}: AnalyticsNarrativeProps) {
  return (
    <div className="space-y-6">
      <ChartCard title="Tempo Tx Share Over Time">
        <TempoTxShareChart data={tempoShare} />
      </ChartCard>

      <ChartCard title="Tempo Wallet Adoption">
        <TempoFeatureAdoptionChart data={featureAdoption} />
      </ChartCard>

      <ChartCard title="Fee Token Mix Over Time">
        <FeeTokenMixChart data={feeTokenMix} />
      </ChartCard>

      <ChartCard title="Sponsor Concentration Over Time">
        <SponsorConcentrationChart data={sponsorConcentration} />
      </ChartCard>

      <ChartCard title="Top Sponsors">
        <TopSponsorsTable data={topSponsors} />
      </ChartCard>

      <ChartCard title="WebAuthn/Passkey Usage Over Time">
        <WebauthnUsageChart data={webauthnUsage} />
      </ChartCard>
    </div>
  )
}
