import { spawn } from 'child_process'
import { fileURLToPath } from 'url'
import path from 'path'

import standaloneModule from './prepare-standalone.js'

const { prepareStandaloneAssets } = standaloneModule

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

await prepareStandaloneAssets(rootDir)

const envFile = path.join(rootDir, '.env.local')
const child = spawn(process.execPath, ['--env-file', envFile, path.join(rootDir, '.next', 'standalone', 'server.js')], {
  cwd: rootDir,
  env: process.env,
  stdio: 'inherit',
})

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }

  process.exit(code ?? 0)
})
