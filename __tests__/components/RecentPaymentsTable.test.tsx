import { render, screen } from '@testing-library/react'
import { RecentPaymentsTable } from '@/components/payments/RecentPaymentsTable'

test('renders successful and failed rows in one table', () => {
  render(
    <RecentPaymentsTable
      rows={[
        {
          timestamp: '2026-04-08 12:00:00',
          day: '2026-04-08',
          tx_hash: '0xsuccess',
          sender: '0x1111111111111111111111111111111111111111',
          recipient: '0x2222222222222222222222222222222222222222',
          token: '0x20c0000000000000000000000000000000000000',
          token_label: 'pathUSD',
          amount: 1.25,
          status: 'success',
          memo_hex: '0x534f432d30307a66393162640000000000000000000000000000000000000000',
          memo_text: 'SOC-00zf91bd',
          memo_kind: 'readable',
          memo_family: 'SOC-*',
        },
        {
          timestamp: '2026-04-08 12:05:00',
          day: '2026-04-08',
          tx_hash: '0xfailed',
          sender: '0x3333333333333333333333333333333333333333',
          recipient: '0x4444444444444444444444444444444444444444',
          token: '0x20c0000000000000000000000000000000000000',
          token_label: 'pathUSD',
          amount: 0.99,
          status: 'failed',
          memo_hex: '0xff00aa0000000000000000000000000000000000000000000000000000000000',
          memo_text: null,
          memo_kind: 'opaque',
          memo_family: null,
        },
      ]}
    />,
  )

  expect(screen.getByRole('columnheader', { name: 'Status' })).toBeInTheDocument()
  expect(screen.getByText('success')).toBeInTheDocument()
  expect(screen.getByText('failed')).toBeInTheDocument()
  expect(screen.getByText('SOC-00zf91bd')).toBeInTheDocument()
  expect(screen.getByText('Opaque memo')).toBeInTheDocument()
})

test('renders the explicit empty state when no payment rows exist', () => {
  render(<RecentPaymentsTable rows={[]} />)
  expect(screen.getByText('No memo-bearing payments found for the selected period.')).toBeInTheDocument()
})
