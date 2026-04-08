import { render, screen } from '@testing-library/react'
import { PaymentsSummary } from '@/components/payments/PaymentsSummary'

test('renders the six top-level payments cards', () => {
  render(
    <PaymentsSummary
      summary={{
        successful_payments: 13115,
        failed_attempts: 1129,
        success_rate: 92.07,
        total_amount: 60881.61,
        unique_senders: 124,
        unique_recipients: 311,
      }}
    />,
  )

  expect(screen.getByText('Successful Payments')).toBeInTheDocument()
  expect(screen.getByText('13.1K')).toBeInTheDocument()
  expect(screen.getByText('Failed Attempts')).toBeInTheDocument()
  expect(screen.getByText('1.1K')).toBeInTheDocument()
  expect(screen.getByText('Success Rate')).toBeInTheDocument()
  expect(screen.getByText('92.07%')).toBeInTheDocument()
  expect(screen.getByText('Total Payment Amount')).toBeInTheDocument()
  expect(screen.getByText('$60.88K')).toBeInTheDocument()
})
