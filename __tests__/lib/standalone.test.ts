import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'

import { prepareStandaloneAssets } from '../../scripts/prepare-standalone'

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
