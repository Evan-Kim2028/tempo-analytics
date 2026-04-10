import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Challenge, Credential } from 'mppx'
import { ExportButton } from '@/components/ExportButton'

jest.mock('mppx', () => ({
  Challenge: {
    fromResponseList: jest.fn(),
  },
  Credential: {
    from: jest.fn(),
    serialize: jest.fn(),
  },
}))

const mockFromResponseList = Challenge.fromResponseList as jest.Mock
const mockCredentialFrom = Credential.from as jest.Mock
const mockCredentialSerialize = Credential.serialize as jest.Mock

const makeChallenges = () => [
  {
    request: {
      amount: '1000000',
      currency: '0xAABBCCDDEEFF0011AABBCCDDEEFFaabbccddeeff',
      recipient: '0x1234567890abcdef1234567890abcdef12345678',
      decimals: 6,
    },
  },
  {
    request: {
      amount: '2000000',
      currency: '0x1122334455667788990011223344556677889900',
      recipient: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
      decimals: 6,
    },
  },
]

beforeEach(() => {
  jest.resetAllMocks()
  global.fetch = jest.fn()
})

describe('ExportButton', () => {
  it('renders export button with label', () => {
    render(<ExportButton queryKey="test-query" label="Download Report" />)
    expect(screen.getByRole('button', { name: 'Download Report' })).toBeInTheDocument()
  })

  it('renders with default label', () => {
    render(<ExportButton queryKey="test-query" />)
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeInTheDocument()
  })

  it('shows payment form on 402', async () => {
    const challenges = makeChallenges()
    mockFromResponseList.mockReturnValue(challenges)
    ;(global.fetch as jest.Mock).mockResolvedValue({
      status: 402,
      ok: false,
    })

    const user = userEvent.setup()
    render(<ExportButton queryKey="test-query" />)

    await user.click(screen.getByRole('button', { name: 'Export CSV' }))

    await waitFor(() => {
      expect(screen.getByText('Pay to Export')).toBeInTheDocument()
    })

    expect(mockFromResponseList).toHaveBeenCalled()
    // Should display formatted amount from first challenge
    expect(screen.getByText(/1\.00/)).toBeInTheDocument()
    // Should show recipient
    expect(screen.getByText('0x1234567890abcdef1234567890abcdef12345678')).toBeInTheDocument()
    // Should show currency selector buttons when multiple challenges exist
    expect(screen.getAllByRole('button').length).toBeGreaterThanOrEqual(2)
  })

  it('submits credential on verify', async () => {
    const challenges = makeChallenges()
    mockFromResponseList.mockReturnValue(challenges)

    const mockCredential = { type: 'payment' }
    mockCredentialFrom.mockReturnValue(mockCredential)
    mockCredentialSerialize.mockReturnValue('Payment dGVzdA==')

    const validTxHash = '0x' + 'ab'.repeat(32)

    ;(global.fetch as jest.Mock)
      .mockResolvedValueOnce({ status: 402, ok: false }) // initial 402
      .mockResolvedValueOnce({
        status: 200,
        ok: true,
        blob: jest.fn().mockResolvedValue(new Blob(['col1,col2\na,b'])),
      })

    const user = userEvent.setup()
    render(<ExportButton queryKey="test-query" />)

    await user.click(screen.getByRole('button', { name: 'Export CSV' }))
    await waitFor(() => {
      expect(screen.getByText('Pay to Export')).toBeInTheDocument()
    })

    const input = screen.getByLabelText('Transaction hash')
    await user.type(input, validTxHash)
    await user.click(screen.getByRole('button', { name: 'Verify & Download' }))

    await waitFor(() => {
      expect(mockCredentialFrom).toHaveBeenCalledWith({
        challenge: challenges[0],
        payload: { hash: validTxHash, type: 'hash' },
      })
    })

    expect(mockCredentialSerialize).toHaveBeenCalledWith(mockCredential)
    expect(global.fetch).toHaveBeenLastCalledWith(
      '/api/export',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Payment dGVzdA==',
        }),
      })
    )
  })

  it('shows error for invalid tx hash format', async () => {
    const challenges = makeChallenges()
    mockFromResponseList.mockReturnValue(challenges)
    ;(global.fetch as jest.Mock).mockResolvedValue({ status: 402, ok: false })

    const user = userEvent.setup()
    render(<ExportButton queryKey="test-query" />)

    await user.click(screen.getByRole('button', { name: 'Export CSV' }))
    await waitFor(() => {
      expect(screen.getByText('Pay to Export')).toBeInTheDocument()
    })

    const input = screen.getByLabelText('Transaction hash')
    await user.type(input, 'not-a-valid-hash')
    await user.click(screen.getByRole('button', { name: 'Verify & Download' }))

    expect(screen.getByText(/valid transaction hash/i)).toBeInTheDocument()
  })

  it('downloads CSV on 200 response', async () => {
    const challenges = makeChallenges()
    mockFromResponseList.mockReturnValue(challenges)

    const mockCredential = { type: 'payment' }
    mockCredentialFrom.mockReturnValue(mockCredential)
    mockCredentialSerialize.mockReturnValue('Payment dGVzdA==')

    const csvContent = 'col1,col2\na,b'
    const validTxHash = '0x' + 'ab'.repeat(32)

    const mockCreateObjectURL = jest.fn().mockReturnValue('blob:test')
    const mockRevokeObjectURL = jest.fn()
    global.URL.createObjectURL = mockCreateObjectURL
    global.URL.revokeObjectURL = mockRevokeObjectURL

    const clickSpy = jest.fn()
    const origCreateElement = document.createElement.bind(document)
    jest.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag === 'a') {
        return { click: clickSpy, href: '', download: '' } as unknown as HTMLElement
      }
      return origCreateElement(tag)
    })

    ;(global.fetch as jest.Mock)
      .mockResolvedValueOnce({ status: 402, ok: false })
      .mockResolvedValueOnce({
        status: 200,
        ok: true,
        blob: jest.fn().mockResolvedValue(new Blob([csvContent])),
      })

    const user = userEvent.setup()
    render(<ExportButton queryKey="test-query" />)

    await user.click(screen.getByRole('button', { name: 'Export CSV' }))
    await waitFor(() => {
      expect(screen.getByText('Pay to Export')).toBeInTheDocument()
    })

    const input = screen.getByLabelText('Transaction hash')
    await user.type(input, validTxHash)
    await user.click(screen.getByRole('button', { name: 'Verify & Download' }))

    await waitFor(() => {
      expect(clickSpy).toHaveBeenCalled()
    })

    expect(mockCreateObjectURL).toHaveBeenCalled()
    expect(mockRevokeObjectURL).toHaveBeenCalledWith('blob:test')

    jest.restoreAllMocks()
  })
})
