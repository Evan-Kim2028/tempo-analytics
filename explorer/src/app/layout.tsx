import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Tempo Explorer',
  description: 'Analytics-focused explorer for the Tempo blockchain',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-tempo-dark text-gray-200">
        <nav className="border-b border-tempo-border px-6 py-4 flex items-center gap-8">
          <a href="/" className="text-white font-semibold text-lg tracking-tight">
            tempo<span className="text-tempo-blue">explorer</span>
          </a>
          <a href="/blocks" className="text-tempo-muted hover:text-white text-sm transition-colors">Blocks</a>
          <a href="/analytics" className="text-tempo-muted hover:text-white text-sm transition-colors">Analytics</a>
        </nav>
        <main className="px-6 py-8 max-w-6xl mx-auto">
          {children}
        </main>
      </body>
    </html>
  )
}
