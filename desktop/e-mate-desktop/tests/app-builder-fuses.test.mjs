import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dependencyRoot = process.env.EMATE_DESKTOP_DEPENDENCY_ROOT || packageRoot
const workspaceRequire = createRequire(join(dependencyRoot, 'package.json'))
const appBuilderManifest = workspaceRequire.resolve('app-builder-lib/package.json')
const appBuilderRequire = createRequire(appBuilderManifest)
const dynamicImportPath = appBuilderRequire.resolve('./out/util/dynamicImport.js')
const { PlatformPackager } = workspaceRequire('app-builder-lib')
const dynamicImportModule = appBuilderRequire(dynamicImportPath)
const originalDynamicImport = dynamicImportModule.dynamicImport
const originalSetTimeout = globalThis.setTimeout

afterEach(() => {
  dynamicImportModule.dynamicImport = originalDynamicImport
  globalThis.setTimeout = originalSetTimeout
})

function fuseError(binaryPath, overrides = {}) {
  return Object.assign(new Error('UNKNOWN: unknown error, open'), {
    code: 'UNKNOWN',
    syscall: 'open',
    path: binaryPath,
  }, overrides)
}

async function runWinFuse(flipFuses) {
  dynamicImportModule.dynamicImport = async specifier => {
    assert.equal(specifier, '@electron/fuses')
    return { flipFuses }
  }
  globalThis.setTimeout = callback => {
    queueMicrotask(callback)
    return 0
  }
  const packager = Object.create(PlatformPackager.prototype)
  packager.appInfo = { productFilename: 'e-Mate' }
  const appOutDir = resolve('dist/win-unpacked')
  const binaryPath = join(appOutDir, 'e-Mate.exe')
  return { binaryPath, promise: packager.addElectronFuses({ appOutDir, electronPlatformName: 'win32' }, {}) }
}

test('retries the exact Windows fuse sharing error and succeeds', async () => {
  let attempts = 0
  let binaryPath
  const run = await runWinFuse(path => {
    binaryPath = path
    attempts += 1
    if (attempts < 3) throw fuseError(resolve(path))
    return 'flipped'
  })
  assert.equal(await run.promise, 'flipped')
  assert.equal(resolve(binaryPath), run.binaryPath)
  assert.equal(attempts, 3)
})

test('does not retry a non-sharing fuse failure', async () => {
  let attempts = 0
  const run = await runWinFuse(path => {
    attempts += 1
    throw fuseError(resolve(path), { code: 'EACCES' })
  })
  await assert.rejects(run.promise, error => error.code === 'EACCES')
  assert.equal(attempts, 1)
})

test('stops after three retries of the Windows fuse sharing error', async () => {
  let attempts = 0
  const run = await runWinFuse(path => {
    attempts += 1
    throw fuseError(resolve(path))
  })
  await assert.rejects(run.promise, error => error.code === 'UNKNOWN')
  assert.equal(attempts, 4)
})
