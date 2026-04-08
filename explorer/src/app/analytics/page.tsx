import { AnalyticsNarrative } from '@/components/analytics/AnalyticsNarrative'
import {
  getFeeTokenMixByDay,
  getSponsorConcentrationByDay,
  getTempoFeatureAdoptionByDay,
  getTempoTxShareByDay,
  getTopSponsors,
  getWebauthnUsageByDay,
} from '@/lib/tempoAnalytics'

export const revalidate = 900

export default async function AnalyticsPage() {
  const [
    tempoShare,
    featureAdoption,
    feeTokenMix,
    sponsorConcentration,
    topSponsors,
    webauthnUsage,
  ] = await Promise.all([
    getTempoTxShareByDay(),
    getTempoFeatureAdoptionByDay(),
    getFeeTokenMixByDay(),
    getSponsorConcentrationByDay(),
    getTopSponsors(),
    getWebauthnUsageByDay(),
  ])

  return (
    <div className="space-y-8">
      <header className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-2">
            <h1 className="text-3xl font-semibold text-white">Analytics</h1>
            <p className="max-w-3xl text-sm text-tempo-muted">
              Tempo transaction adoption, fee behavior, sponsors, and passkey activity
            </p>
          </div>
          <span className="inline-flex items-center rounded-full border border-tempo-border bg-tempo-card px-3 py-1 text-xs text-tempo-muted">
            Updates every 15 min · Mainnet data
          </span>
        </div>
      </header>

      <AnalyticsNarrative
        tempoShare={tempoShare}
        featureAdoption={featureAdoption}
        feeTokenMix={feeTokenMix}
        sponsorConcentration={sponsorConcentration}
        topSponsors={topSponsors}
        webauthnUsage={webauthnUsage}
      />
    </div>
  )
}
