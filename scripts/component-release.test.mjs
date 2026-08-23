import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  componentFiles,
  componentRuntimeImports,
  componentRuntimeParserAvailable,
  emitComponent,
  targetEntries,
  verifyComponentRuntimeImports,
} from './component-release.mjs'

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
    assert.equal(accepted.length, 15)
    assert.deepEqual(accepted.map(component => component.id).sort(), [
      '@e-mate/dsh-client-shell',
      '@e-mate/dsh-plugin-better-sidebar',
      '@e-mate/dsh-plugin-cdp',
      '@e-mate/dsh-plugin-computer-use',
      '@e-mate/dsh-plugin-file-import',
      '@e-mate/dsh-plugin-find-skill',
      '@e-mate/dsh-plugin-genui',
      '@e-mate/dsh-plugin-glass-composer',
      '@e-mate/dsh-plugin-mcp-manage',
      '@e-mate/dsh-plugin-memory-evolve',
      '@e-mate/dsh-plugin-office-skills',
      '@e-mate/dsh-plugin-schedules',
      '@e-mate/dsh-plugin-skill-hub',
      '@e-mate/dsh-plugin-tool-search',
      '@e-mate/dsh-plugin-vision-toolkit',
    ].sort())
    assert.deepEqual(
      inventory.components.filter(component => component.desktop === 'blocked').map(component => component.id),
      ['@e-mate/dsh-plugin-xin-assistant'],
    )
    assert.equal(inventory.component_jobs.length, 19)
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
        {
          id: '@e-mate/dsh-plugin-genui',
          source_roots: ['upstream/plugins/dsh-genui'],
        },
        {
          id: '@e-mate/dsh-plugin-vision-toolkit',
          source_roots: ['upstream/plugins/dsh-vision-toolkit'],
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

  it('extracts only real external runtime imports from emitted JavaScript', {
    skip: !componentRuntimeParserAvailable() && 'Harness toolchain is intentionally absent in the impact lane',
  }, () => {
    const source = join(root, 'runtime-imports.js')
    writeFileSync(source, [
      'import { readFile } from "node:fs/promises"',
      'import { defineTool } from "@deepseek-ai/dsh-tools"',
      'import "./local.js"',
      'const react = require("react/jsx-runtime")',
      '// import ignored from "yaml"',
      'export { react, defineTool, readFile }',
      '',
    ].join('\n'))
    assert.deepEqual(componentRuntimeImports([{ path: 'lib/index.js', source }]), [
      '@deepseek-ai/dsh-tools',
      'react',
    ])
  })

  it('extracts imports from the exact DSH client ModuleLoader factory boundary', {
    skip: !componentRuntimeParserAvailable() && 'Harness toolchain is intentionally absent in the impact lane',
  }, () => {
    assert.deepEqual(componentRuntimeImports([{
      path: 'lib/client.js',
      source: join(repositoryRoot, 'upstream/plugins/dsh-genui/lib/client.js'),
    }]), [
      '@deepseek-ai/dsh-client-ui-primitives',
      'react',
      'react-dom',
    ])
  })

  it('allows only the declared Desktop component seam', {
    skip: !componentRuntimeParserAvailable() && 'Harness toolchain is intentionally absent in the impact lane',
  }, () => {
    const allowed = join(root, 'desktop-allowed.js')
    writeFileSync(allowed, 'import { bundledPythonPath } from "@e-mate/desktop/vision-toolkit"\n')
    assert.deepEqual(componentRuntimeImports([{ path: 'lib/index.js', source: allowed }]), [
      '@e-mate/desktop/vision-toolkit',
    ])
    for (const specifier of ['@e-mate/desktop', '@e-mate/desktop/updates', '@e-mate/desktop/terminal']) {
      const rejected = join(root, `desktop-rejected-${specifier.split('/').at(-1)}.js`)
      writeFileSync(rejected, `import ${JSON.stringify(specifier)}\n`)
      assert.throws(
        () => componentRuntimeImports([{ path: 'lib/index.js', source: rejected }]),
        /unsupported Desktop Base runtime import/u,
      )
    }
  })

  it('compares emitted runtime imports to the declared Base ABI', {
    skip: !componentRuntimeParserAvailable() && 'Harness toolchain is intentionally absent in the impact lane',
  }, () => {
    const source = join(root, 'declared-imports.js')
    writeFileSync(source, 'import { defineTool } from "@deepseek-ai/dsh-tools"\n')
    const component = { id: '@e-mate/test', base_imports: ['@deepseek-ai/dsh-tools'] }
    assert.deepEqual(verifyComponentRuntimeImports([{ path: 'lib/index.js', source }], component), [
      '@deepseek-ai/dsh-tools',
    ])
    component.base_imports = []
    assert.throws(
      () => verifyComponentRuntimeImports([{ path: 'lib/index.js', source }], component),
      /@e-mate\/test portable/u,
    )
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

  it('declares Schedule management as a read-only hot component over the native runtime', () => {
    const root = join(repositoryRoot, 'packages/dsh-plugin-schedules')
    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    const host = readFileSync(join(root, 'src/index.ts'), 'utf8')
    assert.equal(manifest.main, 'lib/index.js')
    assert.deepEqual(manifest.eMate.component.base_imports, ['@deepseek-ai/dsh-schedule'])
    assert.deepEqual(manifest.eMate.component.authority_contract, {
      effects: [],
      guards: ['read-only'],
    })
    assert.match(host, /from '@deepseek-ai\/dsh-schedule'/u)
    assert.match(host, /authority: 'loopback'/u)
    assert.doesNotMatch(host, /setInterval|setTimeout|schedule_create|schedule_delete/u)
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
