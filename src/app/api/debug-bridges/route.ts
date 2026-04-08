import { getDailyBridgeProviderFlows } from '@/lib/bridges'

export async function GET() {
  const flows = await getDailyBridgeProviderFlows(30)
  return Response.json({ count: flows.length, sample: flows.slice(0, 5) })
}
