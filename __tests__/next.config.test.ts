import nextConfig from '../next.config'

describe('next config', () => {
  it('marks mppx and @solana/mpp as server-external packages', () => {
    expect(nextConfig.serverExternalPackages).toContain('mppx')
    expect(nextConfig.serverExternalPackages).toContain('@solana/mpp')
  })
})
