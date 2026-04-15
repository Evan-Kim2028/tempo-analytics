import type { Config } from 'jest'
import nextJest from 'next/jest.js'

const createJestConfig = nextJest({ dir: './' })

const config: Config = {
  coverageProvider: 'v8',
  testEnvironment: 'jest-environment-jsdom',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    // uuid ships an ESM browser build as its package "default" export; map it to
    // the CJS build so Jest (which runs in Node/jsdom, not a real browser) can
    // parse it without ESM transform issues.
    '^uuid$': '<rootDir>/node_modules/uuid/dist/index.js',
  },
  modulePathIgnorePatterns: ['<rootDir>/.next/', '<rootDir>/.worktrees/'],
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/.next/', '<rootDir>/__tests__/helpers/'],
  // uuid ships ESM browser build as its default export — must be transformed too
  transformIgnorePatterns: ['/node_modules/(?!(uuid)/)'],
}

export default createJestConfig(config)
