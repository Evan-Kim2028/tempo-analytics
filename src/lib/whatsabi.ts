import { decodeFunctionData } from 'viem'
import { getCached, setCached } from '@/lib/cache'
import { lookupSelector, classifyTx } from '@/lib/signatures'
import { parseInscriptionInput } from '@/lib/inscriptions'
import { publicClient } from '@/lib/chain'

export interface DecodedCalldata {
  functionName: string
  args?: string[]
}

export async function decodeCalldata(
  to: string | null,
  input: string,
): Promise<DecodedCalldata | null> {
  if (!input || input === '0x') return null

  const category = classifyTx(to, input)

  // Protocol tx — label from registry, no RPC
  if (category === 'protocol') {
    const selector = input.slice(0, 10).toLowerCase()
    return { functionName: lookupSelector(selector) ?? `[Tempo] protocol (${selector})` }
  }

  // TIP-20 inscription — decode JSON, no RPC
  if (category === 'inscription') {
    const parsed = parseInscriptionInput(input)
    if (parsed) {
      const label = parsed.amt
        ? `[TIP-20] ${parsed.op} ${parsed.tick} × ${parsed.amt}`
        : `[TIP-20] ${parsed.op} ${parsed.tick}`
      return { functionName: label }
    }
    return { functionName: '[TIP-20] inscription' }
  }

  // Contract deploy
  if (category === 'deploy') return { functionName: 'Contract Deploy' }

  // User tx: check static registry first (no RPC)
  if (input.length >= 10) {
    const selector = input.slice(0, 10).toLowerCase()
    const knownName = lookupSelector(selector)
    if (knownName) return { functionName: knownName }

    // Unknown selector: try WhatsABI (with Redis cache per contract)
    if (to) {
      return decodeWithWhatsABI(to as `0x${string}`, input as `0x${string}`)
    }
  }

  return null
}

async function decodeWithWhatsABI(
  address: `0x${string}`,
  input: `0x${string}`,
): Promise<DecodedCalldata | null> {
  const cacheKey = `whatsabi:abi:${address.toLowerCase()}`

  try {
    // Check cache first (ABI is stable per contract)
    let abi = await getCached<unknown[]>(cacheKey)

    if (!abi) {
      // Fetch bytecode via viem, infer ABI with whatsabi
      const { whatsabi } = await import('@shazow/whatsabi')
      const bytecode = await publicClient.getBytecode({ address })
      if (!bytecode || bytecode === '0x') return null

      const rawAbi = whatsabi.abiFromBytecode(bytecode)

      // Optionally resolve function names from 4byte.directory
      try {
        const loader = new whatsabi.loaders.MultiSignatureLookup([
          new whatsabi.loaders.FourByteSignatureLookup(),
          new whatsabi.loaders.OpenChainSignatureLookup(),
        ])
        const resolved: unknown[] = []
        for (const item of rawAbi) {
          const entry = item as { type?: string; selector?: string; name?: string }
          if (entry.type === 'function' && entry.selector && !entry.name) {
            try {
              const names = await loader.loadFunctions(entry.selector)
              if (names && names.length > 0) {
                resolved.push({ ...entry, name: names[0] })
                continue
              }
            } catch {
              // skip
            }
          }
          resolved.push(item)
        }
        abi = resolved
      } catch {
        abi = rawAbi as unknown[]
      }

      await setCached(cacheKey, abi, 3600) // 1h — ABI doesn't change
    }

    const { functionName, args } = decodeFunctionData({
      abi: abi as Parameters<typeof decodeFunctionData>[0]['abi'],
      data: input,
    })

    return {
      functionName: String(functionName),
      args: args ? (args as unknown[]).map(a => String(a)) : undefined,
    }
  } catch {
    return null // never throw — decoding is best-effort
  }
}
