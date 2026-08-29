import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { after, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { baseSdkFingerprint } from './base-sdk.mjs'
import {
  ACCEPTED_PREDECESSOR,
  assertAcceptedPredecessor,
  BASE_CONTRACT_ID,
  classifyChangedPaths,
  harnessVersionsFromComponentLock,
  loadReleaseBoundary,
  PRODUCT_UI_REFERENCE,
} from './change-impact.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const FIXTURE_BASE_ID = BASE_CONTRACT_ID
const HARNESS_COMMIT = '1d3824bcd3400b3761a0ebdd956901752ddc962b'
const SOURCE_PREDECESSOR_BASE_CONTRACT_ID = 'e-mate-desktop-profile-v9-dsh-b469c2b99a6c'
const SOURCE_PREDECESSOR_HARNESS_COMMIT = 'b469c2b99a6c2f35c5e51eaf611f1941e095f90d'
const PREDECESSOR_BASE_CONTRACT_ID = 'e-mate-desktop-profile-v8-dsh-4787caf39134'
const PREDECESSOR_HARNESS_COMMIT = '4787caf39134df190105b272da0dd2ba893d4d75'
const RUNTIME_IMPORTS = [
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-runtime',
  '@deepseek-ai/dsh-client-ui-attachment',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-credentials',
  '@deepseek-ai/dsh-home-paths',
  '@deepseek-ai/dsh-llm',
  '@deepseek-ai/dsh-schedule',
  '@deepseek-ai/dsh-settings',
  '@deepseek-ai/dsh-skill',
  '@deepseek-ai/dsh-skill-filesystem',
  '@deepseek-ai/dsh-storage-domain',
  '@deepseek-ai/dsh-tools',
  '@deepseek-ai/schemastery',
  '@e-mate/desktop/vision-toolkit',
  'react',
  'react-dom',
]

function createAdmittedBoundaryFixture() {
  const checkout = mkdtempSync(join(tmpdir(), 'e-mate-admitted-boundary-'))
  const inventoryPath = 'packages/dsh/profile/component-inventory.json'
  const inventory = JSON.parse(readFileSync(join(root, inventoryPath), 'utf8'))
  const files = [
    'desktop/e-mate-desktop/base-contract.json',
    'desktop/e-mate-desktop/package.json',
    inventoryPath,
    ...inventory.components.flatMap(component => [
      `${component.root}/package.json`,
      `${component.root}/pnpm-lock.yaml`,
    ]),
  ]
  for (const file of files) {
    const destination = join(checkout, file)
    mkdirSync(dirname(destination), { recursive: true })
    copyFileSync(join(root, file), destination)
  }
  const basePath = join(checkout, 'desktop/e-mate-desktop/base-contract.json')
  const baseContract = JSON.parse(readFileSync(basePath, 'utf8'))
  baseContract.id = FIXTURE_BASE_ID
  delete baseContract.runtime_imports['@deepseek-ai/dsh-launch-environment']
  writeFileSync(basePath, `${JSON.stringify(baseContract, null, 2)}\n`)
  for (const component of inventory.components) {
    const path = join(checkout, component.root, 'package.json')
    const manifest = JSON.parse(readFileSync(path, 'utf8'))
    manifest.eMate.component.base_contracts = [FIXTURE_BASE_ID]
    writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`)
  }
  execFileSync('git', ['init', '--quiet'], { cwd: checkout })
  execFileSync('git', [
    'update-index', '--add', '--cacheinfo',
    `160000,${HARNESS_COMMIT},upstream/deepseek-harness`,
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
  const boundary = loadReleaseBoundary(checkout)
  assert.equal(boundary.valid, true, boundary.errors.join('\n'))
  return checkout
}

const admittedRoot = createAdmittedBoundaryFixture()
after(() => rmSync(admittedRoot, { recursive: true, force: true }))

function classify(...paths) {
  return classifyChangedPaths(paths, { root: admittedRoot, acceptedProfileCompatible: true })
}

function classifyWith(options, ...paths) {
  return classifyChangedPaths(paths, { root: admittedRoot, acceptedProfileCompatible: true, ...options })
}

describe('repository release boundary', () => {
  it('requires every candidate to descend from the accepted 2.0.11 commit', () => {
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
    const repositoryRoot = execFileSync('git', ['rev-list', '--max-parents=0', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
    }).trim()
    assert.doesNotThrow(() => assertAcceptedPredecessor(root, head))
    assert.throws(
      () => assertAcceptedPredecessor(root, repositoryRoot),
      new RegExp(`accepted 2\\.0\\.11 ${ACCEPTED_PREDECESSOR}`, 'u'),
    )
    const rejected = spawnSync(process.execPath, [
      'scripts/change-impact.mjs', '--base', repositoryRoot, '--head', repositoryRoot,
    ], { cwd: root, encoding: 'utf8' })
    assert.equal(rejected.status, 1)
    assert.match(
      JSON.parse(rejected.stdout).contract.errors.join('\n'),
      new RegExp(`accepted 2\\.0\\.11 ${ACCEPTED_PREDECESSOR}`, 'u'),
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
    const slice = readFileSync(new URL('../docs/slices/2.0.13.md', import.meta.url), 'utf8')
    const profile = readFileSync(new URL('../desktop/e-mate-desktop/src/profile.ts', import.meta.url), 'utf8')
    const profilePatch = readFileSync(new URL('../packages/dsh/profile/cordis.patch.yml', import.meta.url), 'utf8')
    const packagedGate = readFileSync(
      new URL('../desktop/e-mate-desktop/scripts/verify-packaged-runtime.ts', import.meta.url),
      'utf8',
    )

    assert.match(agents, /First development rule: use native DSH Creation Mode first/u)
    assert.match(agents, /resolve `desktop\/e-mate-desktop\/base-contract\.json` and the checked-in Harness\/Desktop-reference gitlinks/u)
    assert.match(agents, /default development path is the shipped rc\.7 `cordis` preset/u)
    assert.match(agents, /define\/run\/stop\/undefine and hot-replace lifecycle in the explicitly selected isolated local development session/u)
    assert.match(agents, /After every change, exercise the narrow real interaction and owning regression there immediately/u)
    assert.match(agents, /Creation Mode is the development inner loop, not a release format or admission bypass/u)
    assert.match(agents, /batch coherent changes only at version freeze/u)
    assert.match(agents, /receives no signing, R2, Feed, production desired-state/u)
    assert.match(agents, /never replaces installed-state, cross-platform, rollback, or release acceptance/u)
    assert.match(agents, /Base-only work instead follows the pinned Desktop lifecycle/u)
    assert.match(target, /First development principle: native Creation Mode before permanent plugins/u)
    assert.match(target, /“对照 DSH 原生” always means the Harness and Desktop-reference pins/u)
    assert.match(target, /shell-equivalent trust and is explicit opt-in/u)
    assert.match(slice, /2\.0\.13 Base v7 候选已按 bounded diff 原子固定为同一 rc\.7 的 `b2b1650b01f0ee88d81837a9b5c050f9f763f606`/u)
    assert.match(slice, /正式 Harness pin、Base v7 与 SDK 身份已在源码层对齐/u)
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
    const targetContract = readFileSync(new URL('../docs/target-contract.md', import.meta.url), 'utf8')

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
      /accepted installed e-Mate 2\.0\.11 artifact is the startup-performance baseline/u,
      /accepted e-Mate 2\.0\.11 commit `6a7f4b9d59a1d8970345638946fb6564e2f5f93e`.*native Desktop startup flow/u,
      /Startup timing remains an optional diagnostic/u,
      /Source tree is not the packaged product/u,
      /Only this stage may be called "released" or "online"/u,
    ]) assert.match(agents, invariant)

    assert.match(targetContract, /Performance evidence is optional diagnostics/u)
    assert.doesNotMatch(targetContract, /Startup never exceeds 15 seconds/u)
  })

  it('admits only the source-frozen successor Base and exact retained ABI union', () => {
    const boundary = loadReleaseBoundary(root)
    const t18 = JSON.parse(readFileSync(join(root, 'docs/2.0.15/evidence/T18.json'), 'utf8'))
    assert.equal(boundary.valid, true, boundary.errors.join('\n'))
    assert.deepEqual(boundary.errors, [])
    assert.equal(BASE_CONTRACT_ID, `e-mate-desktop-profile-v10-dsh-${HARNESS_COMMIT.slice(0, 12)}`)
    assert.equal(boundary.baseContract.id, BASE_CONTRACT_ID)
    assert.equal(boundary.baseContract.harness_commit, HARNESS_COMMIT)
    assert.equal(boundary.baseContract.schedule_protocol_floor, 1)
    assert.deepEqual(Object.keys(boundary.baseContract.runtime_imports), RUNTIME_IMPORTS)
    assert.equal(boundary.baseContract.runtime_imports['@e-mate/desktop/vision-toolkit'], '2.0.15')
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
    assert.equal(boundary.components.every(component => component.errors.length === 0), true)
    assert.deepEqual(boundary.components.flatMap(component => component.errors), [])
    assert.equal(boundary.components.length, 15)
    assert.equal(boundary.components.every(component => component.version === '2.0.15'), true)
    assert.equal(boundary.components.every(component => component.base_imports.every(name => RUNTIME_IMPORTS.includes(name))), true)
    assert.equal(boundary.components.every(component => component.desktop !== 'blocked'), true)
    assert.equal(boundary.components.some(component => component.root === 'packages/dsh-plugin-xin-assistant'), false)
    assert.equal(t18.formal_release_closeout.base_and_harness.base_contract_id, PREDECESSOR_BASE_CONTRACT_ID)
    assert.equal(t18.formal_release_closeout.base_and_harness.harness_commit, PREDECESSOR_HARNESS_COMMIT)
    assert.equal(t18.t21_successor_base_source_binding.predecessor_base_contract_id, PREDECESSOR_BASE_CONTRACT_ID)
    assert.equal(t18.t21_successor_base_source_binding.predecessor_harness_commit, PREDECESSOR_HARNESS_COMMIT)
    assert.equal(t18.session_draft_successor_base_source_binding.predecessor_base_contract_id, SOURCE_PREDECESSOR_BASE_CONTRACT_ID)
    assert.equal(t18.session_draft_successor_base_source_binding.predecessor_harness_commit, SOURCE_PREDECESSOR_HARNESS_COMMIT)
    const retired = JSON.parse(readFileSync(join(root, 'packages/dsh-plugin-search-mcp/package.json'), 'utf8'))
    assert.deepEqual(retired.eMate.component.base_contracts, ['e-mate-desktop-profile-v6-dsh-2bc16230975f'])
    assert.equal(retired.eMate.harnessCommit, '2bc16230975f6cf02aa1b283b1f86de44007b059')
    assert.equal(boundary.components.some(component => component.id === retired.name), false)
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
    const checkout = createAdmittedBoundaryFixture()
    try {
      const inventoryPath = 'packages/dsh/profile/component-inventory.json'
      assert.equal(existsSync(join(checkout, 'upstream/deepseek-harness/package.json')), false)
      const admittedBoundary = loadReleaseBoundary(checkout)
      assert.equal(admittedBoundary.valid, true)
      assert.equal(admittedBoundary.baseContract.id, FIXTURE_BASE_ID)
      assert.equal(admittedBoundary.components.length, 15)
      assert.deepEqual(admittedBoundary.components.filter(component => component.desktop === 'blocked'), [])

      const retirement = classifyChangedPaths([
        'packages/dsh-plugin-xin-assistant/src/index.ts',
        inventoryPath,
        'desktop/e-mate-desktop/scripts/verify-packaged-runtime.ts',
      ], { root: checkout, acceptedProfileCompatible: true })
      assert.equal(retirement.lane, 'base')
      assert.equal(retirement.run_base, true)
      assert.equal(retirement.run_plugins, false)
      assert.deepEqual(retirement.publish_components, [])
      const deletedXin = classifyChangedPaths([
        'packages/dsh-plugin-xin-assistant/runtime/vendor-native/darwin-arm64/library.dylib',
      ], { root: checkout, acceptedProfileCompatible: true })
      assert.equal(deletedXin.lane, 'base')
      assert.deepEqual(deletedXin.publish_components, [])

      const basePath = join(checkout, 'desktop/e-mate-desktop/base-contract.json')
      const admittedBaseBytes = readFileSync(basePath)
      const baseContract = JSON.parse(readFileSync(basePath, 'utf8'))
      baseContract.runtime_imports.react = '18.3.2'
      writeFileSync(basePath, `${JSON.stringify(baseContract, null, 2)}\n`)
      assert.match(loadReleaseBoundary(checkout).errors.join('\n'), /Base runtime import react must equal 18\.3\.2/u)
      writeFileSync(basePath, admittedBaseBytes)

      const missingFloor = JSON.parse(readFileSync(basePath, 'utf8'))
      delete missingFloor.schedule_protocol_floor
      writeFileSync(basePath, `${JSON.stringify(missingFloor, null, 2)}\n`)
      assert.match(loadReleaseBoundary(checkout).errors.join('\n'), /base contract fields are invalid/u)
      const invalidFloor = JSON.parse(admittedBaseBytes)
      invalidFloor.schedule_protocol_floor = 0
      writeFileSync(basePath, `${JSON.stringify(invalidFloor, null, 2)}\n`)
      assert.match(loadReleaseBoundary(checkout).errors.join('\n'), /schedule_protocol_floor must be 1/u)
      writeFileSync(basePath, admittedBaseBytes)

      const memoryPath = join(checkout, 'packages/dsh-plugin-memory-evolve/package.json')
      const admittedMemoryBytes = readFileSync(memoryPath)
      const memoryManifest = JSON.parse(readFileSync(memoryPath, 'utf8'))
      memoryManifest.eMate.component.base_imports = ['yaml']
      writeFileSync(memoryPath, `${JSON.stringify(memoryManifest, null, 2)}\n`)
      assert.match(loadReleaseBoundary(checkout).errors.join('\n'), /outside the fixed Base runtime ABI/u)
      writeFileSync(memoryPath, admittedMemoryBytes)

      const authorityManifest = JSON.parse(readFileSync(memoryPath, 'utf8'))
      authorityManifest.eMate.component.authority_contract.effects = ['filesystem-root']
      writeFileSync(memoryPath, `${JSON.stringify(authorityManifest, null, 2)}\n`)
      assert.match(loadReleaseBoundary(checkout).errors.join('\n'), /authority contract is invalid/u)
      writeFileSync(memoryPath, admittedMemoryBytes)

      const memoryLockPath = join(checkout, 'packages/dsh-plugin-memory-evolve/pnpm-lock.yaml')
      const admittedMemoryLockBytes = readFileSync(memoryLockPath)
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
      writeFileSync(memoryLockPath, admittedMemoryLockBytes)

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
    assert.deepEqual(one.ci_component_jobs, [{
      target: 'portable',
      runner: 'ubuntu-24.04',
      components: ['@e-mate/dsh-plugin-tool-search'],
      publish_components: ['@e-mate/dsh-plugin-tool-search'],
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

  it('keeps the public predecessor snapshot separate from the valid successor contract', () => {
    const path = 'packages/dsh/profile/plugins/emate-shell/src/client/sidebar.tsx'
    const current = classifyChangedPaths([path], { root })
    assert.equal(current.lane, 'base')
    assert.deepEqual(current.contract.errors, [])
    assert.equal(classifyChangedPaths([path], { root: admittedRoot, acceptedProfileCompatible: false }).lane, 'base')
    assert.equal(classifyChangedPaths([path], { root: admittedRoot, acceptedProfileCompatible: true }).lane, 'plugin-only')
    assert.equal(classifyChangedPaths([
      'packages/dsh/profile/plugins/emate-shell/tests/sidebar-home-fidelity.client.spec.tsx',
    ], { root: admittedRoot, acceptedProfileCompatible: false }).lane, 'plugin-only')
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
    assert.deepEqual(result.ci_component_jobs, [{
      target: 'portable',
      runner: 'ubuntu-24.04',
      components: ['@e-mate/dsh-plugin-skill-hub'],
      publish_components: ['@e-mate/dsh-plugin-skill-hub'],
    }])
  })

  it('keeps native Schedule management in its own hot component lane', () => {
    const result = classify(
      'packages/dsh-plugin-schedules/src/index.ts',
      'packages/dsh-plugin-schedules/test/contracts.test.mjs',
    )
    assert.equal(result.lane, 'plugin-only')
    assert.equal(result.run_base, false)
    assert.equal(result.portable_publish, true)
    assert.deepEqual(result.components, ['@e-mate/dsh-plugin-schedules'])
    assert.deepEqual(result.ci_component_jobs, [{
      target: 'portable',
      runner: 'ubuntu-24.04',
      components: ['@e-mate/dsh-plugin-schedules'],
      publish_components: ['@e-mate/dsh-plugin-schedules'],
    }])
  })

  it('keeps managed GPT web search inside the already accepted Tool Search hot component', () => {
    const result = classify(
      'packages/dsh-plugin-tool-search/src/web-search.ts',
      'packages/dsh-plugin-tool-search/test/web-search.test.mjs',
    )
    assert.equal(result.lane, 'plugin-only')
    assert.equal(result.run_base, false)
    assert.equal(result.portable_publish, true)
    assert.deepEqual(result.components, ['@e-mate/dsh-plugin-tool-search'])
    assert.deepEqual(result.ci_component_jobs, [{
      target: 'portable',
      runner: 'ubuntu-24.04',
      components: ['@e-mate/dsh-plugin-tool-search'],
      publish_components: ['@e-mate/dsh-plugin-tool-search'],
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

    const pureBase = classify('desktop/e-mate-desktop/src/main.ts')
    const baseAndEnterprise = classify('desktop/e-mate-desktop/src/main.ts', 'enterprise/apps/auth-gateway/src/index.ts')
    const componentAndEnterprise = classify('packages/dsh-plugin-memory-evolve/src/index.ts', 'enterprise/apps/auth-gateway/src/index.ts')
    assert.equal(pureBase.run_enterprise, false)
    assert.equal(baseAndEnterprise.lane, 'base')
    assert.equal(baseAndEnterprise.run_enterprise, true)
    assert.equal(componentAndEnterprise.lane, 'base')
    assert.equal(componentAndEnterprise.run_enterprise, true)

    const base = classify('desktop/e-mate-desktop/src/main.ts')
    assert.deepEqual(base.ci_base_platform_component_jobs, [
      {
        target: 'darwin-arm64', runner: 'macos-15',
        components: ['@e-mate/dsh-plugin-computer-use', '@e-mate/dsh-plugin-vision-toolkit'],
        publish_components: [],
      },
      {
        target: 'darwin-x64', runner: 'macos-15-intel',
        components: ['@e-mate/dsh-plugin-computer-use', '@e-mate/dsh-plugin-vision-toolkit'],
        publish_components: [],
      },
      {
        target: 'win32-x64', runner: 'windows-2025',
        components: ['@e-mate/dsh-plugin-computer-use', '@e-mate/dsh-plugin-vision-toolkit'],
        publish_components: [],
      },
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
    assert.equal(classify('packages/dsh-plugin-search-mcp/package.json').lane, 'base')

    const impact = classify('packages/dsh-plugin-computer-use/scripts/build.mjs')
    assert.equal(impact.portable_publish, false)
    assert.deepEqual(impact.ci_component_jobs, [
      {
        target: 'darwin-arm64', runner: 'macos-15',
        components: ['@e-mate/dsh-plugin-computer-use'],
        publish_components: ['@e-mate/dsh-plugin-computer-use'],
      },
      {
        target: 'darwin-x64', runner: 'macos-15-intel',
        components: ['@e-mate/dsh-plugin-computer-use'],
        publish_components: ['@e-mate/dsh-plugin-computer-use'],
      },
      {
        target: 'win32-x64', runner: 'windows-2025',
        components: ['@e-mate/dsh-plugin-computer-use'],
        publish_components: ['@e-mate/dsh-plugin-computer-use'],
      },
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
    assert.deepEqual(findSkill.ci_component_jobs, [{
      target: 'portable',
      runner: 'ubuntu-24.04',
      components: ['@e-mate/dsh-plugin-find-skill'],
      publish_components: ['@e-mate/dsh-plugin-find-skill'],
    }])

    const genui = classify('upstream/plugins/dsh-genui')
    assert.equal(genui.lane, 'plugin-only')
    assert.deepEqual(genui.components, ['@e-mate/dsh-plugin-genui'])
    assert.deepEqual(genui.ci_component_jobs, [{
      target: 'portable',
      runner: 'ubuntu-24.04',
      components: ['@e-mate/dsh-plugin-genui'],
      publish_components: ['@e-mate/dsh-plugin-genui'],
    }])

    const vision = classify('upstream/plugins/dsh-vision-toolkit')
    assert.equal(vision.lane, 'plugin-only')
    assert.deepEqual(vision.components, ['@e-mate/dsh-plugin-vision-toolkit'])
    assert.deepEqual(vision.ci_component_jobs, [
      {
        target: 'darwin-arm64', runner: 'macos-15',
        components: ['@e-mate/dsh-plugin-vision-toolkit'],
        publish_components: ['@e-mate/dsh-plugin-vision-toolkit'],
      },
      {
        target: 'darwin-x64', runner: 'macos-15-intel',
        components: ['@e-mate/dsh-plugin-vision-toolkit'],
        publish_components: ['@e-mate/dsh-plugin-vision-toolkit'],
      },
      {
        target: 'win32-x64', runner: 'windows-2025',
        components: ['@e-mate/dsh-plugin-vision-toolkit'],
        publish_components: ['@e-mate/dsh-plugin-vision-toolkit'],
      },
    ])
  })

  it('owns platform impact and the PR/release build plan without workflow path rules', () => {
    const shell = classify('packages/dsh/profile/plugins/emate-shell/src/index.ts')
    assert.equal(shell.ci_mode, 'pr-fast')
    assert.equal(shell.run_components, true)
    assert.equal(shell.compose_profile, false)
    assert.deepEqual(shell.ci, {
      app_smoke: { macos: true, windows: true },
      distribution: { macos: false, windows: false },
    })
    const skillHub = classify('packages/dsh-plugin-skill-hub/src/index.ts')
    assert.equal(skillHub.run_components, true)
    assert.deepEqual(skillHub.ci.app_smoke, { macos: false, windows: false })

    const runtime = classify('desktop/e-mate-desktop/src/main.ts')
    assert.deepEqual(runtime.ci, {
      app_smoke: { macos: true, windows: true },
      distribution: { macos: false, windows: false },
    })
    assert.equal(runtime.shared_runtime, true)
    assert.equal(runtime.macos_packaging, false)
    assert.equal(runtime.windows_packaging, false)

    const protectedRuntime = classifyWith(
      { protectedMain: true },
      'desktop/e-mate-desktop/src/main.ts',
    )
    assert.deepEqual(protectedRuntime.ci.distribution, { macos: true, windows: true })

    const macPackaging = classify('desktop/e-mate-desktop/scripts/package-mac.ts')
    assert.deepEqual(macPackaging.ci, {
      app_smoke: { macos: true, windows: false },
      distribution: { macos: false, windows: false },
    })
    assert.equal(macPackaging.macos_runtime, true)
    assert.equal(macPackaging.macos_packaging, true)

    const windowsRuntime = classify('desktop/e-mate-desktop/src/windows-directory-picker.ts')
    assert.equal(windowsRuntime.windows_runtime, true)
    assert.equal(windowsRuntime.windows_packaging, false)
    assert.deepEqual(windowsRuntime.ci, {
      app_smoke: { macos: false, windows: true },
      distribution: { macos: false, windows: false },
    })
    assert.deepEqual(classifyWith(
      { protectedMain: true },
      'desktop/e-mate-desktop/src/windows-directory-picker.ts',
    ).ci, {
      app_smoke: { macos: true, windows: true },
      distribution: { macos: true, windows: true },
    })

    const updater = classify('desktop/e-mate-desktop/src/update-checker.ts')
    assert.deepEqual(updater.ci.distribution, { macos: false, windows: false })
    assert.deepEqual(classifyWith(
      { protectedMain: true },
      'desktop/e-mate-desktop/src/update-checker.ts',
    ).ci.distribution, { macos: true, windows: true })
    assert.deepEqual(
      classify('desktop/e-mate-desktop/build/assistedMessages.yml').ci.distribution,
      { macos: false, windows: false },
    )

    const profile = classify('packages/dsh-plugin-tool-search/src/index.ts')
    assert.equal(profile.profile, true)
    const verifier = classify('scripts/performance-parity.mjs')
    assert.equal(verifier.release_verifier, true)
    assert.deepEqual(verifier.ci, {
      app_smoke: { macos: false, windows: false },
      distribution: { macos: false, windows: false },
    })

    const releaseCandidate = classifyWith(
      { protectedMain: true, releaseCandidate: true },
      'docs/development-log.md',
    )
    assert.deepEqual(releaseCandidate.ci, {
      app_smoke: { macos: true, windows: true },
      distribution: { macos: true, windows: true },
    })
    assert.equal(releaseCandidate.ci_mode, 'release-candidate')
    assert.equal(releaseCandidate.compose_profile, true)
    assert.equal(releaseCandidate.profile_bootstrap, false)
    assert.equal(releaseCandidate.components.length, 15)
    assert.equal(releaseCandidate.ci_component_jobs.every(job => job.target !== 'portable'), true)
    assert.equal(classifyWith(
      { releaseCandidate: true },
      'desktop/e-mate-desktop/src/main.ts',
    ).contract.valid, false)
    const protectedCli = spawnSync(process.execPath, [
      'scripts/change-impact.mjs', '--path', 'docs/development-log.md',
      '--protected-main', '--release-candidate', '--root', admittedRoot,
    ], { cwd: root, encoding: 'utf8' })
    assert.equal(protectedCli.status, 0, protectedCli.stderr)
    assert.equal(JSON.parse(protectedCli.stdout).lane, 'base')
    const unprotectedCli = spawnSync(process.execPath, [
      'scripts/change-impact.mjs', '--path', 'docs/development-log.md', '--release-candidate', '--root', admittedRoot,
    ], { cwd: root, encoding: 'utf8' })
    assert.equal(unprotectedCli.status, 1)
    const auditCli = spawnSync(process.execPath, [
      'scripts/change-impact.mjs', '--audit', '--root', admittedRoot,
    ], { cwd: root, encoding: 'utf8' })
    assert.equal(auditCli.status, 0, auditCli.stderr)
    assert.equal(JSON.parse(auditCli.stdout).ci_mode, 'audit')
    const currentContract = spawnSync(process.execPath, [
      'scripts/change-impact.mjs', '--check-contract',
    ], { cwd: root, encoding: 'utf8' })
    assert.equal(currentContract.status, 0, currentContract.stderr)
    assert.deepEqual(JSON.parse(currentContract.stdout).contract.errors, [])

    const enterprise = classify('enterprise/apps/auth-gateway/src/index.ts')
    assert.equal(enterprise.enterprise, true)
    assert.deepEqual(enterprise.ci, {
      app_smoke: { macos: false, windows: false },
      distribution: { macos: false, windows: false },
    })
    assert.deepEqual(classifyWith(
      { protectedMain: true },
      'packages/dsh-plugin-tool-search/src/index.ts',
    ).ci, {
      app_smoke: { macos: false, windows: false },
      distribution: { macos: false, windows: false },
    })
  })

  it('aggregates changed native components into one setup job per target', () => {
    const impact = classify(
      'packages/dsh-plugin-computer-use/src/index.ts',
      'packages/dsh-plugin-vision-toolkit/src/index.ts',
    )
    assert.equal(impact.component_jobs.length, 6)
    assert.equal(impact.component_jobs.every(job => (
      typeof job.component === 'string' && typeof job.publish === 'boolean'
    )), true)
    assert.equal(impact.ci_component_jobs.length, 3)
    for (const job of impact.ci_component_jobs) {
      assert.deepEqual(job.components, [
        '@e-mate/dsh-plugin-computer-use',
        '@e-mate/dsh-plugin-vision-toolkit',
      ])
      assert.deepEqual(job.publish_components, job.components)
    }
  })

  it('keeps the DSH-native CDP adapter in the component lane', () => {
    const impact = classify('packages/dsh-plugin-cdp/src/index.ts')
    assert.equal(impact.lane, 'plugin-only')
    assert.deepEqual(impact.components, ['@e-mate/dsh-plugin-cdp'])
  })

  it('keeps enterprise, verification, and docs changes out of product builds', () => {
    const enterprise = classify('enterprise/apps/auth-gateway/src/index.ts')
    assert.equal(enterprise.lane, 'enterprise-only')
    assert.equal(enterprise.run_enterprise, true)
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

  it('keeps both Profile composition jobs reachable through skipped ancestors', () => {
    const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8')
    assert.match(
      workflow,
      /profile-portable-composition:\n\s+name: Portable Profile generations\n\s+needs: \[impact, plugins\]\n\s+if: \$\{\{ always\(\) && needs\.impact\.result == 'success' && needs\.plugins\.result == 'success' && needs\.impact\.outputs\.compose_profile == 'true' && needs\.impact\.outputs\.publish_components_json != '\[\]' && needs\.impact\.outputs\.portable_publish == 'true' \}\}/u,
    )
    assert.match(
      workflow,
      /profile-composition:\n\s+name: Complete Profile generation \/ \$\{\{ matrix\.target \}\}\n\s+needs: \[impact, plugins\]\n\s+if: \$\{\{ always\(\) && needs\.impact\.result == 'success' && needs\.plugins\.result == 'success' && needs\.impact\.outputs\.compose_profile == 'true' && needs\.impact\.outputs\.publish_components_json != '\[\]' && needs\.impact\.outputs\.portable_publish != 'true' \}\}/u,
    )
  })

  it('makes the required CI admission consume one executable plan across PR, RC, and Audit lanes', () => {
    const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8')
    const audit = readFileSync(new URL('../.github/workflows/audit.yml', import.meta.url), 'utf8')
    const packageManifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
    assert.match(workflow, /name: e-mate-ci-plan-\$\{\{ steps\.classify\.outputs\.head_sha \}\}[\s\S]*?path: ci-plan\.json/u)
    for (const output of ['ci_mode', 'run_components', 'compose_profile', 'profile_bootstrap']) {
      assert.ok(workflow.includes(`${output}: \${{ steps.classify.outputs.${output} }}`), output)
    }
    assert.match(workflow, /plugins:\n[\s\S]*?needs: \[impact, source, component-base-sdk\][\s\S]*?run_components == 'true'/u)
    assert.match(workflow, /component-base-sdk:\n[\s\S]*?Build one recoverable Base SDK on cache miss[\s\S]*?node scripts\/component-run\.mjs check[\s\S]*?name: e-mate-base-sdk-/u)
    assert.match(workflow, /plugins:\n[\s\S]*?Download the exact Base SDK produced for this run[\s\S]*?node scripts\/base-sdk\.mjs install/u)
    assert.match(workflow, /source:\n[\s\S]*?pnpm test:harness-provenance[\s\S]*?Export already-built portable RC component payloads/u)
    assert.match(workflow, /profile-portable-composition:\n[\s\S]*?compose_profile == 'true'[\s\S]*?Download the exact Base SDK produced for this run/u)
    assert.match(workflow, /profile-composition:\n[\s\S]*?compose_profile == 'true'[\s\S]*?Download the exact Base SDK produced for this run/u)
    assert.equal(workflow.match(/--snapshot artifacts\/release\/profile-current-snapshot\.json\n\s+--materialize-current dist\/profile-current/gu)?.length, 2)
    assert.doesNotMatch(workflow, /curl[^]*desktop\/profile\/desired-state/u)
    assert.match(workflow, /profile_bootstrap != 'true'[\s\S]*?current_args=\(--bootstrap\)[\s\S]*?node scripts\/profile-release\.mjs/u)
    assert.match(workflow, /Overlay only the exact changed shell bytes[\s\S]*?component-release\.mjs materialize[\s\S]*?scripts\/package-dir\.mjs/u)
    assert.match(workflow, /Build and verify the formal unsigned Windows installer[\s\S]*?yarn dist:win/u)
    assert.match(workflow, /Build and verify the formal unsigned universal disk image[\s\S]*?yarn dist:mac-unsigned-release/u)
    assert.match(workflow, /admission:\n[\s\S]*?COMPOSE_PROFILE:[\s\S]*?case "\$LANE" in/u)
    assert.doesNotMatch(workflow, /^\s+paths(?:-ignore)?:/mu)
    assert.ok((workflow.match(/GITHUB_STEP_SUMMARY/gu)?.length ?? 0) >= 8)

    assert.match(audit, /node scripts\/change-impact\.mjs --audit --github-output "\$GITHUB_OUTPUT" > ci-plan\.json/u)
    assert.match(audit, /pnpm audit:full/u)
    assert.match(audit, /yarn verify:licenses/u)
    assert.doesNotMatch(audit, /profile-release\.yml|desktop-release\.yml|wrangler|r2-publish/u)
    for (const script of ['test:fast', 'check:affected', 'smoke:app-dir', 'verify:rc', 'audit:full']) {
      assert.equal(typeof packageManifest.scripts[script], 'string', script)
    }

    const coordinator = readFileSync(new URL('../.github/workflows/release-coordinator.yml', import.meta.url), 'utf8')
    assert.match(coordinator, /name: e-mate-ci-plan-\$\{\{ inputs\.source_sha \}\}/u)
    assert.match(coordinator, /"bootstrap":"\$\{\{ needs\.ci\.outputs\.profile_bootstrap \}\}"/u)
  })

  it('prepares publication only from already-built exact RC artifacts', () => {
    const workflow = readFileSync(new URL('../.github/workflows/profile-release.yml', import.meta.url), 'utf8')
    const verifier = readFileSync(new URL('./release-candidate.mjs', import.meta.url), 'utf8')
    assert.match(workflow, /source_sha="\$\(jq -er \.head_sha <<<"\$run_json"\)"/u)
    assert.match(workflow, /test "\$GITHUB_RUN_ATTEMPT" = 1/u)
    assert.match(workflow, /test "\$\{GITHUB_REF_PROTECTED:-\}" = true/u)
    assert.match(workflow, /node scripts\/release-candidate\.mjs verify/u)
    assert.match(verifier, /run\.conclusion !== 'success' \|\| run\.run_attempt !== 1/u)
    assert.match(verifier, /uniqueSuccessfulJob/u)
    assert.match(workflow, /name: e-mate-ci-plan-\$\{\{ steps\.run\.outputs\.source_sha \}\}/u)
    assert.doesNotMatch(workflow, /\.event[^\n]*= push/u)
    assert.match(workflow, /test "\$\(jq -er \.profile_bootstrap "\$plan"\)" = "\$BOOTSTRAP"/u)
    assert.match(workflow, /pattern: e-mate-component-\*-\$\{\{ needs\.validate\.outputs\.source_sha \}\}[\s\S]*?run-id: \$\{\{ inputs\.ci_run_id \}\}/u)
    for (const target of ['darwin-arm64', 'darwin-x64', 'win32-x64']) {
      assert.ok(workflow.includes(`name: e-mate-profile-candidate-${target}-\${{ needs.validate.outputs.source_sha }}`))
    }
    assert.match(workflow, /node scripts\/publish-profile-r2\.mjs/u)
    assert.match(workflow, /--snapshot artifacts\/release\/profile-current-snapshot\.json/u)
    assert.match(workflow, /--bundle dist\/profile-publication/u)
    assert.match(workflow, /EMATE_PROFILE_SIGNING_PRIVATE_KEY: \$\{\{ secrets\.EMATE_PROFILE_SIGNING_PRIVATE_KEY \}\}/u)
    assert.doesNotMatch(workflow, /bootstrap-plan:|bootstrap-components:|bootstrap-composition:/u)
    assert.doesNotMatch(workflow, /component-run\.mjs|build:harness|yarn (?:build|dist:)|package:dir/u)

    const publisher = readFileSync(new URL('./publish-profile-r2.mjs', import.meta.url), 'utf8')
    assert.match(publisher, /GITHUB_WORKFLOW_REF !== `\$\{REPOSITORY\}\/\.github\/workflows\/profile-release\.yml@refs\/heads\/main`/u)
    assert.match(publisher, /GITHUB_RUN_ATTEMPT !== '1'/u)
    assert.doesNotMatch(publisher, /\bfetch\s*\(/u)

    const ci = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8')
    assert.match(ci, /name: e-mate-component-source-portable-\$\{\{ needs\.impact\.outputs\.head_sha \}\}/u)
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
    assert.match(workflow, /name: Build pinned DeepSeek Harness\n\s+run: pnpm build:harness/u)
    assert.doesNotMatch(workflow, /pnpm --dir upstream\/deepseek-harness run build/u)
  })

  it('fails unknown or malformed paths closed to base', () => {
    const unknown = classify('new-unowned-root/file.ts')
    assert.equal(unknown.lane, 'base')
    assert.equal(unknown.run_enterprise, true)
    for (const dimension of [
      'shared_runtime', 'profile', 'macos_runtime', 'macos_packaging',
      'windows_runtime', 'windows_packaging', 'enterprise', 'release_verifier',
    ]) assert.equal(unknown[dimension], true, dimension)
    assert.deepEqual(unknown.ci, {
      app_smoke: { macos: true, windows: true },
      distribution: { macos: false, windows: false },
    })
    const invalid = classify('../outside')
    assert.equal(invalid.lane, 'base')
    assert.equal(invalid.contract.valid, false)
    assert.deepEqual(invalid.ci, {
      app_smoke: { macos: true, windows: true },
      distribution: { macos: false, windows: false },
    })
  })
})
