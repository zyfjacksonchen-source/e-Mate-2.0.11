#!/usr/bin/env node

// Assemble the pinned DeepSeek Harness CLI with Harness's own deploy and
// release-pack paths. The result is a portable, symlink-free npm payload.
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { applyHarnessRuntimeAdapters } from './harness-runtime-adapters.mjs'

const PRODUCT_VERSION = '2.0.11'
const HARNESS_VERSION = '0.1.0-rc.7'
const HARNESS_COMMIT = '2bc16230975f6cf02aa1b283b1f86de44007b059'
const PNPM_VERSION = '11.7.0'

const root = resolve(import.meta.dirname, '..')
const harnessRoot = join(root, 'upstream', 'deepseek-harness')
const runtimeRoot = join(root, 'packages', 'dsh', 'runtime')
const output = join(runtimeRoot, 'harness')

function capture(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed:\n${result.stdout}\n${result.stderr}`)
  }
  return result.stdout.trim()
}

function run(command, args, options = {}) {
  console.log(`build-harness-runtime: ${basename(command)} ${args.join(' ')}`)
  const result = spawnSync(command, args, { stdio: 'inherit', ...options })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} exited with ${String(result.status)}`)
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function assertSource() {
  const commit = capture('git', ['-C', harnessRoot, 'rev-parse', 'HEAD'])
  const version = JSON.parse(readFileSync(join(harnessRoot, 'apps', 'cli', 'package.json'), 'utf8')).version
  if (commit !== HARNESS_COMMIT || version !== HARNESS_VERSION) {
    throw new Error(`pinned Harness drifted (version=${String(version)}, commit=${commit})`)
  }
  if (!existsSync(join(harnessRoot, 'apps', 'cli', 'lib', 'bin.js'))) {
    throw new Error('pinned Harness build is missing; run its pnpm build before assembling the runtime')
  }
}

function assertPnpm() {
  const actual = capture('pnpm', ['--version'])
  if (actual !== PNPM_VERSION) throw new Error(`pnpm ${PNPM_VERSION} is required, found ${actual}`)
}

async function unpackMissingPackages(stage, packRoot) {
  for (const family of ['dsh', 'vendor']) {
    const directory = join(packRoot, family)
    for (const filename of (await readdir(directory)).filter(name => name.endsWith('.tgz')).sort()) {
      const archive = join(directory, filename)
      const manifest = JSON.parse(execFileSync('tar', ['-xOzf', archive, 'package/package.json'], { encoding: 'utf8' }))
      if (typeof manifest.name !== 'string' || !manifest.name.startsWith('@deepseek-ai/')) {
        throw new Error(`${archive} has an unexpected package identity`)
      }
      const target = join(stage, 'node_modules', ...manifest.name.split('/'))
      if (existsSync(target)) continue
      const scratch = await mkdtemp(join(tmpdir(), 'e-mate-harness-unpack-'))
      try {
        execFileSync('tar', ['-xzf', archive, '-C', scratch])
        await mkdir(dirname(target), { recursive: true })
        await rename(join(scratch, 'package'), target)
      } finally {
        await rm(scratch, { recursive: true, force: true })
      }
    }
  }
}

async function removePackageManagerLinks(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isSymbolicLink()) {
      if (path.includes(`${sep}.bin${sep}`)) {
        await rm(path, { force: true })
        continue
      }
      throw new Error(`portable Harness payload contains a symbolic link: ${path}`)
    }
    if (entry.isDirectory()) await removePackageManagerLinks(path)
  }
}

async function arrangeRuntime(stage, assembled) {
  const cli = join(assembled, 'apps', 'cli')
  await mkdir(cli, { recursive: true })
  for (const entry of await readdir(stage)) {
    if (entry === 'node_modules') {
      await rename(join(stage, entry), join(assembled, entry))
    } else if (entry !== 'pnpm-lock.yaml') {
      await rename(join(stage, entry), join(cli, entry))
    }
  }
  await rm(join(assembled, 'node_modules', '.pnpm'), { recursive: true, force: true })
  await rm(join(assembled, 'node_modules', '.modules.yaml'), { force: true })
  await rm(join(assembled, 'node_modules', '.pnpm-workspace-state-v1.json'), { force: true })
  await removePackageManagerLinks(assembled)
}

async function publishAtomically(assembled, manifest) {
  const previous = `${output}.previous-${randomUUID()}`
  const hadPrevious = existsSync(output)
  try {
    if (hadPrevious) await rename(output, previous)
    await rename(assembled, output)
    await writeFile(join(runtimeRoot, 'source-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
    if (hadPrevious) await rm(previous, { recursive: true, force: true })
  } catch (error) {
    if (!existsSync(output) && existsSync(previous)) await rename(previous, output)
    throw error
  }
}

async function main() {
  assertSource()
  assertPnpm()
  await mkdir(runtimeRoot, { recursive: true })
  for (const entry of await readdir(runtimeRoot, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name.startsWith('.harness-build-')) {
      await rm(join(runtimeRoot, entry.name), { recursive: true, force: true })
    }
  }
  const scratch = await mkdtemp(join(tmpdir(), 'e-mate-harness-build-'))
  const stage = join(scratch, 'deploy')
  const assembled = join(scratch, 'assembled')
  const packRoot = join(scratch, 'release-pack')
  const environment = { ...process.env, CI: 'true' }
  try {
    run('pnpm', [
      '--filter', '@deepseek-ai/dsh', 'deploy', '--prod',
      '--os=darwin', '--os=win32', '--cpu=arm64', '--cpu=x64',
      '--config.node-linker=hoisted',
      '--config.link-workspace-packages=true',
      '--config.inject-workspace-packages=true',
      '--config.ignore-scripts=true',
      stage,
    ], { cwd: harnessRoot, env: environment })
    for (const family of ['dsh', 'vendor']) {
      run('pnpm', ['run', 'release:pack', '--family', family, '--out', join(packRoot, family)], {
        cwd: harnessRoot,
        env: environment,
      })
    }
    await unpackMissingPackages(stage, packRoot)
    run(process.execPath, [join(stage, 'node_modules', '@deepseek-ai', 'dsh-subprocess-local', 'scripts', 'ensure-spawn-helper.mjs')], {
      cwd: stage,
      env: environment,
    })
    await arrangeRuntime(stage, assembled)
    await applyHarnessRuntimeAdapters(assembled)
    const reported = capture(process.execPath, [join(assembled, 'apps', 'cli', 'lib', 'bin.js'), '--version'])
    if (reported !== HARNESS_VERSION) throw new Error(`assembled Harness reported ${reported}`)
    await publishAtomically(assembled, {
      schema_version: 1,
      product: 'e-Mate',
      product_version: PRODUCT_VERSION,
      source: 'zyfjacksonchen-source/deepseek-harness',
      version: HARNESS_VERSION,
      commit: HARNESS_COMMIT,
      lockfile_sha256: sha256(join(harnessRoot, 'pnpm-lock.yaml')),
      package_manager: `pnpm@${PNPM_VERSION}`,
      assembly: 'harness-pnpm-deploy-and-release-pack',
    })
    console.log(`build-harness-runtime: assembled ${output}`)
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
}

await main()
