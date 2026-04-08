import { render, screen, within } from '@testing-library/react'
import { BridgeFlowTable } from '@/components/BridgeFlowTable'

describe('BridgeFlowTable', () => {
  it('renders a provider daily row with compact USD formatting', () => {
    render(
      <BridgeFlowTable
        providerFlows={[
          {
            day: '2026-04-08',
            provider: 'stargate',
            provider_label: 'Stargate',
            gross_inflow: 1250000,
            gross_outflow: 250000,
            net_flow: 1000000,
            tx_count: 17,
            unique_users: 9,
          },
        ]}
        providerAssetFlows={[
          {
            day: '2026-04-08',
            provider: 'stargate',
            provider_label: 'Stargate',
            asset: 'USDC.e',
            token: '0x1111111111111111111111111111111111111111',
            gross_inflow: 1500000,
            gross_outflow: 500000,
            net_flow: 1000000,
            tx_count: 12,
            unique_users: 4,
          },
        ]}
      />,
    )

    const providerSection = screen.getByRole('heading', { name: 'Provider Daily Rows' }).closest('div')?.parentElement
    const assetSection = screen.getByRole('heading', { name: 'Provider Asset Rollups' }).closest('div')?.parentElement

    expect(providerSection).not.toBeNull()
    expect(within(providerSection as HTMLElement).getByText('Stargate')).toBeInTheDocument()
    expect(within(providerSection as HTMLElement).getByText('$1.25M')).toBeInTheDocument()
    expect(within(providerSection as HTMLElement).getByText('$250.00K')).toBeInTheDocument()
    expect(within(providerSection as HTMLElement).getByText('$1.00M')).toBeInTheDocument()

    expect(assetSection).not.toBeNull()
    expect(within(assetSection as HTMLElement).getByText('USDC.e')).toBeInTheDocument()
    expect(within(assetSection as HTMLElement).getByText('$1.50M')).toBeInTheDocument()
    expect(within(assetSection as HTMLElement).getByText('$500.00K')).toBeInTheDocument()
  })

  it('renders an empty-state message when no rows exist', () => {
    render(<BridgeFlowTable providerFlows={[]} providerAssetFlows={[]} />)

    expect(screen.getAllByText('No bridge flows found for the selected period.')).toHaveLength(2)
  })
})
