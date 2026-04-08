import type { Metadata } from 'next'
import './globals.css'
import { SearchBar } from '@/components/SearchBar'

export const metadata: Metadata = {
  title: 'Tempo Analytics',
  description: 'Analytics-focused explorer for the Tempo blockchain',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-tempo-dark text-gray-200">
        <nav className="border-b border-tempo-border px-6 py-4 flex items-center gap-6">
          <a href="/" className="text-white font-semibold text-lg tracking-tight shrink-0">
            tempo<span className="text-tempo-blue">analytics</span>
          </a>
          <a href="/blocks" className="text-tempo-muted hover:text-white text-sm transition-colors shrink-0">Blocks</a>
          <a href="/analytics" className="text-tempo-muted hover:text-white text-sm transition-colors shrink-0">Overview</a>
          <a href="/stablecoins" className="text-tempo-muted hover:text-white text-sm transition-colors shrink-0">Stablecoins</a>
          <a href="/dex" className="text-tempo-muted hover:text-white text-sm transition-colors shrink-0">DEX</a>
          <a href="/bridges" className="text-tempo-muted hover:text-white text-sm transition-colors shrink-0">Bridges</a>
          <a href="/nfts" className="text-tempo-muted hover:text-white text-sm transition-colors shrink-0">NFTs</a>
          <SearchBar />
        </nav>
        <main className="px-6 py-8 max-w-6xl mx-auto">
          {children}
        </main>
      </body>
    </html>
  )
}
