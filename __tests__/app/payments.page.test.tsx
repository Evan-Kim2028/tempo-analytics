jest.mock('@/lib/payments', () => ({
  getPaymentsPageData: jest.fn(),
}))

jest.mock('recharts', () => {
  const React = require('react')
  const Container = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>
  const Series = ({ name }: { name?: string }) => <div>{name}</div>
  return {
    ResponsiveContainer: Container,
    AreaChart: Container,
    BarChart: Container,
    LineChart: Container,
    CartesianGrid: () => null,
    XAxis: () => null,
    YAxis: () => null,
    Tooltip: () => null,
    Legend: () => null,
    Area: Series,
    Bar: Series,
    Line: Series,
  }
})

import { render, screen } from '@testing-library/react'
import PaymentsPage from '@/app/payments/page'
import { getPaymentsPageData } from '@/lib/payments'

const mockGetPaymentsPageData = getPaymentsPageData as jest.Mock

test('renders the payments page shell and major sections', async () => {
  mockGetPaymentsPageData.mockResolvedValue({
    summary: {
      successful_payments: 4,
      failed_attempts: 1,
      success_rate: 80,
      total_amount: 8.25,
      unique_senders: 2,
      unique_recipients: 3,
    },
    daily: [
      {
        day: '2026-04-08',
        successful_payments: 4,
        failed_attempts: 1,
        total_amount: 8.25,
        unique_senders: 2,
        unique_recipients: 3,
        readable_memos: 2,
        opaque_memos: 2,
        empty_memos: 0,
      },
    ],
    recent: [],
    dailyByToken: { days: [], tokens: [] },
    topRecipientsByAmount: [],
    topRecipientsByCount: [],
    topSenders: [],
    micropaymentStats: {
      summary: {
        sub_cent_count: 0,
        sub_nickel_count: 0,
        sub_dime_count: 0,
        large_count: 0,
        micro_count: 0,
        micro_amount: 0,
        micro_share_pct: 0,
      },
      daily: [],
    },
  })

  render(await PaymentsPage())

  expect(screen.getByRole('heading', { name: 'Payments' })).toBeInTheDocument()
  expect(screen.getByText('TIP-20 transferWithMemo activity across verified stablecoins')).toBeInTheDocument()
  expect(screen.getByText('Updates every 15 min · Mainnet data')).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'Recent Payments' })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'Daily Payments Trend' })).toBeInTheDocument()
})
