import { render, screen } from '@testing-library/react'
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
        providerAssetFlows={[]}
      />,
    )

    expect(screen.getByText('Stargate')).toBeInTheDocument()
    expect(screen.getByText('$1.25M')).toBeInTheDocument()
    expect(screen.getByText('$250.00K')).toBeInTheDocument()
    expect(screen.getByText('$1.00M')).toBeInTheDocument()
  })

  it('renders an empty-state message when no rows exist', () => {
    render(<BridgeFlowTable providerFlows={[]} providerAssetFlows={[]} />)

    expect(screen.getAllByText('No bridge flows found for the selected period.')[0]).toBeInTheDocument()
  })
})
