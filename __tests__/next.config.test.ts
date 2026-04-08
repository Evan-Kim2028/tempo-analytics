import nextConfig from '../next.config'

describe('next config', () => {
  it('transpiles TypeScript-only runtime dependencies used by the export route', () => {
    expect(nextConfig.transpilePackages).toContain('mppx-solana')
  })
})
