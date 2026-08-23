import { cp, lstat, mkdir, readFile, rm } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)))

async function copyProductTree(source, destination) {
  await cp(source, destination, {
    recursive: true,
    force: true,
    dereference: false,
    filter: async path => {
      if (relative(source, path).split(sep).includes('node_modules')) return false
      return !(await lstat(path)).isSymbolicLink()
    },
  })
}

export async function stageDesktopProfileArtifact({
  packagesRoot = join(repositoryRoot, 'packages'),
  destination = join(repositoryRoot, '.release-cache', 'profile-artifact'),
} = {}) {
  await rm(destination, { recursive: true, force: true })
  await mkdir(destination, { recursive: true })
  await copyProductTree(
    join(packagesRoot, 'dsh', 'profile'),
    join(destination, 'dsh', 'profile'),
  )

  const inventory = JSON.parse(await readFile(
    join(packagesRoot, 'dsh', 'profile', 'component-inventory.json'),
    'utf8',
  ))
  if (inventory.schema_version !== 1 || !Array.isArray(inventory.components)) {
    throw new Error('profile artifact component inventory is invalid')
  }
  const components = inventory.components.filter(component =>
    /^@e-mate\/dsh-plugin-[a-z0-9-]+$/u.test(component.id)
      && component.desktop !== 'blocked')
  for (const component of components.sort((left, right) => left.id.localeCompare(right.id))) {
    if (!/^packages\/dsh-plugin-[a-z0-9-]+$/u.test(component.root)) {
      throw new Error(`profile artifact component root is invalid: ${component.id}`)
    }
    const directory = component.root.slice('packages/'.length)
    const source = join(packagesRoot, directory, 'lib')
    const metadata = await lstat(source)
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new Error(`profile artifact component is not built: ${component.id}`)
    }
    await copyProductTree(source, join(destination, directory, 'lib'))
  }

  if (components.length === 0) throw new Error('profile artifact has no accepted component libraries')
  return { componentCount: components.length, destination: resolve(destination) }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const receipt = await stageDesktopProfileArtifact()
  process.stdout.write(`${JSON.stringify(receipt)}\n`)
}
