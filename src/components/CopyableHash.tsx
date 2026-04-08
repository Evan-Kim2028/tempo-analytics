'use client'
import { useState } from 'react'

export function CopyableHash({
  hash,
  display,
  className = '',
}: {
  hash: string
  display?: string
  className?: string
}) {
  const [copied, setCopied] = useState(false)

  const label = display ?? `${hash.slice(0, 8)}…${hash.slice(-6)}`

  async function handleClick() {
    try {
      await navigator.clipboard.writeText(hash)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // clipboard unavailable — no-op
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      title={copied ? 'Copied!' : hash}
      className={`font-mono text-xs text-tempo-blue hover:text-white cursor-pointer transition-colors ${className}`}
    >
      {copied ? 'Copied!' : label}
    </button>
  )
}
