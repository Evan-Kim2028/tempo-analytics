export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { getPaymentsPageData } = await import('@/lib/payments')
    const { getCommunityDexTVL, getProtocolDexTVL } = await import('@/lib/defi')
    const {
      getFeeTokenAllDailyStats, getProtocolDexDailyStats, getProtocolDexTokenDailyStats,
      getDexDailyVolumeUSD, getTopPools, getProtocolDexPools,
      getTopNFTCollections, getNFTMinterConcentration, getTopNFTMinters,
    } = await import('@/lib/analytics')

    Promise.allSettled([
      getPaymentsPageData(),
      getCommunityDexTVL(),
      getProtocolDexTVL(),
      getFeeTokenAllDailyStats(30),
      getProtocolDexDailyStats(30),
      getProtocolDexTokenDailyStats(30),
      getDexDailyVolumeUSD(30),
      getTopPools(10),
      getProtocolDexPools(30),
      getTopNFTCollections(20),
      getNFTMinterConcentration(),
      getTopNFTMinters(50),
    ]).then(results => {
      const ok = results.filter(r => r.status === 'fulfilled').length
      console.log(`Cache pre-warm: ${ok}/${results.length} succeeded`)
    })
  }
}
