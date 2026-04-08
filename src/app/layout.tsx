import type { Metadata } from 'next'
import './globals.css'
import { SearchBar } from '@/components/SearchBar'
import { PrimaryNav } from '@/components/nav/PrimaryNav'
import { WalletProviders } from '@/providers/WalletProviders'

export const metadata: Metadata = {
  title: 'Tempo Explorer',
  description: 'Analytics-focused explorer for the Tempo blockchain',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-tempo-dark text-gray-200">
        <WalletProviders>
          <nav className="border-b border-tempo-border px-6 py-4 flex items-center gap-6">
            <a href="/" className="text-white font-semibold text-lg tracking-tight shrink-0">
              tempo<span className="text-tempo-blue">explorer</span>
            </a>
            <PrimaryNav />
            <SearchBar />
          </nav>
          <main className="px-6 py-8 max-w-6xl mx-auto">
            {children}
          </main>
        </WalletProviders>
      </body>
    </html>
  )
}
