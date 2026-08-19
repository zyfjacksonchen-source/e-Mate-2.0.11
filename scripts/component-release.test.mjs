import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { emitComponent, componentFiles } from './component-release.mjs'

const root = await mkdtemp(join(tmpdir(), 'e-mate-component-release-'))
const repositoryRoot = fileURLToPath(new URL('..', import.meta.url))
const releaseCache = join(repositoryRoot, '.release-cache')
mkdirSync(releaseCache, { recursive: true })
const releaseRoot = await mkdtemp(join(releaseCache, 'component-release-test-'))
after(async () => {
  await Promise.all([
    rm(root, { recursive: true, force: true }),
    rm(releaseRoot, { recursive: true, force: true }),
  ])
})

describe('component payload closure', () => {
  it('exports the accepted Desktop bootstrap matrix from the shared inventory', () => {
    const node = process.execPath
    const inventory = JSON.parse(execFileSync(node, ['scripts/component-release.mjs', 'inventory'], {
      cwd: repositoryRoot,
      encoding: 'utf8',
    }))
    const accepted = inventory.components.filter(component => component.desktop !== 'blocked')
    assert.equal(accepted.length, 11)
    assert.equal(inventory.component_jobs.length, 15)
    assert.deepEqual(
      [...new Set(inventory.component_jobs.map(job => job.component))].sort(),
      accepted.map(component => component.id).sort(),
    )
    assert.equal(inventory.component_jobs.every(job => job.publish === true && typeof job.runner === 'string'), true)
  })

  it('enumerates only allowlisted regular files in stable order', () => {
    const packageRoot = join(root, 'valid')
    mkdirSync(join(packageRoot, 'lib'), { recursive: true })
    writeFileSync(join(packageRoot, 'package.json'), '{}\n')
    writeFileSync(join(packageRoot, 'LICENSE'), 'license\n')
    writeFileSync(join(packageRoot, 'lib', 'z.js'), 'z\n')
    writeFileSync(join(packageRoot, 'lib', 'a.js'), 'a\n')
    mkdirSync(join(packageRoot, 'lib', '__pycache__'))
    writeFileSync(join(packageRoot, 'lib', '__pycache__', 'a.pyc'), 'generated\n')
    const files = componentFiles(packageRoot, { files: ['lib', 'LICENSE'] })
    assert.deepEqual(files.map(file => file.path), ['LICENSE', 'lib/a.js', 'lib/z.js', 'package.json'])
    assert.equal(readFileSync(files[1].source, 'utf8'), 'a\n')
  })

  it('rejects traversal and symlinks at the component trust boundary', () => {
    const packageRoot = join(root, 'invalid')
    mkdirSync(packageRoot, { recursive: true })
    writeFileSync(join(packageRoot, 'package.json'), '{}\n')
    symlinkSync(join(packageRoot, 'package.json'), join(packageRoot, 'linked.json'))
    assert.throws(() => componentFiles(packageRoot, { files: ['../outside'] }), /unsafe/u)
    assert.throws(() => componentFiles(packageRoot, { files: ['linked.json'] }), /symlinks/u)
  })

  it('emits the real Shell with a materializable canonical package entry', () => {
    const output = join(releaseRoot, 'shell')
    const emitted = emitComponent({
      root: repositoryRoot,
      id: '@e-mate/dsh-client-shell',
      out: output,
      sourceCommit: 'a'.repeat(40),
    })
    assert.equal(emitted.package_entry, 'index.js')
    assert.equal(emitted.target, null)
    assert.equal(emitted.files.some(file => file.path === emitted.package_entry), true)
    assert.equal(JSON.parse(readFileSync(join(output, 'files', 'package.json'), 'utf8')).main, 'index.js')
  })

  it('emits the Skill Hub Host, Agent, UI, and bundled library closure as one portable component', () => {
    const output = join(releaseRoot, 'skill-hub')
    const emitted = emitComponent({
      root: repositoryRoot,
      id: '@e-mate/dsh-plugin-skill-hub',
      out: output,
      sourceCommit: 'd'.repeat(40),
    })
    const manifest = JSON.parse(readFileSync(join(output, 'files', 'package.json'), 'utf8'))
    assert.equal(emitted.package_entry, 'lib/index.js')
    assert.equal(emitted.target, null)
    assert.equal(emitted.files.some(file => file.path === 'lib/client.js'), true)
    assert.equal(emitted.files.some(file => file.path === 'lib/skill-hub.js'), true)
    assert.equal(emitted.files.some(file => /^lib\/skill-hub-[A-Za-z0-9_-]+\.js$/u.test(file.path)), true)
    assert.equal(manifest.dependencies, undefined)
    assert.deepEqual(manifest.peerDependencies, {
      '@deepseek-ai/dsh-skill-filesystem': '0.1.0-rc.7',
      '@deepseek-ai/dsh-tools': '0.1.0-rc.7',
      react: '^18.2.0',
    })
  })


  it('emits only the native closure selected for a platform target', () => {
    const output = join(releaseRoot, 'computer-use-win32-x64')
    const emitted = emitComponent({
      root: repositoryRoot,
      id: '@e-mate/dsh-plugin-computer-use',
      out: output,
      sourceCommit: 'b'.repeat(40),
      target: 'win32-x64',
    })
    assert.deepEqual(emitted.target, {
      platform: 'win32',
      arch: 'x64',
      runtime_abi: 'none',
      minimum_os: '10.0',
      signing: { scheme: 'unsigned', identity: 'none' },
      native_paths: [],
    })
    assert.equal(emitted.files.some(file => file.path.startsWith('native/macos/')), false)
    assert.equal(emitted.files.some(file => file.path === emitted.package_entry), true)
  })

  it('requires an explicit supported target for platform components', () => {
    assert.throws(() => emitComponent({
      root: repositoryRoot,
      id: '@e-mate/dsh-plugin-computer-use',
      out: join(releaseRoot, 'missing-target'),
      sourceCommit: 'c'.repeat(40),
    }), /require --target/u)
  })
})
