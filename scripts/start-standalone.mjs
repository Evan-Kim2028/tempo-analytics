import { spawn } from 'child_process'
import { fileURLToPath } from 'url'
import path from 'path'

import standaloneModule from './prepare-standalone.js'

const { prepareStandaloneAssets } = standaloneModule

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

await prepareStandaloneAssets(rootDir)

const envFile = await standaloneModule.resolveStandaloneEnvFile(rootDir)
const serverEntry = await standaloneModule.resolveStandaloneServerEntry(rootDir)
const child = spawn(process.execPath, ['--env-file', envFile, serverEntry], {
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
