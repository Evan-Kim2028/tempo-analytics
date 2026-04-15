import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'

import {
  prepareStandaloneAssets,
  resolveManagedStartSpec,
  resolveStandaloneEnvFile,
  resolveStandaloneServerEntry,
} from '../../scripts/prepare-standalone'

test('prepareStandaloneAssets copies runtime assets into the standalone directory', async () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'tempo-analytics-standalone-'))

  mkdirSync(join(rootDir, '.next', 'static', 'css'), { recursive: true })
  mkdirSync(join(rootDir, '.next', 'standalone', '.next'), { recursive: true })
  mkdirSync(join(rootDir, 'public'), { recursive: true })

  writeFileSync(join(rootDir, '.next', 'static', 'css', 'app.css'), 'body{display:grid}')
  writeFileSync(join(rootDir, 'public', 'logo.svg'), '<svg />')

  await prepareStandaloneAssets(rootDir)

  expect(
    readFileSync(join(rootDir, '.next', 'standalone', '.next', 'static', 'css', 'app.css'), 'utf8')
  ).toBe('body{display:grid}')
  expect(readFileSync(join(rootDir, '.next', 'standalone', 'public', 'logo.svg'), 'utf8')).toBe('<svg />')

  await rm(rootDir, { recursive: true, force: true })
})

test('resolveStandaloneEnvFile prefers .env.local and falls back to .env', async () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'tempo-analytics-standalone-env-'))

  writeFileSync(join(rootDir, '.env'), 'FOO=from-env\n')
  await expect(resolveStandaloneEnvFile(rootDir)).resolves.toBe(join(rootDir, '.env'))

  writeFileSync(join(rootDir, '.env.local'), 'FOO=from-env-local\n')
  await expect(resolveStandaloneEnvFile(rootDir)).resolves.toBe(join(rootDir, '.env.local'))

  await rm(rootDir, { recursive: true, force: true })
})

test('resolveStandaloneEnvFile errors when no env file exists', async () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'tempo-analytics-standalone-missing-env-'))

  await expect(resolveStandaloneEnvFile(rootDir)).rejects.toThrow(
    `No standalone env file found in ${rootDir}; expected one of: .env.local, .env`
  )

  await rm(rootDir, { recursive: true, force: true })
})

test('resolveStandaloneServerEntry returns the built server path', async () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'tempo-analytics-standalone-server-'))

  mkdirSync(join(rootDir, '.next', 'standalone'), { recursive: true })
  writeFileSync(join(rootDir, '.next', 'standalone', 'server.js'), 'console.log("ok")')

  await expect(resolveStandaloneServerEntry(rootDir)).resolves.toBe(
    join(rootDir, '.next', 'standalone', 'server.js')
  )

  await rm(rootDir, { recursive: true, force: true })
})

test('resolveStandaloneServerEntry errors when the standalone build is missing', async () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'tempo-analytics-standalone-missing-server-'))

  await expect(resolveStandaloneServerEntry(rootDir)).rejects.toThrow(
    `Standalone server build is missing at ${join(rootDir, '.next', 'standalone', 'server.js')}; run \`npm run build\` first`
  )

  await rm(rootDir, { recursive: true, force: true })
})


test('resolveManagedStartSpec prefers standalone when build output exists', async () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'tempo-analytics-managed-standalone-'))

  mkdirSync(join(rootDir, '.next', 'standalone'), { recursive: true })
  writeFileSync(join(rootDir, '.next', 'standalone', 'server.js'), 'console.log("ok")')
  writeFileSync(join(rootDir, '.env'), 'FOO=bar\n')

  const spec = await resolveManagedStartSpec(rootDir, { nodeExecutable: '/usr/bin/node', port: '3001' })

  expect(spec).toEqual({
    mode: 'standalone',
    command: '/usr/bin/node',
    args: ['--env-file', join(rootDir, '.env'), join(rootDir, '.next', 'standalone', 'server.js')],
  })

  await rm(rootDir, { recursive: true, force: true })
})

test('resolveManagedStartSpec falls back to next dev when standalone build is missing', async () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'tempo-analytics-managed-dev-'))

  mkdirSync(join(rootDir, 'node_modules', 'next', 'dist', 'bin'), { recursive: true })
  writeFileSync(join(rootDir, 'node_modules', 'next', 'dist', 'bin', 'next'), '#!/usr/bin/env node\n')

  const spec = await resolveManagedStartSpec(rootDir, { nodeExecutable: '/usr/bin/node', port: '3001' })

  expect(spec).toEqual({
    mode: 'dev',
    command: '/usr/bin/node',
    args: [
      join(rootDir, 'node_modules', 'next', 'dist', 'bin', 'next'),
      'dev',
      '--hostname',
      '0.0.0.0',
      '--port',
      '3001',
    ],
  })

  await rm(rootDir, { recursive: true, force: true })
})
