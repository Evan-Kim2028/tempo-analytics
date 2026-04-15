import { spawn } from 'child_process'
import { fileURLToPath } from 'url'
import path from 'path'

import standaloneModule from './prepare-standalone.js'

const { resolveManagedStartSpec } = standaloneModule

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const spec = await resolveManagedStartSpec(rootDir, {
  nodeExecutable: process.execPath,
  port: process.env.PORT ?? '3001',
})

const child = spawn(spec.command, spec.args, {
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
