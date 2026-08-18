import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const target = readFileSync(resolve(root, 'docs/target-contract.md'), 'utf8')
const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
const release = JSON.parse(readFileSync(resolve(root, 'packages/dsh/package.json'), 'utf8'))
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
  'packages/dsh/src/profile/skill-hub-agent.ts',
  'packages/dsh/src/profile/identity/index.ts',
  'packages/dsh/src/profile/identity/agreements.ts',
  'packages/dsh/src/profile/model-policy.ts',
  'packages/dsh/src/profile/audit.ts',
  'packages/dsh/src/profile/emate-shell/index.ts',
  'packages/dsh/profile/plugins/emate-shell/src/client/index.ts',
  'packages/dsh/profile/plugins/emate-shell/src/client/home.tsx',
  'packages/dsh/profile/plugins/emate-shell/src/client/sidebar.tsx',
]
for (const path of typescriptSources) readFileSync(resolve(root, path), 'utf8')

if (manifest.version !== '2.0.9') throw new Error(`workspace version drifted: ${manifest.version}`)
if (release.name !== '@e-mate/dsh' || release.version !== '2.0.9') {
  throw new Error(`release identity drifted: ${release.name}@${release.version}`)
}
if (!release.description.startsWith('e-Mate 2.0.9')) throw new Error('release product name drifted')
if (release.bin?.['e-mate'] !== 'lib/bin.js') throw new Error('TypeScript-built CLI entry drifted')
if (!target.includes('Product name: `e-Mate`')) throw new Error('product name drifted')
if (!target.includes('Repository: `zyfjacksonchen-source/e-Mate`')) throw new Error('repository identity drifted')
if (!target.includes('df78045a127e32cb5b942defba52c539590d1596')) throw new Error('Harness source pin is missing')
if (!target.includes('564a6b6c1d43fb6831dd4a5cd8026e472f063311')) throw new Error('e-Mate shell source pin is missing')
if (!target.includes('TypeScript/TSX')) throw new Error('TypeScript source contract is missing')
if (!target.includes('019ff91c-47ca-7c11-93bd-863475181a18')) throw new Error('full e-Mate UI reference is missing')
if (!target.includes('019ff665-d721-79a0-869d-338f086cf529')) throw new Error('chat interaction reference is missing')
if (!target.includes('Historical e-Mate `v0.x`/`v1.x` screenshots')) throw new Error('final 2.0.4/2.0.5 visual-source rule is missing')
if (/\b(?:WebSocket|EventSource)\b|\bfetch\s*\(|\/api\//.test(shellSource)) {
  throw new Error('e-Mate shell introduced a parallel WebUI/CLI transport')
}

for (const [name, path, expected] of [
  ['Harness', 'upstream/deepseek-harness', 'df78045a127e32cb5b942defba52c539590d1596'],
  ['e-Mate shell', 'upstream/e-mate-2.0.5', '564a6b6c1d43fb6831dd4a5cd8026e472f063311'],
]) {
  try {
    const head = execFileSync('git', ['-C', resolve(root, path), 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
    if (head !== expected) throw new Error(`${name} submodule drifted: ${head}`)
  } catch (error) {
    if (error instanceof Error && error.message.includes('submodule drifted')) throw error
    throw new Error(`${name} submodule is missing; run git submodule update --init --recursive`)
  }
}

console.log('target contract: e-Mate 2.0.9 pins verified')
