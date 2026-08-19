import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { emitComponent, componentFiles, targetEntries } from './component-release.mjs'

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
    assert.deepEqual(
      inventory.components.filter(component => component.source_roots.length > 0).map(component => ({
        id: component.id,
        source_roots: component.source_roots,
      })),
      [
        {
          id: '@e-mate/dsh-plugin-computer-use',
          source_roots: ['upstream/plugins/dsh-computer-use'],
        },
        {
          id: '@e-mate/dsh-plugin-find-skill',
          source_roots: ['upstream/plugins/dsh-find-skill'],
        },
      ],
    )
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

  it('declares the real Shell package entry in its component allowlist', () => {
    const shellRoot = join(repositoryRoot, 'packages/dsh/profile/plugins/emate-shell')
    const manifest = JSON.parse(readFileSync(join(shellRoot, 'package.json'), 'utf8'))
    assert.equal(manifest.main, 'index.js')
    assert.equal(manifest.files.includes(manifest.main), true)
    assert.equal(manifest.files.includes('assets'), true)
    assert.doesNotMatch(manifest.scripts.build, /sync-emate-ui-assets/u)
    for (const name of [
      'e-mate-team-hero-transparent.png',
      'emate-logo.png',
      'emate-mark.png',
      'lucide-send.svg',
      'xiaoxin-avatar.png',
    ]) {
      const path = `packages/dsh/profile/plugins/emate-shell/assets/${name}`
      assert.ok(statSync(join(repositoryRoot, path)).size > 0, path)
      execFileSync('git', ['ls-files', '--error-unmatch', '--', path], { cwd: repositoryRoot })
    }
  })

  it('declares the Skill Hub Host, Agent, UI, and library as one portable component', () => {
    const manifest = JSON.parse(readFileSync(join(repositoryRoot, 'packages/dsh-plugin-skill-hub/package.json'), 'utf8'))
    assert.equal(manifest.main, 'lib/index.js')
    assert.equal(manifest.files.includes('lib'), true)
    assert.equal(manifest.exports['./client'], './lib/client.js')
    assert.equal(manifest.exports['./skill-hub'], './lib/skill-hub.js')
    assert.equal(manifest.dependencies, undefined)
    assert.deepEqual(manifest.peerDependencies, {
      '@deepseek-ai/dsh-skill-filesystem': '0.1.0-rc.7',
      '@deepseek-ai/dsh-tools': '0.1.0-rc.7',
      react: '^18.2.0',
    })
  })


  it('selects only the native closure declared for one platform target', () => {
    const inventory = JSON.parse(readFileSync(
      join(repositoryRoot, 'packages/dsh/profile/component-inventory.json'),
      'utf8',
    ))
    const component = inventory.components.find(candidate => candidate.id === '@e-mate/dsh-plugin-computer-use')
    const target = component.targets.find(candidate => candidate.platform === 'win32')
    assert.deepEqual(target, {
      platform: 'win32',
      arch: 'x64',
      runtime_abi: 'none',
      minimum_os: '10.0',
      signing: { scheme: 'unsigned', identity: 'none' },
      native_paths: [],
    })
    assert.deepEqual(targetEntries([
      { path: 'lib/index.js' },
      { path: 'native/macos/bin/dsh-computer-use-helper' },
    ], component, target).map(entry => entry.path), ['lib/index.js'])
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
