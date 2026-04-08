import { render, screen } from '@testing-library/react'

jest.mock('recharts', () => {
  const React = require('react')
  const Container = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>
  const Series = ({ name }: { name?: string }) => <div>{name}</div>
  return {
    ResponsiveContainer: Container,
    AreaChart: Container,
    LineChart: Container,
    CartesianGrid: () => null,
    XAxis: () => null,
    YAxis: () => null,
    Tooltip: () => null,
    Legend: () => null,
    Area: Series,
    Line: Series,
  }
})

import { PaymentsNarrative } from '@/components/payments/PaymentsNarrative'

test('renders the payments charts and concentration sections', () => {
  render(
    <PaymentsNarrative
      daily={[
        {
          day: '2026-04-08',
          successful_payments: 14,
          failed_attempts: 3,
          total_amount: 42.75,
          unique_senders: 9,
          unique_recipients: 8,
          readable_memos: 5,
          opaque_memos: 9,
          empty_memos: 0,
        },
      ]}
      topRecipientsByAmount={[
        { address: '0x03acdc3e7bb74f1c5d29b1118f920e1b5fc62fd7', payment_count: 11, total_amount: 43044.38 },
      ]}
      topRecipientsByCount={[
        { address: '0x2b38a4bb7ce552e82d5664224bacc1c3daf1ab7d', payment_count: 4132, total_amount: 3413 },
      ]}
      topSenders={[
        { address: '0x7254e7e9142dac7d5da2a9b3058aa63a0720fcc3', payment_count: 3353, total_amount: 12550 },
      ]}
    />,
  )

  expect(screen.getByRole('heading', { name: 'Daily Payments Trend' })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'Daily Payment Amount' })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'Memo Pattern Mix' })).toBeInTheDocument()
  expect(screen.getByText('Top Recipients By Amount')).toBeInTheDocument()
  expect(screen.getByText('0x03acdc3e7bb74f1c5d29b1118f920e1b5fc62fd7')).toBeInTheDocument()
})
