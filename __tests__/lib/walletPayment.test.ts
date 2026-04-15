/**
 * @jest-environment node
 */

jest.mock('@solana/mpp/client', () => ({
  Mppx: {
    create: jest.fn(() => ({
      fetch: jest.fn().mockResolvedValue(new Response('csv-data', { status: 200 })),
    })),
  },
  solana: {
    charge: jest.fn(() => ({})),
  },
}))

jest.mock('mppx/client', () => ({
  Mppx: {
    create: jest.fn(() => ({
      fetch: jest.fn().mockResolvedValue(new Response('csv-data', { status: 200 })),
    })),
  },
  tempo: {
    charge: jest.fn(() => ({})),
  },
}))

import { createSolanaMppxClient, createTempoMppxClient } from '@/lib/walletPayment'

// ── createSolanaMppxClient ──────────────────────────────────────────────────

test('createSolanaMppxClient returns an mppx client', () => {
  const mockSigner = { address: 'test', signTransactions: jest.fn() }
  const client = createSolanaMppxClient(mockSigner as never)
  expect(client).toBeDefined()
  expect(client.fetch).toBeDefined()
})

// ── createTempoMppxClient ───────────────────────────────────────────────────

test('createTempoMppxClient returns an mppx client', () => {
  const client = createTempoMppxClient()
  expect(client).toBeDefined()
  expect(client.fetch).toBeDefined()
})
