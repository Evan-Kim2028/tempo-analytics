import { getCached, setCached } from '@/lib/cache'
import { queryTidx } from '@/lib/tidx'
import { BlocksTable } from '@/components/BlocksTable'

export const revalidate = 30

interface Block {
  num: number
  hash: string
  timestamp: string
  gas_used: number
  miner: string
}

async function getLatestBlocks(): Promise<Block[]> {
  const cached = await getCached<Block[]>('blocks:latest')
  if (cached) return cached

  const result = await queryTidx(`
    SELECT num, hash, timestamp, gas_used, miner
    FROM blocks
    ORDER BY num DESC
    LIMIT 50
  `)

  const blocks = result.rows as unknown as Block[]
  await setCached('blocks:latest', blocks, 30)
  return blocks
}

export default async function BlocksPage() {
  const blocks = await getLatestBlocks()

  return (
    <div>
      <h1 className="text-2xl font-semibold text-white mb-6">Latest Blocks</h1>
      <BlocksTable blocks={blocks} />
    </div>
  )
}
