import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { baseSdkFingerprint } from './base-sdk.mjs'
import {
  ACCEPTED_PREDECESSOR,
  assertAcceptedPredecessor,
  classifyChangedPaths,
  harnessVersionsFromComponentLock,
  loadReleaseBoundary,
  PRODUCT_UI_REFERENCE,
} from './change-impact.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))

function classify(...paths) {
  return classifyChangedPaths(paths, { root })
}

describe('repository release boundary', () => {
  it('requires every candidate to descend from the accepted 2.0.10 commit', () => {
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
    const repositoryRoot = execFileSync('git', ['rev-list', '--max-parents=0', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
    }).trim()
    assert.doesNotThrow(() => assertAcceptedPredecessor(root, head))
    assert.throws(
      () => assertAcceptedPredecessor(root, repositoryRoot),
      new RegExp(`accepted 2\\.0\\.10 ${ACCEPTED_PREDECESSOR}`, 'u'),
    )
    const rejected = spawnSync(process.execPath, [
      'scripts/change-impact.mjs', '--base', repositoryRoot, '--head', repositoryRoot,
    ], { cwd: root, encoding: 'utf8' })
    assert.equal(rejected.status, 1)
    assert.match(
      JSON.parse(rejected.stdout).contract.errors.join('\n'),
      new RegExp(`accepted 2\\.0\\.10 ${ACCEPTED_PREDECESSOR}`, 'u'),
    )
  })

  it('keeps the deleted extension browser out of source and release vendor bytes', () => {
    for (const path of [
      'packages/dsh-plugin-browser',
      'packages/dsh-plugin-browser-panel',
      'desktop/e-mate-desktop/src/browser-extension-setup.ts',
    ]) assert.equal(existsSync(join(root, path)), false, path)
    assert.deepEqual(
      readdirSync(join(root, 'desktop/e-mate-desktop/vendor')).filter(name => /(?:dsh-browser|bridge-browser)/u.test(name)),
      [],
    )
  })

  it('makes native rc.7 Creation Mode the guarded development first rule', () => {
    const agents = readFileSync(new URL('../AGENTS.md', import.meta.url), 'utf8')
    const target = readFileSync(new URL('../docs/target-contract.md', import.meta.url), 'utf8')
    const profile = readFileSync(new URL('../desktop/e-mate-desktop/src/profile.ts', import.meta.url), 'utf8')
    const profilePatch = readFileSync(new URL('../packages/dsh/profile/cordis.patch.yml', import.meta.url), 'utf8')
    const packagedGate = readFileSync(
      new URL('../desktop/e-mate-desktop/scripts/verify-packaged-runtime.ts', import.meta.url),
      'utf8',
    )

    assert.match(agents, /First development rule: use native DSH Creation Mode first/u)
    assert.match(agents, /resolve `desktop\/e-mate-desktop\/base-contract\.json` and the checked-in Harness\/Desktop-reference gitlinks/u)
    assert.match(agents, /Creation Mode is the development inner loop, not a release format or admission bypass/u)
    assert.match(target, /First development principle: native Creation Mode before permanent plugins/u)
    assert.match(target, /“对照 DSH 原生” always means the Harness and Desktop-reference pins/u)
    assert.match(target, /shell-equivalent trust and is explicit opt-in/u)
    assert.match(profile, /roots:\s*\[\s*\{ path: managedPresetRoot\(profileDir\), trust: 'system' \},\s*\{ path: shippedPresetRoot\(\), trust: 'system' \}/u)
    assert.match(profilePatch, /id: ui-agent-preset\s+name: '@deepseek-ai\/dsh-client-ui-agent-preset'\s+disabled: false/u)
    for (const required of [
      'standard/agent.cordis.yml',
      'code/agent.cordis.yml',
      'minimal/agent.cordis.yml',
      'cordis/agent.cordis.yml',
      'cordis/skills/cordis-plugin-development/SKILL.md',
      'cordis/skills/editing-cordis-compositions/SKILL.md',
    ]) assert.match(packagedGate, new RegExp(required.replaceAll('.', '\\.'), 'u'), required)
  })

  it('locks the fast iteration, immutable publication, and 2.0.11 lessons into repository rules', () => {
    const agents = readFileSync(new URL('../AGENTS.md', import.meta.url), 'utf8')

    for (const heading of [
      'Fixed version iteration protocol',
      'Fast development loop',
      'Release lanes and immutable publication',
      '2.0.11 failure ledger: permanent rules',
      'Definition of done',
    ]) assert.match(agents, new RegExp(`^## ${heading.replaceAll('.', '\\.')}$`, 'mu'), heading)

    for (const invariant of [
      /actual installed production application is the runtime truth/u,
      /plugin-only` release must not build Base, DMG, EXE, or unchanged components/u,
      /Actions cache is never release evidence/u,
      /publication prepared.*not online/u,
      /CAS-activate stable pointers last/u,
      /previous_known_good = parent/u,
      /`mac-smoke` is CI-only and must never appear/u,
      /Full Access is only the DSH filesystem\/sandbox domain/u,
      /native CDP plugin first/u,
      /Source tree is not the packaged product/u,
      /Only this stage may be called "released" or "online"/u,
    ]) assert.match(agents, invariant)
  })

  it('accepts the checked-in base contract and every first-party component', () => {
    const boundary = loadReleaseBoundary(root)
    assert.equal(boundary.valid, true, boundary.errors.join('\n'))
    assert.equal(boundary.baseContract.id, 'e-mate-desktop-profile-v5-dsh-2bc16230975f')
    assert.equal(boundary.baseContract.runtime_imports['@e-mate/desktop/vision-toolkit'], '2.0.11')
    assert.deepEqual(PRODUCT_UI_REFERENCE, {
      repository: 'zyfjacksonchen-source/ECoreX',
      path: 'upstream/e-mate-2.0.5',
      commit: '564a6b6c1d43fb6831dd4a5cd8026e472f063311',
    })
    assert.deepEqual(boundary.baseContract.desktop_reference, {
      repository: 'anywhere-labs/deepseek-harness-desktop',
      commit: '6074088f5b660206e404b3591fab51fb99c69add',
      harness_repository: 'deepseek-ai/deepseek-harness',
      harness_commit: '99f6f02fecdb7dff40c3fbc9470f5907c29f74ca',
      harness_version: '0.1.0-rc.7',
    })
    assert.equal(boundary.components.length, 15)
    assert.equal(boundary.components.every(component => component.errors.length === 0), true)
    assert.deepEqual(boundary.components.flatMap(component => component.errors), [])
  })

  it('detects a transitive Harness version hidden in a component lock peer context', () => {
    assert.deepEqual(
      [...harnessVersionsFromComponentLock(
        "'@deepseek-ai/dsh-skill-filesystem@0.1.0-rc.7(@deepseek-ai/dsh-home-paths@0.1.0-rc.8)'",
      )].sort(),
      ['0.1.0-rc.7', '0.1.0-rc.8'],
    )
  })

  it('pins the Harness and product UI gitlinks while keeping component changes on the accepted Base SDK key', () => {
    const checkout = mkdtempSync(join(tmpdir(), 'e-mate-impact-checkout-'))
    try {
      const inventoryPath = 'packages/dsh/profile/component-inventory.json'
      const inventory = JSON.parse(readFileSync(join(root, inventoryPath), 'utf8'))
      const files = [
        'desktop/e-mate-desktop/base-contract.json',
        'desktop/e-mate-desktop/package.json',
        inventoryPath,
        ...inventory.components.flatMap(component => [
          `${component.root}/package.json`,
          ...(component.desktop === 'blocked' ? [] : [`${component.root}/pnpm-lock.yaml`]),
        ]),
      ]
      for (const file of files) {
        const destination = join(checkout, file)
        mkdirSync(dirname(destination), { recursive: true })
        copyFileSync(join(root, file), destination)
      }
      execFileSync('git', ['init', '--quiet'], { cwd: checkout })
      execFileSync('git', [
        'update-index', '--add', '--cacheinfo',
        '160000,2bc16230975f6cf02aa1b283b1f86de44007b059,upstream/deepseek-harness',
      ], { cwd: checkout })
      execFileSync('git', [
        'update-index', '--add', '--cacheinfo',
        `160000,${PRODUCT_UI_REFERENCE.commit},${PRODUCT_UI_REFERENCE.path}`,
      ], { cwd: checkout })
      for (const component of inventory.components) {
        const manifest = JSON.parse(readFileSync(join(checkout, component.root, 'package.json'), 'utf8'))
        for (const sourceRoot of component.source_roots ?? []) {
          execFileSync('git', [
            'update-index', '--add', '--cacheinfo',
            `160000,${manifest.dsh.upstream.commit},${sourceRoot}`,
          ], { cwd: checkout })
        }
      }
      execFileSync('git', ['add', '--', ...files], { cwd: checkout })

      assert.equal(existsSync(join(checkout, 'upstream/deepseek-harness/package.json')), false)
      assert.equal(loadReleaseBoundary(checkout).valid, true)

      const basePath = join(checkout, 'desktop/e-mate-desktop/base-contract.json')
      const baseContract = JSON.parse(readFileSync(basePath, 'utf8'))
      baseContract.runtime_imports.react = '18.3.2'
      writeFileSync(basePath, `${JSON.stringify(baseContract, null, 2)}\n`)
      assert.match(loadReleaseBoundary(checkout).errors.join('\n'), /Base runtime import react must equal 18\.3\.2/u)
      copyFileSync(join(root, 'desktop/e-mate-desktop/base-contract.json'), basePath)

      const memoryPath = join(checkout, 'packages/dsh-plugin-memory-evolve/package.json')
      const memoryManifest = JSON.parse(readFileSync(memoryPath, 'utf8'))
      memoryManifest.eMate.component.base_imports = ['yaml']
      writeFileSync(memoryPath, `${JSON.stringify(memoryManifest, null, 2)}\n`)
      assert.match(loadReleaseBoundary(checkout).errors.join('\n'), /outside the fixed Base runtime ABI/u)
      copyFileSync(join(root, 'packages/dsh-plugin-memory-evolve/package.json'), memoryPath)

      const authorityManifest = JSON.parse(readFileSync(memoryPath, 'utf8'))
      authorityManifest.eMate.component.authority_contract.effects = ['filesystem-root']
      writeFileSync(memoryPath, `${JSON.stringify(authorityManifest, null, 2)}\n`)
      assert.match(loadReleaseBoundary(checkout).errors.join('\n'), /authority contract is invalid/u)
      copyFileSync(join(root, 'packages/dsh-plugin-memory-evolve/package.json'), memoryPath)

      const memoryLockPath = join(checkout, 'packages/dsh-plugin-memory-evolve/pnpm-lock.yaml')
      writeFileSync(memoryLockPath, [
        "lockfileVersion: '9.0'",
        'importers:',
        '  .:',
        '    dependencies:',
        '      shared:',
        '        specifier: workspace:*',
        '        version: link:../shared',
        '',
      ].join('\n'))
      assert.match(
        loadReleaseBoundary(checkout).errors.join('\n'),
        /must not reference a local or workspace dependency/u,
      )
      copyFileSync(join(root, 'packages/dsh-plugin-memory-evolve/pnpm-lock.yaml'), memoryLockPath)

      const acceptedBase = baseSdkFingerprint(checkout)

      const componentProbe = 'packages/dsh-plugin-memory-evolve/src/fingerprint-probe.ts'
      mkdirSync(dirname(join(checkout, componentProbe)), { recursive: true })
      writeFileSync(join(checkout, componentProbe), 'export const probe = true\n')
      execFileSync('git', ['add', '--', componentProbe], { cwd: checkout })
      assert.equal(baseSdkFingerprint(checkout), acceptedBase)

      execFileSync('git', [
        'update-index', '--add', '--cacheinfo',
        `160000,${'d'.repeat(40)},${PRODUCT_UI_REFERENCE.path}`,
      ], { cwd: checkout })
      assert.match(
        loadReleaseBoundary(checkout).errors.join('\n'),
        /Git submodule commit does not match the fixed product UI reference/u,
      )
      execFileSync('git', [
        'update-index', '--add', '--cacheinfo',
        `160000,${PRODUCT_UI_REFERENCE.commit},${PRODUCT_UI_REFERENCE.path}`,
      ], { cwd: checkout })

      const computerUseManifestPath = 'packages/dsh-plugin-computer-use/package.json'
      const computerUseManifest = JSON.parse(readFileSync(join(checkout, computerUseManifestPath), 'utf8'))
      computerUseManifest.dsh.upstream.commit = 'b'.repeat(40)
      writeFileSync(join(checkout, computerUseManifestPath), `${JSON.stringify(computerUseManifest, null, 2)}\n`)
      execFileSync('git', ['add', '--', computerUseManifestPath], { cwd: checkout })
      execFileSync('git', [
        'update-index', '--add', '--cacheinfo',
        `160000,${'b'.repeat(40)},upstream/plugins/dsh-computer-use`,
      ], { cwd: checkout })
      assert.equal(loadReleaseBoundary(checkout).valid, true)
      assert.equal(baseSdkFingerprint(checkout), acceptedBase)

      execFileSync('git', [
        'update-index', '--add', '--cacheinfo',
        `160000,${'c'.repeat(40)},upstream/plugins/dsh-computer-use`,
      ], { cwd: checkout })
      assert.match(
        loadReleaseBoundary(checkout).errors.join('\n'),
        /component upstream commit must equal the upstream\/plugins\/dsh-computer-use Git submodule commit/u,
      )
      execFileSync('git', [
        'update-index', '--add', '--cacheinfo',
        `160000,${'b'.repeat(40)},upstream/plugins/dsh-computer-use`,
      ], { cwd: checkout })

      const desktopProbe = 'desktop/e-mate-desktop/src/fingerprint-probe.ts'
      mkdirSync(dirname(join(checkout, desktopProbe)), { recursive: true })
      writeFileSync(join(checkout, desktopProbe), 'export const probe = true\n')
      execFileSync('git', ['add', '--', desktopProbe], { cwd: checkout })
      assert.notEqual(baseSdkFingerprint(checkout), acceptedBase)

      execFileSync('git', [
        'update-index', '--add', '--cacheinfo',
        `160000,${'a'.repeat(40)},upstream/deepseek-harness`,
      ], { cwd: checkout })
      assert.match(
        loadReleaseBoundary(checkout).errors.join('\n'),
        /Git submodule commit does not match the Base contract/u,
      )
    } finally {
      rmSync(checkout, { recursive: true, force: true })
    }
  })

  it('admits one or several ordinary Profile component changes without a base build', () => {
    const one = classify('packages/dsh-plugin-tool-search/src/index.ts')
    assert.equal(one.lane, 'plugin-only')
    assert.equal(one.run_base, false)
    assert.equal(one.portable_publish, true)
    assert.deepEqual(one.components, ['@e-mate/dsh-plugin-tool-search'])
    assert.deepEqual(one.component_jobs, [{
      component: '@e-mate/dsh-plugin-tool-search',
      target: 'portable',
      runner: 'ubuntu-24.04',
      publish: true,
    }])

    const several = classify(
      'packages/dsh-plugin-memory-evolve/src/index.ts',
      'packages/dsh-plugin-office-skills/src/index.ts',
      'packages/dsh/profile/plugins/emate-shell/src/client/home.tsx',
    )
    assert.equal(several.lane, 'plugin-only')
    assert.equal(several.portable_publish, true)
    assert.deepEqual(several.components, [
      '@e-mate/dsh-client-shell',
      '@e-mate/dsh-plugin-memory-evolve',
      '@e-mate/dsh-plugin-office-skills',
    ])
  })

  it('keeps the Skill Hub Host, Agent tools, and UI in one hot component lane', () => {
    const result = classify(
      'packages/dsh-plugin-skill-hub/src/index.ts',
      'packages/dsh-plugin-skill-hub/src/skill-hub.ts',
      'packages/dsh-plugin-skill-hub/src/client/capabilities.tsx',
    )
    assert.equal(result.lane, 'plugin-only')
    assert.equal(result.run_base, false)
    assert.deepEqual(result.components, ['@e-mate/dsh-plugin-skill-hub'])
    assert.deepEqual(result.component_jobs, [{
      component: '@e-mate/dsh-plugin-skill-hub',
      target: 'portable',
      runner: 'ubuntu-24.04',
      publish: true,
    }])
  })

  it('runs the owning component gate for test-only changes without emitting release bytes', () => {
    const testsOnly = classify('packages/dsh-plugin-memory-evolve/test/index.test.mjs')
    assert.equal(testsOnly.lane, 'plugin-only')
    assert.equal(testsOnly.run_plugins, true)
    assert.equal(testsOnly.portable_publish, false)
    assert.deepEqual(testsOnly.components, ['@e-mate/dsh-plugin-memory-evolve'])
    assert.deepEqual(testsOnly.publish_components, [])

    const sourceAndTests = classify(
      'packages/dsh-plugin-memory-evolve/test/index.test.mjs',
      'packages/dsh-plugin-memory-evolve/src/index.ts',
    )
    assert.equal(sourceAndTests.lane, 'plugin-only')
    assert.equal(sourceAndTests.portable_publish, true)
    assert.deepEqual(sourceAndTests.publish_components, ['@e-mate/dsh-plugin-memory-evolve'])
  })

  it('promotes shared, Harness, Desktop, lock, and mixed enterprise changes to base', () => {
    for (const paths of [
      ['upstream/deepseek-harness'],
      ['packages/dsh/src/e-mate.ts'],
      ['desktop/e-mate-desktop/src/main.ts'],
      ['pnpm-lock.yaml'],
      ['packages/dsh-plugin-memory-evolve/src/index.ts', 'desktop/e-mate-desktop/src/main.ts'],
      ['packages/dsh-plugin-memory-evolve/src/index.ts', 'enterprise/apps/auth-gateway/src/index.ts'],
    ]) assert.equal(classify(...paths).lane, 'base', paths.join(', '))
    assert.equal(classify('packages/dsh-plugin-memory-evolve/pnpm-lock.yaml').lane, 'plugin-only')

    const base = classify('desktop/e-mate-desktop/src/main.ts')
    assert.deepEqual(base.base_platform_component_jobs, [
      { component: '@e-mate/dsh-plugin-computer-use', target: 'darwin-arm64', runner: 'macos-15', publish: false },
      { component: '@e-mate/dsh-plugin-computer-use', target: 'darwin-x64', runner: 'macos-15-intel', publish: false },
      { component: '@e-mate/dsh-plugin-computer-use', target: 'win32-x64', runner: 'windows-2025', publish: false },
      { component: '@e-mate/dsh-plugin-vision-toolkit', target: 'darwin-arm64', runner: 'macos-15', publish: false },
      { component: '@e-mate/dsh-plugin-vision-toolkit', target: 'darwin-x64', runner: 'macos-15-intel', publish: false },
      { component: '@e-mate/dsh-plugin-vision-toolkit', target: 'win32-x64', runner: 'windows-2025', publish: false },
    ])
  })

  it('admits platform components only through the complete native target matrix', () => {
    for (const path of [
      'upstream/plugins/dsh-computer-use',
      'packages/dsh-plugin-computer-use/native/macos/bin/helper',
      'packages/dsh-plugin-computer-use/scripts/build-native.mjs',
      'packages/dsh-plugin-computer-use/scripts/build.mjs',
      'packages/dsh-plugin-computer-use/overrides/helper-entitlements.plist',
    ]) assert.equal(classify(path).lane, 'plugin-only', path)

    assert.equal(classify('packages/dsh-plugin-xin-assistant/src/index.ts').lane, 'base')
    assert.equal(classify('packages/dsh-plugin-xin-assistant/runtime/vendor-native/darwin-arm64/library.dylib').lane, 'base')

    const impact = classify('packages/dsh-plugin-computer-use/scripts/build.mjs')
    assert.equal(impact.portable_publish, false)
    assert.deepEqual(impact.component_jobs, [
      { component: '@e-mate/dsh-plugin-computer-use', target: 'darwin-arm64', runner: 'macos-15', publish: true },
      { component: '@e-mate/dsh-plugin-computer-use', target: 'darwin-x64', runner: 'macos-15-intel', publish: true },
      { component: '@e-mate/dsh-plugin-computer-use', target: 'win32-x64', runner: 'windows-2025', publish: true },
    ])
  })

  it('assigns only declared external source gitlinks to their component owner', () => {
    const computerUse = classify('upstream/plugins/dsh-computer-use')
    assert.equal(computerUse.lane, 'plugin-only')
    assert.deepEqual(computerUse.components, ['@e-mate/dsh-plugin-computer-use'])
    assert.equal(computerUse.component_jobs.length, 3)

    const findSkill = classify('upstream/plugins/dsh-find-skill')
    assert.equal(findSkill.lane, 'plugin-only')
    assert.deepEqual(findSkill.components, ['@e-mate/dsh-plugin-find-skill'])
    assert.deepEqual(findSkill.component_jobs, [{
      component: '@e-mate/dsh-plugin-find-skill',
      target: 'portable',
      runner: 'ubuntu-24.04',
      publish: true,
    }])

    const genui = classify('upstream/plugins/dsh-genui')
    assert.equal(genui.lane, 'plugin-only')
    assert.deepEqual(genui.components, ['@e-mate/dsh-plugin-genui'])
    assert.deepEqual(genui.component_jobs, [{
      component: '@e-mate/dsh-plugin-genui',
      target: 'portable',
      runner: 'ubuntu-24.04',
      publish: true,
    }])

    const vision = classify('upstream/plugins/dsh-vision-toolkit')
    assert.equal(vision.lane, 'plugin-only')
    assert.deepEqual(vision.components, ['@e-mate/dsh-plugin-vision-toolkit'])
    assert.deepEqual(vision.component_jobs, [
      { component: '@e-mate/dsh-plugin-vision-toolkit', target: 'darwin-arm64', runner: 'macos-15', publish: true },
      { component: '@e-mate/dsh-plugin-vision-toolkit', target: 'darwin-x64', runner: 'macos-15-intel', publish: true },
      { component: '@e-mate/dsh-plugin-vision-toolkit', target: 'win32-x64', runner: 'windows-2025', publish: true },
    ])
  })

  it('keeps the DSH-native CDP adapter in the component lane', () => {
    const impact = classify('packages/dsh-plugin-cdp/src/index.ts')
    assert.equal(impact.lane, 'plugin-only')
    assert.deepEqual(impact.components, ['@e-mate/dsh-plugin-cdp'])
  })

  it('keeps enterprise, verification, and docs changes out of product builds', () => {
    assert.equal(classify('enterprise/apps/auth-gateway/src/index.ts').lane, 'enterprise-only')
    assert.equal(classify('scripts/change-impact.test.mjs').lane, 'verification-only')
    assert.equal(classify('docs/development-log.md').lane, 'docs-only')

    for (const path of ['AGENTS.md', 'docs/target-contract.md']) {
      const impact = classify(path)
      assert.equal(impact.lane, 'verification-only')
      assert.equal(impact.run_base, false)
      assert.equal(impact.run_plugins, false)
      assert.deepEqual(impact.publish_components, [])
    }
  })

  it('treats classifier and workflow authority changes as Base inputs', () => {
    assert.equal(classify('scripts/change-impact.mjs').lane, 'base')
    assert.equal(classify('.github/workflows/ci.yml').lane, 'base')
    assert.equal(classify('.github/workflows/profile-release.yml').lane, 'base')
  })

  it('makes the required CI admission consume only classifier outputs', () => {
    const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8')
    assert.match(workflow, /impact:\n(?:.|\n)*?pnpm\/action-setup@v4(?:.|\n)*?pnpm install --frozen-lockfile --ignore-scripts(?:.|\n)*?Test the fail-closed classifier/u)
    assert.match(workflow, /source:\n(?:.|\n)*?if: needs\.impact\.outputs\.run_base == 'true'/u)
    assert.match(workflow, /plugins:\n(?:.|\n)*?if: needs\.impact\.outputs\.run_plugins == 'true'/u)
    assert.match(workflow, /include: \$\{\{ fromJSON\(needs\.impact\.outputs\.component_jobs_json\) \}\}/u)
    assert.match(workflow, /base-platform-components:\n(?:.|\n)*?needs: \[impact, source\](?:.|\n)*?include: \$\{\{ fromJSON\(needs\.impact\.outputs\.base_platform_component_jobs_json\) \}\}/u)
    assert.match(workflow, /name: Prepare the exact component Python runtime(?:.|\n)*?prepare-python-runtime\.mjs --target "\$TARGET"(?:.|\n)*?EMATE_BUILD_PYTHON: \$\{\{ steps\.component-python\.outputs\.python \}\}/u)
    assert.doesNotMatch(workflow, /python-version: '3\.12\.14'/u)
    assert.match(workflow, /name: Test the accepted platform component against the new Base\n\s+shell: bash[^]*?node scripts\/component-run\.mjs check --component "\$COMPONENT"/u)
    assert.match(workflow, /name: Export the exact accepted Base SDK run artifact(?:.|\n)*?name: e-mate-base-sdk-\$\{\{ needs\.impact\.outputs\.head_sha \}\}(?:.|\n)*?include-hidden-files: true(?:.|\n)*?retention-days: 30/u)
    assert.match(workflow, /runs-on: \$\{\{ matrix\.runner \}\}/u)
    assert.match(workflow, /name: Build and test only the changed component\n\s+shell: bash[^]*?node scripts\/component-run\.mjs check --component "\$COMPONENT"/u)
    assert.match(workflow, /if: matrix\.publish == true/u)
    assert.match(workflow, /profile-portable-composition:\n(?:.|\n)*?name: Portable Profile generations(?:.|\n)*?needs: \[impact, plugins\](?:.|\n)*?portable_publish == 'true'(?:.|\n)*?runs-on: macos-15(?:.|\n)*?Compose every target and boot the portable graph once/u)
    assert.match(workflow, /for target in darwin-arm64 darwin-x64 win32-x64;(?:.|\n)*?node scripts\/profile-release\.mjs(?:.|\n)*?pids\+=\("\$!"\)(?:.|\n)*?wait "\$pid"(?:.|\n)*?verify-profile-boot\.mjs(?:.|\n)*?--target darwin-arm64/u)
    assert.match(workflow, /profile-composition:\n(?:.|\n)*?needs: \[impact, plugins\](?:.|\n)*?portable_publish != 'true'(?:.|\n)*?Compose and boot the complete candidate generation/u)
    assert.match(workflow, /node scripts\/base-sdk\.mjs fingerprint/u)
    assert.match(workflow, /node scripts\/profile-release\.mjs(?:.|\n)*?verify-profile-boot\.mjs/u)
    assert.match(workflow, /if test "\$BASE_SHA" = 0000000000000000000000000000000000000000;(?:.|\n)*?ACCEPTED_PREDECESSOR/u)
    assert.match(workflow, /name: e-mate-change-impact-\$\{\{ steps\.classify\.outputs\.head_sha \}\}/u)
    assert.match(workflow, /enterprise:\n(?:.|\n)*?if: needs\.impact\.outputs\.run_enterprise == 'true'/u)
    assert.match(workflow, /admission:\n(?:.|\n)*?case "\$LANE" in(?:.|\n)*?plugin-only\)(?:.|\n)*?test "\$PORTABLE_PUBLISH" = true;(?:.|\n)*?test "\$PROFILE_PORTABLE" = success(?:.|\n)*?test "\$PROFILE" = skipped(?:.|\n)*?test "\$SOURCE" = skipped(?:.|\n)*?test "\$WINDOWS" = skipped(?:.|\n)*?test "\$MACOS" = skipped/u)
    assert.match(workflow, /base\)(?:.|\n)*?test "\$BASE_PLATFORM_COMPONENTS" = success/u)
    assert.doesNotMatch(workflow, /^\s+paths(?:-ignore)?:/mu)
  })

  it('prepares only an already admitted complete component generation for native Cloudflare publication', () => {
    const workflow = readFileSync(new URL('../.github/workflows/profile-release.yml', import.meta.url), 'utf8')
    assert.match(workflow, /source_sha="\$\(jq -er \.head_sha <<<"\$run_json"\)"/u)
    assert.match(workflow, /test "\$\(jq -er \.conclusion <<<"\$run_json"\)" = success/u)
    assert.match(workflow, /push\)(?:.|\n)*?test "\$source_sha" = "\$GITHUB_SHA"(?:.|\n)*?pull_request\)(?:.|\n)*?commits\/\$source_sha\/pulls(?:.|\n)*?\.merged_at != null(?:.|\n)*?\.merge_commit_sha(?:.|\n)*?\.base\.sha(?:.|\n)*?git\/commits\/\$source_sha(?:.|\n)*?\$merge_sha\^\{tree\}(?:.|\n)*?git diff --no-renames --name-only -z "\$merge_sha" "\$GITHUB_SHA"/u)
    assert.match(workflow, /name: e-mate-change-impact-\$\{\{ steps\.run\.outputs\.source_sha \}\}/u)
    assert.match(workflow, /job_succeeded 'CI admission'/u)
    assert.match(workflow, /if test "\$\(jq -er \.portable_publish "\$impact"\)" = true;(?:.|\n)*?job_succeeded 'Portable Profile generations'(?:.|\n)*?Complete Profile generation \/ \$target/u)
    assert.doesNotMatch(workflow, /if test "\$BOOTSTRAP" = true; then[^]*?publish_components[^]*?= '\[\]'/u)
    assert.match(workflow, /node scripts\/component-release\.mjs inventory > component-inventory\.json/u)
    assert.match(workflow, /Bootstrap complete Profile generation \/ \$\{\{ matrix\.target \}\}/u)
    assert.match(workflow, /node desktop\/e-mate-desktop\/scripts\/verify-profile-boot\.mjs/u)
    assert.match(workflow, /prepare-python-runtime\.mjs --target "\$TARGET"/u)
    assert.doesNotMatch(workflow, /python-version: '3\.12\.14'/u)
    assert.match(workflow, /node scripts\/publish-profile-r2\.mjs/u)
    assert.match(workflow, /--bundle dist\/profile-publication/u)
    assert.match(workflow, /e-mate-profile-native-cloudflare-publication-/u)
    assert.match(workflow, /EXPECTED_CHANGED_COMPONENTS_JSON:/u)
    assert.match(workflow, /changed_args\+=\(--changed "\$component"\)/u)
    assert.match(workflow, /EMATE_PROFILE_SIGNING_PRIVATE_KEY: \$\{\{ secrets\.EMATE_PROFILE_SIGNING_PRIVATE_KEY \}\}/u)
    assert.match(workflow, /EMATE_ACCEPTED_CI_RUN_ID: \$\{\{ inputs\.ci_run_id \}\}/u)
    assert.match(workflow, /EMATE_ACCEPTED_SOURCE_SHA: \$\{\{ needs\.validate\.outputs\.source_sha \}\}/u)
    assert.match(workflow, /environment: r2-publish/u)
    assert.doesNotMatch(workflow, /ECOREX_R2_ACCESS_KEY_ID|ECOREX_R2_SECRET_ACCESS_KEY|AWS_ACCESS_KEY_ID/u)
    assert.match(workflow, /name: Build and test the target component\n\s+shell: bash[^]*?node scripts\/component-run\.mjs check --component "\$COMPONENT"/u)
    assert.doesNotMatch(workflow, /pnpm --dir upstream\/deepseek-harness run build/u)
    assert.doesNotMatch(workflow, /yarn (?:build|dist:)/u)

    const bootstrapComponents = workflow.slice(
      workflow.indexOf('  bootstrap-components:'),
      workflow.indexOf('  bootstrap-composition:'),
    )
    const bootstrapComposition = workflow.slice(
      workflow.indexOf('  bootstrap-composition:'),
      workflow.indexOf('  prepare-publication:'),
    )
    for (const job of [bootstrapComponents, bootstrapComposition]) {
      assert.match(job, /name: Download the exact accepted Base SDK run artifact/u)
      assert.match(job, /name: e-mate-base-sdk-\$\{\{ needs\.validate\.outputs\.source_sha \}\}/u)
      assert.match(job, /github-token: \$\{\{ secrets\.GITHUB_TOKEN \}\}/u)
      assert.match(job, /run-id: \$\{\{ inputs\.ci_run_id \}\}/u)
      assert.doesNotMatch(job, /actions\/cache\/restore@v4|base-sdk\.mjs fingerprint|cache-hit/u)
    }

    const publisher = readFileSync(new URL('./publish-profile-r2.mjs', import.meta.url), 'utf8')
    assert.match(publisher, /GITHUB_WORKFLOW_REF !== `\$\{REPOSITORY\}\/\.github\/workflows\/profile-release\.yml@refs\/heads\/main`/u)

    const ci = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8')
    const portableCandidateUpload = ci.match(/name: e-mate-profile-candidate-darwin-arm64-\$\{\{ needs\.impact\.outputs\.head_sha \}\}[^]*?retention-days: 7/u)?.[0]
    assert.ok(portableCandidateUpload)
    assert.doesNotMatch(portableCandidateUpload, /\/store(?:\s|$)/u)
    const candidateUpload = ci.match(/name: e-mate-profile-candidate-\$\{\{ matrix\.target \}\}[^]*?retention-days: 7/u)?.[0]
    assert.ok(candidateUpload)
    assert.doesNotMatch(candidateUpload, /\/store(?:\s|$)/u)
  })

  it('keeps the full carrier release manual instead of rebuilding it for every plugin change', () => {
    const workflow = readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8')
    assert.match(workflow, /^on:\n\s+workflow_dispatch:/mu)
    assert.doesNotMatch(workflow, /^\s+(?:pull_request|push):/mu)
  })

  it('fails unknown or malformed paths closed to base', () => {
    assert.equal(classify('new-unowned-root/file.ts').lane, 'base')
    const invalid = classify('../outside')
    assert.equal(invalid.lane, 'base')
    assert.equal(invalid.contract.valid, false)
  })
})
