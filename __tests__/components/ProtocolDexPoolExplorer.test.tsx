import { render, screen } from '@testing-library/react'
import { ProtocolDexPoolExplorer } from '@/components/ProtocolDexPoolExplorer'

describe('ProtocolDexPoolExplorer', () => {
  it('shows volume and average trade size for non-whitelisted pools when analytics data exists', () => {
    render(
      <ProtocolDexPoolExplorer
        pools={[
          {
            poolId: 17,
            token: '0xabcdef1234567890abcdef1234567890abcdef12',
            symbol: '0xabcd…ef12',
            swaps_30d: 4,
            volume_usd: 1200,
            avg_trade: 300,
            whitelisted: false,
            dau_1d: 2,
            dau_7d: 5,
            dau_30d: 9,
          },
        ]}
      />,
    )

    expect(screen.getByText('$1.20K')).toBeInTheDocument()
    expect(screen.getByText('$300.00')).toBeInTheDocument()
  })
})
