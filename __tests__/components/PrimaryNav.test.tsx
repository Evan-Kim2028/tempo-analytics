import { render, screen } from '@testing-library/react'
import { PrimaryNav } from '@/components/nav/PrimaryNav'

describe('PrimaryNav', () => {
  it('renders the primary explorer tabs without Blocks', () => {
    render(<PrimaryNav />)

    expect(screen.getByRole('link', { name: 'Transactions' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Stablecoins' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'DEX' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Bridges' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'NFTs' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Blocks' })).not.toBeInTheDocument()
  })

  it('renders the payments tab in primary navigation', () => {
    render(<PrimaryNav />)
    expect(screen.getByRole('link', { name: 'Payments' })).toHaveAttribute('href', '/payments')
  })
})
