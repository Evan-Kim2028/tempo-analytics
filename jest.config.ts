import type { Config } from 'jest'
import nextJest from 'next/jest.js'

const createJestConfig = nextJest({ dir: './' })

const config: Config = {
  coverageProvider: 'v8',
  testEnvironment: 'jest-environment-jsdom',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
  modulePathIgnorePatterns: ['<rootDir>/.next/', '<rootDir>/.worktrees/'],
  // mppx-solana ships TypeScript source only — let Next.js SWC transform it
  transformIgnorePatterns: ['/node_modules/(?!(mppx-solana)/)'],
}

export default createJestConfig(config)
