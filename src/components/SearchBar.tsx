'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

export function SearchBar() {
  const [query, setQuery] = useState('')
  const router = useRouter()

  function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    const q = query.trim()
    if (!q) return

    if (/^0x[0-9a-fA-F]{64}$/.test(q)) {
      router.push(`/tx/${q}`)
    } else if (/^0x[0-9a-fA-F]{40}$/i.test(q)) {
      router.push(`/address/${q}`)
    } else if (/^\d+$/.test(q)) {
      router.push(`/block/${q}`)
    }
  }

  return (
    <form onSubmit={handleSearch} className="flex-1 max-w-xl">
      <input
        type="text"
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder="Search by tx hash, address, or block number..."
        className="w-full bg-tempo-card border border-tempo-border rounded px-3 py-1.5 text-sm text-white placeholder:text-tempo-muted focus:outline-none focus:border-tempo-blue transition-colors"
        aria-label="Search"
      />
    </form>
  )
}
