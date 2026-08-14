import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const target = readFileSync(resolve(root, 'docs/target-contract.md'), 'utf8')
const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))

if (manifest.version !== '2.0.7') throw new Error(`workspace version drifted: ${manifest.version}`)
if (!target.includes('47f943859bef60e4160492346772ded9b24f765a')) throw new Error('Harness source pin is missing')
if (!target.includes('564a6b6c1d43fb6831dd4a5cd8026e472f063311')) throw new Error('e-Mate shell source pin is missing')

const submodule = resolve(root, 'upstream/deepseek-harness')
try {
  const head = execFileSync('git', ['-C', submodule, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  if (head !== '47f943859bef60e4160492346772ded9b24f765a') throw new Error(`Harness submodule drifted: ${head}`)
} catch (error) {
  if (error instanceof Error && error.message.includes('submodule drifted')) throw error
  throw new Error('Harness submodule is missing; run git submodule update --init --recursive')
}

console.log('target contract: e-Mate Harness 2.0.7 pins verified')

