'use client'

import { SelectedWalletAccountContextProvider } from '@solana/react'
import type { UiWallet } from '@wallet-standard/react'

const STORAGE_KEY = 'tempo-analytics:selected-wallet'

function filterWallets(wallet: UiWallet): boolean {
  return wallet.chains.some((chain) =>
    chain === 'solana:mainnet-beta' || chain === 'solana:mainnet'
  )
}

const stateSync = {
  getSelectedWallet(): string | null {
    if (typeof window === 'undefined') return null
    return localStorage.getItem(STORAGE_KEY)
  },
  storeSelectedWallet(walletName: string): void {
    localStorage.setItem(STORAGE_KEY, walletName)
  },
  deleteSelectedWallet(): void {
    localStorage.removeItem(STORAGE_KEY)
  },
}

export function WalletProviders({ children }: { children: React.ReactNode }) {
  return (
    <SelectedWalletAccountContextProvider
      filterWallets={filterWallets}
      stateSync={stateSync}
    >
      {children}
    </SelectedWalletAccountContextProvider>
  )
}
