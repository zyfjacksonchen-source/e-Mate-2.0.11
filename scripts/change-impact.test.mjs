import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { baseSdkFingerprint } from './base-sdk.mjs'
import { classifyChangedPaths, loadReleaseBoundary } from './change-impact.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))

function classify(...paths) {
  return classifyChangedPaths(paths, { root })
}

describe('repository release boundary', () => {
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
    assert.match(agents, /Creation Mode is the development inner loop, not a release format or admission bypass/u)
    assert.match(target, /First development principle: native Creation Mode before permanent plugins/u)
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

  it('accepts the checked-in base contract and every first-party component', () => {
    const boundary = loadReleaseBoundary(root)
    assert.equal(boundary.valid, true, boundary.errors.join('\n'))
    assert.equal(boundary.baseContract.id, 'e-mate-desktop-profile-v1-dsh-df78045a127e')
    assert.deepEqual(boundary.baseContract.desktop_reference, {
      repository: 'anywhere-labs/deepseek-harness-desktop',
      commit: '6074088f5b660206e404b3591fab51fb99c69add',
      harness_repository: 'deepseek-ai/deepseek-harness',
      harness_commit: '99f6f02fecdb7dff40c3fbc9470f5907c29f74ca',
      harness_version: '0.1.0-rc.7',
    })
    assert.equal(boundary.components.length, 14)
    assert.equal(boundary.components.every(component => component.errors.length === 0), true)
    assert.deepEqual(boundary.components.flatMap(component => component.errors), [])
  })

  it('pins the Harness gitlink while keeping component changes on the accepted Base SDK key', () => {
    const checkout = mkdtempSync(join(tmpdir(), 'e-mate-impact-checkout-'))
    try {
      const inventoryPath = 'packages/dsh/profile/component-inventory.json'
      const inventory = JSON.parse(readFileSync(join(root, inventoryPath), 'utf8'))
      const files = [
        'desktop/e-mate-desktop/base-contract.json',
        'desktop/e-mate-desktop/package.json',
        inventoryPath,
        ...inventory.components.map(component => `${component.root}/package.json`),
      ]
      for (const file of files) {
        const destination = join(checkout, file)
        mkdirSync(dirname(destination), { recursive: true })
        copyFileSync(join(root, file), destination)
      }
      execFileSync('git', ['init', '--quiet'], { cwd: checkout })
      execFileSync('git', [
        'update-index', '--add', '--cacheinfo',
        '160000,df78045a127e32cb5b942defba52c539590d1596,upstream/deepseek-harness',
      ], { cwd: checkout })
      execFileSync('git', ['add', '--', ...files], { cwd: checkout })

      assert.equal(existsSync(join(checkout, 'upstream/deepseek-harness/package.json')), false)
      assert.equal(loadReleaseBoundary(checkout).valid, true)
      const acceptedBase = baseSdkFingerprint(checkout)

      const componentProbe = 'packages/dsh-plugin-memory-evolve/src/fingerprint-probe.ts'
      mkdirSync(dirname(join(checkout, componentProbe)), { recursive: true })
      writeFileSync(join(checkout, componentProbe), 'export const probe = true\n')
      execFileSync('git', ['add', '--', componentProbe], { cwd: checkout })
      assert.equal(baseSdkFingerprint(checkout), acceptedBase)

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
    const one = classify('packages/dsh-plugin-memory-evolve/src/index.ts')
    assert.equal(one.lane, 'plugin-only')
    assert.equal(one.run_base, false)
    assert.deepEqual(one.components, ['@e-mate/dsh-plugin-memory-evolve'])
    assert.deepEqual(one.component_jobs, [{
      component: '@e-mate/dsh-plugin-memory-evolve',
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
    assert.deepEqual(testsOnly.components, ['@e-mate/dsh-plugin-memory-evolve'])
    assert.deepEqual(testsOnly.publish_components, [])

    const sourceAndTests = classify(
      'packages/dsh-plugin-memory-evolve/test/index.test.mjs',
      'packages/dsh-plugin-memory-evolve/src/index.ts',
    )
    assert.equal(sourceAndTests.lane, 'plugin-only')
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
  })

  it('admits platform components only through the complete native target matrix', () => {
    for (const path of [
      'packages/dsh-plugin-computer-use/native/macos/bin/helper',
      'packages/dsh-plugin-computer-use/scripts/build-native.mjs',
      'packages/dsh-plugin-computer-use/scripts/build.mjs',
      'packages/dsh-plugin-computer-use/overrides/helper-entitlements.plist',
      'packages/dsh-plugin-xin-assistant/src/index.ts',
      'packages/dsh-plugin-xin-assistant/runtime/vendor-native/darwin-arm64/library.dylib',
    ]) assert.equal(classify(path).lane, 'plugin-only', path)

    const impact = classify('packages/dsh-plugin-computer-use/scripts/build.mjs')
    assert.deepEqual(impact.component_jobs, [
      { component: '@e-mate/dsh-plugin-computer-use', target: 'darwin-arm64', runner: 'macos-15', publish: true },
      { component: '@e-mate/dsh-plugin-computer-use', target: 'darwin-x64', runner: 'macos-15-intel', publish: true },
      { component: '@e-mate/dsh-plugin-computer-use', target: 'win32-x64', runner: 'windows-2025', publish: true },
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
  })

  it('treats classifier and workflow authority changes as Base inputs', () => {
    assert.equal(classify('scripts/change-impact.mjs').lane, 'base')
    assert.equal(classify('.github/workflows/ci.yml').lane, 'base')
    assert.equal(classify('.github/workflows/profile-release.yml').lane, 'base')
  })

  it('makes the required CI admission consume only classifier outputs', () => {
    const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8')
    assert.match(workflow, /source:\n(?:.|\n)*?if: needs\.impact\.outputs\.run_base == 'true'/u)
    assert.match(workflow, /plugins:\n(?:.|\n)*?if: needs\.impact\.outputs\.run_plugins == 'true'/u)
    assert.match(workflow, /include: \$\{\{ fromJSON\(needs\.impact\.outputs\.component_jobs_json\) \}\}/u)
    assert.match(workflow, /runs-on: \$\{\{ matrix\.runner \}\}/u)
    assert.match(workflow, /if: matrix\.publish == true/u)
    assert.match(workflow, /profile-composition:\n(?:.|\n)*?needs: \[impact, plugins\](?:.|\n)*?publish_components_json != '\[\]'(?:.|\n)*?Compose and boot the complete candidate generation/u)
    assert.match(workflow, /node scripts\/base-sdk\.mjs fingerprint/u)
    assert.match(workflow, /node scripts\/profile-release\.mjs(?:.|\n)*?verify-profile-boot\.mjs/u)
    assert.match(workflow, /enterprise:\n(?:.|\n)*?if: needs\.impact\.outputs\.run_enterprise == 'true'/u)
    assert.match(workflow, /admission:\n(?:.|\n)*?case "\$LANE" in(?:.|\n)*?plugin-only\)(?:.|\n)*?test "\$PROFILE" = success(?:.|\n)*?test "\$SOURCE" = skipped(?:.|\n)*?test "\$WINDOWS" = skipped(?:.|\n)*?test "\$MACOS" = skipped/u)
    assert.doesNotMatch(workflow, /^\s+paths(?:-ignore)?:/mu)
  })

  it('publishes only an already admitted complete component generation', () => {
    const workflow = readFileSync(new URL('../.github/workflows/profile-release.yml', import.meta.url), 'utf8')
    assert.match(workflow, /test "\$\(jq -er \.head_sha <<<"\$run_json"\)" = "\$GITHUB_SHA"/u)
    assert.match(workflow, /test "\$\(jq -er \.conclusion <<<"\$run_json"\)" = success/u)
    assert.match(workflow, /job_succeeded 'CI admission'/u)
    assert.match(workflow, /node scripts\/component-release\.mjs inventory > component-inventory\.json/u)
    assert.match(workflow, /Bootstrap complete Profile generation \/ \$\{\{ matrix\.target \}\}/u)
    assert.match(workflow, /node desktop\/e-mate-desktop\/scripts\/verify-profile-boot\.mjs/u)
    assert.match(workflow, /node scripts\/publish-profile-r2\.mjs/u)
    assert.match(workflow, /EMATE_PROFILE_SIGNING_PRIVATE_KEY: \$\{\{ secrets\.EMATE_PROFILE_SIGNING_PRIVATE_KEY \}\}/u)
    assert.match(workflow, /environment: r2-publish/u)
    assert.doesNotMatch(workflow, /pnpm --dir upstream\/deepseek-harness run build/u)
    assert.doesNotMatch(workflow, /yarn (?:build|dist:)/u)

    const publisher = readFileSync(new URL('./publish-profile-r2.mjs', import.meta.url), 'utf8')
    assert.match(publisher, /GITHUB_WORKFLOW_REF !== `\$\{REPOSITORY\}\/\.github\/workflows\/profile-release\.yml@refs\/heads\/main`/u)

    const ci = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8')
    const candidateUpload = ci.match(/name: e-mate-profile-candidate-\$\{\{ matrix\.target \}\}[^]*?retention-days: 7/u)?.[0]
    assert.ok(candidateUpload)
    assert.doesNotMatch(candidateUpload, /\/store(?:\s|$)/u)
  })

  it('fails unknown or malformed paths closed to base', () => {
    assert.equal(classify('new-unowned-root/file.ts').lane, 'base')
    const invalid = classify('../outside')
    assert.equal(invalid.lane, 'base')
    assert.equal(invalid.contract.valid, false)
  })
})
