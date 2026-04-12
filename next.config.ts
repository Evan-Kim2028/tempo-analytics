import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  output: 'standalone',
  serverExternalPackages: ['pino', 'pino-pretty', 'viem', 'mppx', '@solana/mpp'],
}

export default nextConfig
