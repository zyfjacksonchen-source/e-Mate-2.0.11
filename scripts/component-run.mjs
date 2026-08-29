#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { loadReleaseBoundary } from './change-impact.mjs'
import { prepareHarnessBaseImports } from './component-base-imports.mjs'
import { componentFiles, verifyComponentRuntimeImports } from './component-release.mjs'

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { component: { type: 'string' } },
})
const command = positionals[0]
if (!['build', 'check'].includes(command) || positionals.length !== 1) {
  throw new Error('usage: node scripts/component-run.mjs <build|check> [--component <id>]')
}

const boundary = loadReleaseBoundary()
if (!boundary.valid) throw new Error(boundary.errors.join('\n'))
const components = boundary.components.filter(component => component.desktop !== 'blocked'
  && (values.component === undefined || component.id === values.component))
if (components.length === 0 || values.component !== undefined && components.length !== 1) {
  throw new Error(`unknown or blocked component: ${String(values.component)}`)
}

const packageManager = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).packageManager
const expectedPnpm = /^pnpm@([^+]+)$/u.exec(packageManager)?.[1]
if (expectedPnpm === undefined) throw new Error(`unsupported packageManager: ${String(packageManager)}`)
const inheritedPnpm = process.env.npm_execpath
const pnpm = inheritedPnpm === undefined
  ? { command: process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', prefix: [], shell: process.platform === 'win32' }
  : { command: process.execPath, prefix: [inheritedPnpm], shell: false }

const detectedPnpm = spawnSync(pnpm.command, [...pnpm.prefix, '--version'], { encoding: 'utf8', shell: pnpm.shell })
if (detectedPnpm.error !== undefined) throw detectedPnpm.error
if (detectedPnpm.status !== 0) throw new Error(detectedPnpm.stderr.trim() || 'unable to determine pnpm version')
if (detectedPnpm.stdout.trim() !== expectedPnpm) {
  throw new Error(`component builds require pnpm ${expectedPnpm}, found ${detectedPnpm.stdout.trim()}`)
}

function run(args, env = process.env) {
  const result = spawnSync(pnpm.command, [...pnpm.prefix, ...args], { stdio: 'inherit', env, shell: pnpm.shell })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

for (const component of components) {
  run(['--dir', component.root, 'install', '--ignore-workspace', '--frozen-lockfile'])
  if (component.id === '@e-mate/dsh-plugin-find-skill') {
    run(['--dir', 'upstream/plugins/dsh-find-skill', 'install', '--frozen-lockfile', '--ignore-scripts'])
  }
  prepareHarnessBaseImports({
    componentRoot: resolve(component.root),
    harnessRoot: resolve('upstream/deepseek-harness'),
    baseImports: component.base_imports,
    runtimeImports: boundary.baseContract.runtime_imports,
  })
}

for (const component of components) {
  run(['--dir', component.root, 'run', 'build'], command === 'check'
    ? { ...process.env, EMATE_COMPONENT_CHECK: '1' }
    : process.env)
  const manifest = JSON.parse(readFileSync(resolve(component.root, 'package.json'), 'utf8'))
  const entries = componentFiles(resolve(component.root), manifest)
  const requestedTarget = process.env.EMATE_COMPONENT_TARGET
  const targets = component.kind === 'platform-profile'
    ? component.targets.filter(target => requestedTarget !== undefined
      && `${target.platform}-${target.arch}` === requestedTarget)
    : [null]
  if (component.kind === 'platform-profile' && requestedTarget !== undefined && targets.length === 0) {
    throw new Error(`unsupported component target: ${requestedTarget}`)
  }
  for (const target of targets) verifyComponentRuntimeImports(entries, component, target)
  if (command === 'check') run(['--dir', component.root, 'run', 'test'])
}
