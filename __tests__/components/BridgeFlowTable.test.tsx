import { render, screen } from '@testing-library/react'
import { BridgeFlowTable } from '@/components/BridgeFlowTable'

describe('BridgeFlowTable', () => {
  it('renders recent bridge events with direction labels and compact USD amounts', () => {
    render(
      <BridgeFlowTable
        events={[
          {
            day: '2026-04-08',
            provider: 'stargate',
            provider_label: 'Stargate',
            asset: 'USDC.e',
            token: '0x20c000000000000000000000b9537d11c60e8b50',
            user: '0xaabbccdd00000000000000000000000000000001',
            tx_hash: '0xdeadbeef00000000000000000000000000000000000000000000000000000001',
            direction: 'inflow',
            amount: 1250000,
          },
          {
            day: '2026-04-07',
            provider: 'stargate',
            provider_label: 'Stargate',
            asset: 'USDC.e',
            token: '0x20c000000000000000000000b9537d11c60e8b50',
            user: '0xaabbccdd00000000000000000000000000000002',
            tx_hash: '0xdeadbeef00000000000000000000000000000000000000000000000000000002',
            direction: 'outflow',
            amount: 250000,
          },
        ]}
      />,
    )

    expect(screen.getByRole('heading', { name: 'Recent Bridge Mints & Burns' })).toBeInTheDocument()
    expect(screen.getByText('Mint')).toBeInTheDocument()
    expect(screen.getByText('Burn')).toBeInTheDocument()
    expect(screen.getByText('$1.25M')).toBeInTheDocument()
    expect(screen.getByText('$250.00K')).toBeInTheDocument()
    expect(screen.getAllByText('Stargate')).toHaveLength(2)
    expect(screen.getAllByText('USDC.e')).toHaveLength(2)
  })

  it('renders an empty-state message when no events exist', () => {
    render(<BridgeFlowTable events={[]} />)

    expect(screen.getByText('No bridge events found for the selected period.')).toBeInTheDocument()
  })
})
