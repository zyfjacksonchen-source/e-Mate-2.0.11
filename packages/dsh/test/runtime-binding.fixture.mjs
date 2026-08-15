import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'

import { HARNESS_COMMIT, installProfile, resolveHarness } from '../lib/e-mate.js'

const digest = path => createHash('sha256').update(readFileSync(path)).digest('hex')

export function installTestProfile(dshHome) {
  const paths = installProfile(dshHome)
  const bindingPath = join(paths.profile, 'plugins', 'runtime-binding.json')
  if (existsSync(bindingPath)) return paths

  const harness = resolveHarness()
  const harnessRoot = resolve(dirname(dirname(harness.bin)), '..', '..')
  const packagedRequire = createRequire(join(harnessRoot, 'package.json'))
  const sourceModule = (packagePath, packageName) => {
    const entry = join(harnessRoot, packagePath, 'lib', 'index.js')
    return existsSync(entry) ? entry : packagedRequire.resolve(packageName)
  }
  const storagePackage = join(harnessRoot, 'packages', 'storage', 'storage-domain')
  const storageRequire = createRequire(existsSync(storagePackage)
    ? join(storagePackage, 'package.json')
    : join(harnessRoot, 'package.json'))
  const modules = {
    tools_module: sourceModule('packages/core/tools', '@deepseek-ai/dsh-tools'),
    storage_domain_module: sourceModule('packages/storage/storage-domain', '@deepseek-ai/dsh-storage-domain'),
    llm_module: sourceModule('packages/llm/llm', '@deepseek-ai/dsh-llm'),
    credentials_module: sourceModule('packages/credentials/credentials', '@deepseek-ai/dsh-credentials'),
    launch_environment_module: sourceModule('packages/util/launch-environment', '@deepseek-ai/dsh-launch-environment'),
    zod_module: storageRequire.resolve('zod'),
  }
  const binding = {
    schema_version: 1,
    product: 'e-Mate',
    version: '2.0.7',
    dsh_home: paths.dshHome,
    harness_commit: HARNESS_COMMIT,
    ...modules,
    ...Object.fromEntries(Object.entries(modules).map(([key, path]) => [`${key}_sha256`, digest(path)])),
  }
  writeFileSync(bindingPath, `${JSON.stringify(binding, null, 2)}\n`, { mode: 0o600 })
  return paths
}
