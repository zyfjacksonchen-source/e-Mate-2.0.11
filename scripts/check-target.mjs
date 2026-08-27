import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { ACCEPTED_PREDECESSOR, assertAcceptedPredecessor, PRODUCT_UI_REFERENCE } from './change-impact.mjs'
import { assertHarnessSource, HARNESS_COMMIT } from './harness-provenance.mjs'

const root = resolve(import.meta.dirname, '..')
const repository = 'zyfjacksonchen-source/e-Mate-2.0.11'
const repositoryUrl = `git+https://github.com/${repository}.git`
const target = readFileSync(resolve(root, 'docs/target-contract.md'), 'utf8')
const productVersion = '2.0.14'
const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
const desktopWorkspace = JSON.parse(readFileSync(resolve(root, 'desktop/package.json'), 'utf8'))
const desktop = JSON.parse(readFileSync(resolve(root, 'desktop/e-mate-desktop/package.json'), 'utf8'))
const release = JSON.parse(readFileSync(resolve(root, 'packages/dsh/package.json'), 'utf8'))
const componentInventory = JSON.parse(readFileSync(
  resolve(root, 'packages/dsh/profile/component-inventory.json'),
  'utf8',
))
const shellSource = [
  'packages/dsh/profile/plugins/emate-shell/src/client/index.ts',
  'packages/dsh/profile/plugins/emate-shell/src/client/home.tsx',
  'packages/dsh/profile/plugins/emate-shell/src/client/sidebar.tsx',
].map(path => readFileSync(resolve(root, path), 'utf8')).join('\n')
const typescriptSources = [
  'packages/dsh/src/bin.ts',
  'packages/dsh/src/e-mate.ts',
  'packages/dsh/src/legacy-schedule.ts',
  'packages/dsh/src/profile/health.ts',
  'packages/dsh/src/profile/agent-operations.ts',
  'packages/dsh/src/profile/schedule-import.ts',
  'packages/dsh-plugin-skill-hub/src/index.ts',
  'packages/dsh-plugin-skill-hub/src/skill-hub.ts',
  'packages/dsh-plugin-skill-hub/src/client/index.tsx',
  'packages/dsh/src/profile/identity/index.ts',
  'packages/dsh/src/profile/identity/agreements.ts',
  'packages/dsh/src/profile/model-policy.ts',
  'packages/dsh/src/profile/audit.ts',
  'packages/dsh/profile/plugins/emate-shell/src/index.ts',
  'packages/dsh/profile/plugins/emate-shell/src/client/index.ts',
  'packages/dsh/profile/plugins/emate-shell/src/client/home.tsx',
  'packages/dsh/profile/plugins/emate-shell/src/client/sidebar.tsx',
]
for (const path of typescriptSources) readFileSync(resolve(root, path), 'utf8')

for (const [name, value] of [
  ['workspace', manifest],
  ['desktop workspace', desktopWorkspace],
  ['desktop', desktop],
]) {
  if (value.version !== productVersion) throw new Error(`${name} version drifted: ${value.version}`)
}
if (release.name !== '@e-mate/dsh' || release.version !== productVersion) {
  throw new Error(`release identity drifted: ${release.name}@${release.version}`)
}
if (!release.description.startsWith(`e-Mate ${productVersion}`)) throw new Error('release product name drifted')
for (const component of componentInventory.components.filter(component => component.desktop !== 'blocked')) {
  const value = JSON.parse(readFileSync(resolve(root, component.root, 'package.json'), 'utf8'))
  if (value.name !== component.id || value.version !== productVersion) {
    throw new Error(`official Profile component identity drifted: ${value.name}@${value.version}`)
  }
}
if (release.bin?.['e-mate'] !== 'lib/bin.js') throw new Error('TypeScript-built CLI entry drifted')
if (!target.includes('Product name: `e-Mate`')) throw new Error('product name drifted')
if (!target.includes(`Repository: \`${repository}\``)) throw new Error('repository identity drifted')
for (const path of [
  'packages/dsh/package.json',
  'desktop/e-mate-desktop/package.json',
  'packages/dsh-plugin-cdp/package.json',
  'packages/dsh-plugin-memory-evolve/package.json',
  'packages/dsh-plugin-office-skills/package.json',
  'packages/dsh-plugin-tool-search/package.json',
]) {
  const value = JSON.parse(readFileSync(resolve(root, path), 'utf8'))
  if (value.repository?.url !== repositoryUrl) throw new Error(`repository package metadata drifted: ${path}`)
}
for (const path of ['scripts/release.mjs', 'scripts/publish-r2.mjs', 'scripts/publish-profile-r2.mjs']) {
  if (!readFileSync(resolve(root, path), 'utf8').includes(`const REPOSITORY = '${repository}'`)) {
    throw new Error(`repository release authority drifted: ${path}`)
  }
}
if (!target.includes(ACCEPTED_PREDECESSOR)) throw new Error('accepted 2.0.11 predecessor is missing')
if (!target.includes(HARNESS_COMMIT)) throw new Error('Harness source pin is missing')
if (!target.includes(PRODUCT_UI_REFERENCE.commit)) throw new Error('e-Mate shell source pin is missing')
if (!target.includes('TypeScript/TSX')) throw new Error('TypeScript source contract is missing')
if (!target.includes('019ff91c-47ca-7c11-93bd-863475181a18')) throw new Error('full e-Mate UI reference is missing')
if (!target.includes('019ff665-d721-79a0-869d-338f086cf529')) throw new Error('chat interaction reference is missing')
if (!target.includes('Historical e-Mate `v0.x`/`v1.x` screenshots')) throw new Error('final 2.0.4/2.0.5 visual-source rule is missing')
if (/\b(?:WebSocket|EventSource)\b|\bfetch\s*\(|\/api\//.test(shellSource)) {
  throw new Error('e-Mate shell introduced a parallel WebUI/CLI transport')
}

for (const path of [
  'packages/dsh-plugin-browser',
  'packages/dsh-plugin-browser-panel',
  'desktop/e-mate-desktop/src/browser-extension-setup.ts',
  'desktop/e-mate-desktop/vendor/dsh-browser-extension',
]) {
  if (existsSync(resolve(root, path))) throw new Error(`legacy extension browser source returned: ${path}`)
}
const legacyBrowserVendor = readdirSync(resolve(root, 'desktop/e-mate-desktop/vendor'))
  .find(name => /(?:dsh-browser|bridge-browser)/u.test(name))
if (legacyBrowserVendor !== undefined) throw new Error(`legacy extension browser vendor returned: ${legacyBrowserVendor}`)

for (const [name, path, expected] of [
  ['Harness', 'upstream/deepseek-harness', HARNESS_COMMIT],
  ['e-Mate shell', PRODUCT_UI_REFERENCE.path, PRODUCT_UI_REFERENCE.commit],
]) {
  try {
    const head = execFileSync('git', ['-C', resolve(root, path), 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
    if (head !== expected) throw new Error(`${name} submodule drifted: ${head}`)
  } catch (error) {
    if (error instanceof Error && error.message.includes('submodule drifted')) throw error
    throw new Error(`${name} submodule is missing; run git submodule update --init --recursive`)
  }
}

assertHarnessSource(root)

assertAcceptedPredecessor(root, execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim())

console.log(`target contract: e-Mate ${productVersion} pins verified`)
