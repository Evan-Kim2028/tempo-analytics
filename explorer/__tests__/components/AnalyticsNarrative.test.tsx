import { render, screen } from '@testing-library/react'
import { AnalyticsNarrative } from '@/components/analytics/AnalyticsNarrative'

jest.mock('recharts', () => {
  const React = require('react')

  const Container = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>
  const Series = ({ name }: { name?: string }) => <div>{name}</div>

  return {
    ResponsiveContainer: Container,
    LineChart: Container,
    BarChart: Container,
    CartesianGrid: () => null,
    XAxis: () => null,
    YAxis: () => null,
    Tooltip: () => null,
    Legend: () => null,
    Line: Series,
    Bar: Series,
  }
})

describe('AnalyticsNarrative', () => {
  it('renders the new analytics chart headings and sponsor table rows', () => {
    const tempoShare = [
      { day: '2026-04-01', tempo_txs: 50, total_txs: 200, tempo_pct: 25 },
    ]
    const featureAdoption = [
      { day: '2026-04-01', total_tempo: 100, sponsored_pct: 4, batched_pct: 2, time_bounded_pct: 80, fee_token_pct: 25 },
    ]
    const feeTokenMix = [
      { day: '2026-04-01', fee_token: '0xusdc', label: 'USDC.e', txs: 74, pct: 74 },
      { day: '2026-04-01', fee_token: '0xpath', label: 'pathUSD', txs: 26, pct: 26 },
    ]
    const sponsorConcentration = [
      { day: '2026-04-01', sponsored_txs: 120, top1_pct: 60, top5_pct: 95, sponsor_count: 5 },
    ]
    const topSponsors = [
      {
        sponsor: '0x3025f36b397dc7736389fcb8caf2c7dad0ff2356',
        sponsored_txs: 28922,
        unique_users_sponsored: 818,
        first_seen: '2026-03-17T02:40:04Z',
        last_seen: '2026-04-08T15:32:12Z',
      },
    ]
    const webauthnUsage = [
      { day: '2026-04-01', webauthn_txs: 293, webauthn_pct_of_tempo: 4.02 },
    ]

    render(
      <AnalyticsNarrative
        tempoShare={tempoShare as never}
        featureAdoption={featureAdoption as never}
        feeTokenMix={feeTokenMix as never}
        sponsorConcentration={sponsorConcentration}
        topSponsors={topSponsors}
        webauthnUsage={webauthnUsage}
      />
    )

    expect(screen.getByRole('heading', { name: 'Tempo Tx Share Over Time' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Tempo Feature Adoption Over Time' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Fee Token Mix Over Time' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Sponsor Concentration Over Time' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Top Sponsors' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'WebAuthn/Passkey Usage Over Time' })).toBeInTheDocument()
    expect(screen.getByText('USDC.e')).toBeInTheDocument()
    expect(screen.getByText('0x3025f36b397dc7736389fcb8caf2c7dad0ff2356')).toBeInTheDocument()
  })
})
