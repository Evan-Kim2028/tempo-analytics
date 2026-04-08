const primaryTabs = [
  { href: '/analytics', label: 'Analytics' },
  { href: '/stablecoins', label: 'Stablecoins' },
  { href: '/dex', label: 'DEX' },
  { href: '/nfts', label: 'NFTs' },
]

export function PrimaryNav() {
  return (
    <>
      {primaryTabs.map((tab) => (
        <a
          key={tab.href}
          href={tab.href}
          className="text-tempo-muted hover:text-white text-sm transition-colors shrink-0"
        >
          {tab.label}
        </a>
      ))}
    </>
  )
}
