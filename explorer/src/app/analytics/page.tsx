import { AnalyticsCard } from '@/components/AnalyticsCard'

export const revalidate = 3600

const ANALYTICS_VIEWS = [
  {
    title: 'Account Types',
    description: "Distribution of Secp256k1 (EOA), P256, and WebAuthn/passkey signature types. Tempo's native account abstraction in action.",
    slug: 'account-types',
    available: false,
    tags: ['account abstraction', 'passkeys'],
  },
  {
    title: 'Batch Calls',
    description: "What percentage of transactions use Tempo's native calls[] batching? What are the most common call depths and patterns?",
    slug: 'batch-calls',
    available: false,
    tags: ['native AA', 'UX'],
  },
  {
    title: 'Fee Sponsorship',
    description: 'When fee_payer ≠ sender, a dApp is subsidizing gas for the user. Track who sponsors fees and how adoption is growing.',
    slug: 'fee-sponsorship',
    available: false,
    tags: ['gasless', 'sponsorship'],
  },
  {
    title: 'Fee Tokens',
    description: 'Which stablecoins are being used to pay transaction fees? USDC, USDT, USDB, and others — Tempo lets you pay in any.',
    slug: 'fee-tokens',
    available: false,
    tags: ['stablecoins', 'fees'],
  },
  {
    title: 'Mainnet Launch',
    description: 'Week-by-week activity before and after the March 18, 2026 mainnet launch. Who were the first users?',
    slug: 'mainnet-launch',
    available: false,
    tags: ['growth', 'history'],
  },
]

export default function AnalyticsPage() {
  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-white">Analytics</h1>
        <p className="text-tempo-muted text-sm mt-1">
          Opinionated views into Tempo-specific on-chain behavior.
          Data is backfilling — charts will go live once the full history is indexed.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {ANALYTICS_VIEWS.map(view => (
          <AnalyticsCard key={view.slug} {...view} />
        ))}
      </div>

      <p className="text-tempo-muted text-xs mt-8 text-center">
        More views added as the data tells interesting stories.
      </p>
    </div>
  )
}
