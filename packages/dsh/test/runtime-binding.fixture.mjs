import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

import { HARNESS_COMMIT, installProfile, resolveHarness } from '../lib/e-mate.js'

const digest = path => createHash('sha256').update(readFileSync(path)).digest('hex')

export function installTestProfile(dshHome) {
  const paths = installProfile(dshHome)
  const bindingPath = join(paths.profile, 'plugins', 'runtime-binding.json')
  if (existsSync(bindingPath)) return paths

  const harness = resolveHarness()
  const harnessRequire = createRequire(join(dirname(dirname(harness.bin)), 'package.json'))
  const packageRequire = createRequire(new URL('../package.json', import.meta.url))
  const modules = {
    tools_module: harnessRequire.resolve('@deepseek-ai/dsh-tools'),
    storage_domain_module: harnessRequire.resolve('@deepseek-ai/dsh-storage-domain'),
    llm_module: harnessRequire.resolve('@deepseek-ai/dsh-llm'),
    credentials_module: harnessRequire.resolve('@deepseek-ai/dsh-credentials'),
    launch_environment_module: harnessRequire.resolve('@deepseek-ai/dsh-launch-environment'),
    zod_module: harnessRequire.resolve('zod'),
    playwright_module: packageRequire.resolve('playwright-core'),
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
