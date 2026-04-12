const { cp, mkdir, stat } = require('fs/promises')
const { join } = require('path')

async function pathExists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function prepareStandaloneAssets(rootDir) {
  const standaloneDir = join(rootDir, '.next', 'standalone')
  const assetCopies = [
    {
      from: join(rootDir, '.next', 'static'),
      to: join(standaloneDir, '.next', 'static'),
    },
    {
      from: join(rootDir, 'public'),
      to: join(standaloneDir, 'public'),
    },
  ]

  for (const asset of assetCopies) {
    if (!(await pathExists(asset.from))) continue

    await mkdir(asset.to, { recursive: true })
    await cp(asset.from, asset.to, { force: true, recursive: true })
  }
}

async function resolveStandaloneEnvFile(rootDir) {
  const candidates = ['.env.local', '.env']

  for (const name of candidates) {
    const candidate = join(rootDir, name)
    if (await pathExists(candidate)) return candidate
  }

  throw new Error(
    `No standalone env file found in ${rootDir}; expected one of: ${candidates.join(', ')}`
  )
}

async function resolveStandaloneServerEntry(rootDir) {
  const serverEntry = join(rootDir, '.next', 'standalone', 'server.js')
  if (await pathExists(serverEntry)) return serverEntry

  throw new Error(
    `Standalone server build is missing at ${serverEntry}; run \`npm run build\` first`
  )
}

async function resolveManagedStartSpec(rootDir, options = {}) {
  const nodeExecutable = options.nodeExecutable ?? process.execPath
  const port = String(options.port ?? process.env.PORT ?? '3001')

  const envFile = await resolveStandaloneEnvFile(rootDir).catch(() => null)
  const serverEntry = await resolveStandaloneServerEntry(rootDir).catch(() => null)
  if (envFile && serverEntry) {
    return {
      mode: 'standalone',
      command: nodeExecutable,
      args: ['--env-file', envFile, serverEntry],
    }
  }

  const nextCli = join(rootDir, 'node_modules', 'next', 'dist', 'bin', 'next')
  if (!(await pathExists(nextCli))) {
    throw new Error(`Next.js CLI is missing at ${nextCli}; run \`npm install\` first`)
  }

  return {
    mode: 'dev',
    command: nodeExecutable,
    args: [nextCli, 'dev', '--hostname', '0.0.0.0', '--port', port],
  }
}

module.exports = {
  prepareStandaloneAssets,
  resolveManagedStartSpec,
  resolveStandaloneEnvFile,
  resolveStandaloneServerEntry,
}
