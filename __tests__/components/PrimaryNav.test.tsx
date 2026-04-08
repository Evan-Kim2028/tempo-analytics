import { render, screen } from '@testing-library/react'
import { PrimaryNav } from '@/components/nav/PrimaryNav'

describe('PrimaryNav', () => {
  it('renders the primary explorer tabs without Blocks', () => {
    render(<PrimaryNav />)

    expect(screen.getByRole('link', { name: 'Analytics' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Stablecoins' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'DEX' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'NFTs' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Blocks' })).not.toBeInTheDocument()
  })
})
