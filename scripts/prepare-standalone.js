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

module.exports = { prepareStandaloneAssets }
