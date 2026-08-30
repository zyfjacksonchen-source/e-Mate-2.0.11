import { chmod, copyFile, cp, lstat, mkdir, readFile, rm } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { componentFiles } from './component-release.mjs'

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)))

async function copyProductTree(source, destination, excluded = []) {
  await cp(source, destination, {
    recursive: true,
    force: true,
    dereference: false,
    filter: async path => {
      const name = relative(source, path).split(sep).join('/')
      if (name.split('/').includes('node_modules')
        || excluded.some(root => name === root || name.startsWith(`${root}/`))) return false
      return !(await lstat(path)).isSymbolicLink()
    },
  })
}

async function copyComponentPackage(source, destination) {
  const manifest = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'))
  for (const entry of componentFiles(source, manifest)) {
    const output = join(destination, ...entry.path.split('/'))
    await mkdir(dirname(output), { recursive: true })
    await copyFile(entry.source, output)
    await chmod(output, entry.executable ? 0o755 : 0o644)
  }
}

export async function stageDesktopProfileArtifact({
  packagesRoot = join(repositoryRoot, 'packages'),
  destination = join(repositoryRoot, '.release-cache', 'profile-artifact'),
} = {}) {
  await rm(destination, { recursive: true, force: true })
  await mkdir(destination, { recursive: true })
  const profileSource = join(packagesRoot, 'dsh', 'profile')
  const inventory = JSON.parse(await readFile(
    join(profileSource, 'component-inventory.json'),
    'utf8',
  ))
  if (inventory.schema_version !== 1 || !Array.isArray(inventory.components)) {
    throw new Error('profile artifact component inventory is invalid')
  }
  const profileComponents = inventory.components.filter(component =>
    typeof component.root === 'string' && component.root.startsWith('packages/dsh/profile/'))
  if (profileComponents.some(component => !/^packages\/dsh\/profile\/plugins\/[a-z0-9-]+$/u.test(component.root))) {
    throw new Error('profile artifact local component root is invalid')
  }
  await copyProductTree(
    profileSource,
    join(destination, 'dsh', 'profile'),
    profileComponents.map(component => component.root.slice('packages/dsh/profile/'.length)),
  )
  for (const component of profileComponents.filter(component => component.desktop !== 'blocked')) {
    const directory = component.root.slice('packages/'.length)
    await copyComponentPackage(
      join(packagesRoot, directory),
      join(destination, 'dsh', 'profile', component.root.slice('packages/dsh/profile/'.length)),
    )
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
