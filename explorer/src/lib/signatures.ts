export const KNOWN_SELECTORS: Record<string, string> = {
  // ERC-20 / TIP-20
  '0xa9059cbb': 'transfer(address,uint256)',
  '0x095ea7b3': 'approve(address,uint256)',
  '0x23b872dd': 'transferFrom(address,address,uint256)',
  '0xd0def521': 'mint(address,uint256)',
  '0x40c10f19': 'mint(address,uint256)',
  '0x42966c68': 'burn(uint256)',
  '0x70a08231': 'balanceOf(address)',
  '0x18160ddd': 'totalSupply()',
  '0xdd62ed3e': 'allowance(address,address)',
  // Uniswap V2
  '0x38ed1739': 'swapExactTokensForTokens(uint256,uint256,address[],address,uint256)',
  '0x8803dbee': 'swapTokensForExactTokens(uint256,uint256,address[],address,uint256)',
  '0xe8e33700': 'addLiquidity(address,address,uint256,uint256,uint256,uint256,address,uint256)',
  '0xbaa2abde': 'removeLiquidity(address,address,uint256,uint256,uint256,address,uint256)',
  '0x0902f1ac': 'getReserves()',
  // Tempo protocol (address 0x0000, sequential block args)
  '0xc0000000': '[Tempo] protocol block record',
  '0xf901ecf8': '[Tempo] protocol operation A',
  '0xf903d8f8': '[Tempo] protocol operation B',
  '0xf904cef8': '[Tempo] protocol operation C',
  '0xf90453f8': '[Tempo] protocol operation D',
  '0xf90549f8': '[Tempo] protocol operation E',
  '0xf902e2f8': '[Tempo] protocol operation F',
  '0xf90171f8': '[Tempo] protocol operation G',
  '0xf90267f8': '[Tempo] protocol operation H',
  // Misc
  '0x3161b7f6': 'unknown()',
  '0x95777d59': 'unknown()',
  '0x26092b83': 'unknown()',
}

export const KNOWN_EVENTS: Record<string, string> = {
  // ERC-20 / TIP-20
  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef':
    'Transfer(address,address,uint256)',
  '0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925':
    'Approval(address,address,uint256)',
  '0x0f6798a560793a54c3bcfe86a93cde1e73087d944c0ea20544137d4121396885':
    'Mint(address,uint256)',
  // Uniswap V2
  '0x1c411e9a96e071241c2f21f7726b17ae89e3cab4c78be50e062b03a9fffbbad1':
    'Sync(uint112,uint112)',
  '0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822':
    'Swap(address,uint256,uint256,uint256,uint256,address)',
  '0x4c209b5fc8ad50758f13e2e1088ba56a560dff690a1c6fef26394f4c03821c4f':
    'Mint(address,uint256,uint256)',
  '0xdccd412f0b1252819cb1fd330b93224ca42612892bb3f4cf2e500ce3b2e59496':
    'Burn(address,uint256,uint256,address)',
}

export function lookupSelector(selector: string): string | undefined {
  return KNOWN_SELECTORS[selector.toLowerCase()]
}

export function lookupEvent(topic0: string): string | undefined {
  return KNOWN_EVENTS[topic0.toLowerCase()]
}

export type TxCategory = 'protocol' | 'inscription' | 'user' | 'deploy'

export function classifyTx(to: string | null, input: string): TxCategory {
  if (to === null) return 'deploy'
  if (to === '0x0000000000000000000000000000000000000000') {
    // Inscriptions are JSON calldata, even when sent to 0x0000
    if (input.toLowerCase().startsWith('0x7b')) return 'inscription'
    return 'protocol'
  }
  return 'user'
}
