import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createHash, generateKeyPairSync } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createServer } from 'node:http'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { unzipSync } from 'fflate'
import { parse as parseYaml } from 'yaml'
import { Context } from '../../../upstream/deepseek-harness/vendor/cordis/lib/index.js'
import { LocalAttachmentStore } from '../../../upstream/deepseek-harness/packages/attachment/attachment-local/lib/index.js'
import { FileSettingsProvider } from '../../../upstream/deepseek-harness/packages/settings/settings-file/lib/index.js'

import {
  HARNESS_COMMIT,
  HARNESS_VERSION,
  checkEnvironment,
  latestUpdateReceipt,
  managedStatus,
  nodeVersionSupported,
  platformSupported,
  resolveHarness,
  resolveHarnessModule,
} from '../lib/e-mate.js'
import { installTestProfile as installProfile } from './runtime-binding.fixture.mjs'
import { apply as applyHealth } from '../profile/plugins/health.js'
import { apply as applyShare, SHARE_CHANNEL } from '../profile/plugins/share.js'
import { apply as applyGeneralWorkspace } from '../profile/plugins/general-workspace.js'
import * as settingsDocumentBoundary from '../profile/plugins/settings-document-boundary.js'
import { apply as applyAgentOperations } from '../profile/plugins/agent-operations.js'
import { apply as applyShell } from '../profile/plugins/emate-shell/index.js'
import { apply as applyCapabilities, CAPABILITIES_CHANNEL } from '../profile/plugins/capabilities.js'
import { apply as applyQrGeneration } from '../profile/plugins/qr-generation.js'
import {
  CredentialStore,
  checkOsCredentialBackend,
  createOsCredentialBackend,
} from '../profile/plugins/credentials-os.js'
import { apply as applyImageGeneration } from '../profile/plugins/image-generation.js'
import {
  apply as applyModelPolicy,
  createQuotaService,
  MODEL_POLICY_CHANNEL,
  validateModelPolicy,
} from '../profile/plugins/model-policy.js'
import { apply as applyAudit, AUDIT_CHANNEL, createTaskAuditFact, createUsageFact } from '../profile/plugins/audit.js'
import {
  apply as applyIdentity,
  createEnterpriseIdentityProvider,
  ENTERPRISE_KEEP_ALIVE_MS,
  IDENTITY_CHANNEL,
  MODEL_SESSION_REF,
} from '../profile/plugins/identity/index.js'
import {
  agreementBundleSha256,
  agreementDocuments,
  describeAgreements,
  requiredAcknowledgements,
} from '../profile/plugins/identity/agreements.js'
import {
  claimUpdateLock,
  compareVersions,
  globalPrefixForBinPath,
  normalizeUpdateTarget,
  parsePackageIntegrity,
  releaseUpdateLock,
  validateReleaseManifest,
  validateReleaseSource,
  validateLatestReleasePointer,
  validateStagedVersion,
  validateUpdateRequest,
} from '../lib/update.js'

const fileDigest = path => createHash('sha256').update(readFileSync(path)).digest('hex')

test('resolved Harness modules use source builds and file URLs for Windows ESM imports', () => {
  const source = readFileSync(new URL('../src/e-mate.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /import\(harnessRequire\.resolve\(/)
  assert.equal(source.match(/import\(pathToFileURL\(resolveHarnessModule\(/g)?.length, 3)
  const root = resolve(new URL('../../../upstream/deepseek-harness/', import.meta.url).pathname)
  assert.equal(resolveHarnessModule({ bin: join(root, 'apps', 'cli', 'lib', 'bin.js') },
    'packages/storage/storage-domain', '@deepseek-ai/dsh-storage-domain'),
  join(root, 'packages', 'storage', 'storage-domain', 'lib', 'index.js'))
})

test('validated identity transitions restore the protected route before reloading one enterprise snapshot', () => {
  const source = readFileSync(new URL('../profile/plugins/emate-shell/src/client/identity.tsx', import.meta.url), 'utf8')
  const login = source.slice(source.indexOf('  const login = async'), source.indexOf('  const issueChallenge'))
  const acceptance = source.slice(source.indexOf('  const accept = async'), source.indexOf("  if (mode === 'unlocked') return null"))
  for (const transition of [login, acceptance]) {
    const validation = transition.indexOf('validBootstrap(result.value)')
    const restore = transition.indexOf("history.replaceState(null, '', returnPath)")
    const reload = transition.indexOf('location.reload()')
    assert.ok(validation >= 0 && restore > validation && reload > restore)
    assert.doesNotMatch(transition, /setState\(result\.value\)/)
  }
  assert.match(source, /addEventListener\('popstate', sync\)/)
  assert.match(source, /removeEventListener\('popstate', sync\)/)
})

test('settings URL is a lifecycle projection over the target SettingsRoot state', () => {
  const source = readFileSync(new URL('../profile/plugins/emate-shell/src/client/settings-chrome.tsx', import.meta.url), 'utf8')
  const sidebar = readFileSync(new URL('../profile/plugins/emate-shell/src/client/sidebar.tsx', import.meta.url), 'utf8')
  const shell = readFileSync(new URL('../profile/plugins/emate-shell/src/client/index.ts', import.meta.url), 'utf8')
  assert.match(source, /dataset\.emateSettingsTrigger/)
  assert.match(source, /data-emate-settings-close/)
  assert.match(source, /data-emate-settings-content/)
  assert.match(sidebar, /data-emate-mobile-open/)
  assert.match(sidebar, /ref=\{mobileOpen\}/)
  assert.match(sidebar, /'\[data-emate-settings-content\], \[data-emate-settings-trigger\]'/)
  assert.match(sidebar, /some\(element => element\.getClientRects\(\)\.length > 0\)/)
  assert.doesNotMatch(sidebar, /querySelector\('\[data-emate-settings-content\]'\) !== null/)
  assert.match(sidebar, /trigger\.getClientRects\(\)\.length === 0/)
  assert.match(sidebar, /retryFrames >= 120/)
  assert.match(sidebar, /requestAnimationFrame\(/)
  assert.match(sidebar, /syncSettingsRoute\(true\)/)
  assert.match(sidebar, /cancelAnimationFrame\(retryFrame\)/)
  assert.match(sidebar, /awaitingTarget = true\s+stopRetry\(\)\s+toggleSidebar\(\)/)
  assert.match(sidebar, /toggleSidebar\(\)\s+scheduleRetry\(\)/)
  assert.doesNotMatch(sidebar, /trigger\.click\(\)/)
  assert.match(sidebar, /addEventListener\('resize', restartForLayout\)/)
  assert.match(sidebar, /removeEventListener\('resize', restartForLayout\)/)
  assert.doesNotMatch(shell, /e-mate-settings-route|SettingsRouteProjection/)
  assert.match(source, /new MutationObserver/)
  assert.match(source, /addEventListener\('popstate', syncPanel\)/)
  assert.match(source, /removeEventListener\('popstate', syncPanel\)/)
  assert.match(source, /history\.pushState\(\{ \[SETTINGS_RETURN_KEY\]: returnPath \}, '', SETTINGS_PATH\)/)
  assert.match(source, /history\.back\(\)/)
  assert.match(source, /history\.replaceState\(history\.state, '', '\/'\)/)
  assert.doesNotMatch(source, /\buseState\b|\b(?:fetch|WebSocket|EventSource)\s*\(/)
  assert.doesNotMatch(sidebar, /\b(?:fetch|WebSocket|EventSource)\s*\(/)
})

test('browser profile keeps settings storage but exposes no native document action', async () => {
  const root = mkdtempSync(join(tmpdir(), 'e-mate-settings-boundary-'))
  const path = join(root, 'settings.yaml')
  const context = new Context()
  const settings = context.plugin(FileSettingsProvider, { path, watch: false })
  await settings
  const boundary = context.plugin(settingsDocumentBoundary)
  await boundary
  try {
    assert.equal(context.settings.writable, true)
    assert.equal(context.settings.documentPath, undefined)
    assert.equal(await context.settings.prepareDocument(), undefined)
    assert.equal(existsSync(path), false)
  } finally {
    await boundary.dispose()
    assert.equal(context.settings.documentPath, path)
    await settings.dispose()
    rmSync(root, { recursive: true, force: true })
  }
})


test('version gates match the release contract', () => {
  assert.equal(nodeVersionSupported('22.18.0'), false)
  assert.equal(nodeVersionSupported('22.19.0'), true)
  assert.equal(nodeVersionSupported('23.9.0'), false)
  assert.equal(nodeVersionSupported('24.0.0'), true)
  assert.equal(platformSupported('darwin', 'arm64'), true)
  assert.equal(platformSupported('darwin', 'x64'), true)
  assert.equal(platformSupported('win32', 'x64'), true)
  assert.equal(platformSupported('linux', 'x64'), false)
  const libFiles = readdirSync(new URL('../lib/', import.meta.url))
  for (const stem of ['e-mate', 'legacy-migration', 'legacy-schedule', 'update']) {
    assert.equal(libFiles.filter(name => name.startsWith(`${stem}-`) && name.endsWith('.js')).length, 1)
  }
})

test('online update target parsing rejects tags and downgrade ordering is SemVer-correct', () => {
  const requestId = '11111111-1111-4111-8111-111111111111'
  const sourceCommit = 'a'.repeat(40)
  const base = `https://pub-ada3f610c0234a76838f4e19fe2bb25e.r2.dev/npm/candidates/v2.0.12/${sourceCommit}`
  const releaseSource = {
    schema_version: 1,
    product: 'e-Mate',
    version: '2.0.12',
    package_name: '@e-mate/dsh',
    source_commit: sourceCommit,
    manifest_url: `${base}/release-manifest.json`,
    tarball_url: `${base}/e-mate-dsh-2.0.12.tgz`,
  }
  const request = {
    schema_version: 1,
    request_id: requestId,
    target: '2.0.12',
    current_version: '2.0.12',
    release_source: releaseSource,
    previous_release_source: releaseSource,
  }
  assert.equal(normalizeUpdateTarget(), 'latest')
  assert.equal(normalizeUpdateTarget('latest'), 'latest')
  assert.equal(normalizeUpdateTarget('2.0.12-rc.1'), '2.0.12-rc.1')
  assert.throws(() => normalizeUpdateTarget('next'), /invalid update version/)
  assert.throws(() => normalizeUpdateTarget('2.0'), /invalid update version/)
  assert.equal(validateStagedVersion('latest', '2.0.12'), '2.0.12')
  assert.equal(validateStagedVersion('2.0.12', '2.0.12'), '2.0.12')
  assert.throws(() => validateStagedVersion('2.0.12', '2.0.7'), /does not match requested version/)
  assert.throws(() => validateStagedVersion('latest', 'not-semver'), /version is invalid/)
  assert.equal(validateUpdateRequest(request, requestId), request)
  assert.throws(
    () => validateUpdateRequest({ ...request, target: 'file:/tmp/package.tgz' }, requestId),
    /invalid update version/,
  )
  assert.throws(
    () => validateUpdateRequest({ ...request, current_version: '2.0.7 --force' }, requestId),
    /request version is invalid/,
  )
  const integrity = `sha512-${'A'.repeat(86)}==`
  assert.equal(parsePackageIntegrity(JSON.stringify(integrity)), integrity)
  assert.throws(() => parsePackageIntegrity(JSON.stringify('sha256-invalid')), /integrity is invalid/)
  assert.equal(compareVersions('2.0.7', '2.0.7-rc.1'), 1)
  assert.equal(compareVersions('2.0.7-rc.1', '2.0.7-rc.2'), -1)
  assert.equal(compareVersions('2.0.12', '2.0.7'), 1)
  assert.equal(globalPrefixForBinPath('/opt/e-mate/lib/node_modules/@e-mate/dsh/lib/bin.js', 'darwin'), '/opt/e-mate')
  assert.equal(
    globalPrefixForBinPath('C:\\Users\\e-mate\\AppData\\Roaming\\npm\\node_modules\\@e-mate\\dsh\\lib\\bin.js', 'win32'),
    'C:\\Users\\e-mate\\AppData\\Roaming\\npm',
  )
  assert.throws(() => globalPrefixForBinPath('/repo/packages/dsh/lib/bin.js', 'darwin'), /global npm installation/u)
  assert.deepEqual(validateReleaseSource(releaseSource), releaseSource)
  const desktopPrefix = `https://pub-ada3f610c0234a76838f4e19fe2bb25e.r2.dev/desktop/releases/v2.0.12/${sourceCommit}`
  assert.deepEqual(validateLatestReleasePointer({
    schema_version: 1,
    version: '2.0.12',
    source_commit: sourceCommit,
    artifacts: {
      darwin: {
        url: `${desktopPrefix}/e-Mate-2.0.12-mac-universal.dmg`,
        bytes: 1,
        sha256: 'ab'.repeat(32),
      },
      win32: {
        url: `${desktopPrefix}/e-Mate-2.0.12-win-x64-Setup.exe`,
        bytes: 1,
        sha256: 'cd'.repeat(32),
      },
    },
  }), releaseSource)
  assert.equal(compareVersions('2.0.12', '2.0.5'), 1)
  assert.throws(() => validateReleaseSource({ ...releaseSource, manifest_url: 'http://example.com/release-manifest.json' }), /URL is invalid/u)
  const sha512 = 'ab'.repeat(64)
  const artifactIntegrity = `sha512-${Buffer.from(sha512, 'hex').toString('base64')}`
  const artifact = {
    name: '@e-mate/dsh', version: '2.0.12', kind: 'main', filename: 'e-mate-dsh-2.0.12.tgz',
    size: 207, sha256: 'cd'.repeat(32), sha512, integrity: artifactIntegrity,
  }
  const manifest = {
    schema_version: 1, product: 'e-Mate', version: '2.0.12', source_commit: sourceCommit,
    packages: [artifact], download: { ...releaseSource, size: artifact.size, sha256: artifact.sha256, sha512, integrity: artifactIntegrity },
  }
  assert.equal(validateReleaseManifest(manifest, releaseSource).integrity, artifactIntegrity)
  assert.throws(() => validateReleaseManifest({ ...manifest, packages: [{ ...artifact, sha256: 'ef'.repeat(32) }] }, releaseSource), /integrity is invalid/u)
  const updateSource = readFileSync(new URL('../src/update.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(updateSource, /--ignore-scripts/u, 'the staged npm package must retain its reviewed lifecycle contract')
  assert.match(
    updateSource,
    /snapshotData\(paths\)\s+changed = true\s+runNpm\(\[\s*'install', '--global'/u,
    'a partial global install must enter rollback',
  )
  assert.match(updateSource, /runNode\(\[binPath, '--version'\]/u)
  assert.match(updateSource, /'launch', \.\.\.\(previousPort === undefined/u)
  assert.doesNotMatch(updateSource, /npm package integrity|npm view|@e-mate\/dsh@\$\{/u)
  assert.match(updateSource, /installed_source_url: staged\.tarball_url/u)
  assert.match(updateSource, /paths\.previousPackage/u)
  assert.doesNotMatch(updateSource, /rmSync\(dirname\(paths\.snapshot\)/u, 'data snapshots must retain the verified target and rollback tarballs')
})

test('status projects only the latest bounded online-update receipt', async () => {
  const dshHome = mkdtempSync(join(tmpdir(), 'e-mate-update-status-'))
  const directory = join(dshHome, 'e-mate', 'migrations')
  mkdirSync(directory, { recursive: true })
  const first = '11111111-1111-4111-8111-111111111111'
  const second = '22222222-2222-4222-8222-222222222222'
  try {
    writeFileSync(join(directory, `online-update-${first}.json`), JSON.stringify({
      schema_version: 1,
      product: 'e-Mate',
      request_id: first,
      status: 'failed-before-change',
      requested_version: '2.0.12',
      previous_version: '2.0.7',
      error: 'must not reach status output',
      finished_at: '2026-08-15T01:00:00.000Z',
    }))
    writeFileSync(join(directory, `online-update-${second}.json`), JSON.stringify({
      schema_version: 1,
      product: 'e-Mate',
      request_id: second,
      status: 'completed',
      requested_version: '2.0.12',
      previous_version: '2.0.7',
      installed_version: '2.0.12',
      error: 'must not reach status output',
      finished_at: '2026-08-15T02:00:00.000Z',
    }))
    const expected = {
      request_id: second,
      status: 'completed',
      requested_version: '2.0.12',
      previous_version: '2.0.7',
      installed_version: '2.0.12',
      finished_at: '2026-08-15T02:00:00.000Z',
    }
    assert.deepEqual(latestUpdateReceipt(dshHome), expected)
    assert.deepEqual((await managedStatus(dshHome)).latest_update, expected)
  } finally {
    rmSync(dshHome, { recursive: true, force: true })
  }
})

test('online updates admit only one live detached helper', () => {
  const root = mkdtempSync(join(tmpdir(), 'e-mate-update-lock-'))
  const lock = join(root, 'run', 'update.lock')
  const first = '11111111-1111-4111-8111-111111111111'
  const second = '22222222-2222-4222-8222-222222222222'
  try {
    assert.throws(
      () => claimUpdateLock(lock, '11111111-1111-1111-1111-111111111111'),
      /invalid online update lock identity/u,
    )
    claimUpdateLock(lock, first)
    assert.throws(() => claimUpdateLock(lock, second), /already running/u)
    releaseUpdateLock(lock, second)
    assert.equal(existsSync(lock), true)
    releaseUpdateLock(lock, first)
    assert.equal(existsSync(lock), false)

    mkdirSync(join(root, 'run'), { recursive: true })
    writeFileSync(lock, JSON.stringify({ schema_version: 1, request_id: first, owner_pid: 2_147_483_647, state: 'running' }))
    claimUpdateLock(lock, second)
    assert.equal(JSON.parse(readFileSync(lock, 'utf8')).request_id, second)
  } finally {
    releaseUpdateLock(lock, second)
    rmSync(root, { recursive: true, force: true })
  }
})

test('runtime resolves only the exact Harness source', () => {
  const runtime = resolveHarness()
  assert.equal(runtime.version, HARNESS_VERSION)
  assert.equal(runtime.commit, HARNESS_COMMIT)
  assert.ok(['development-source', 'packaged-runtime'].includes(runtime.source))
})

test('managed profile installation is idempotent', () => {
  const dshHome = mkdtempSync(join(tmpdir(), 'e-mate-profile-'))
  try {
    const first = installProfile(dshHome)
    assert.equal(existsSync(join(first.data, 'general')), true)
    const manifest = readFileSync(join(first.profile, 'package.json'), 'utf8')
    const profileManifest = JSON.parse(manifest)
    assert.equal(profileManifest.type, 'module')
    const pluginPackages = [
      '@e-mate/dsh-plugin-skill-hub',
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
      '@e-mate/dsh-plugin-tool-search',
    ]
    assert.deepEqual(profileManifest.dsh.profile.bundles, [
      '@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', ...pluginPackages,
    ])
    assert.deepEqual(profileManifest.dependencies, Object.fromEntries(pluginPackages.map(name => [name, '2.0.12'])))
    const patch = readFileSync(join(first.profile, 'cordis.patch.yml'), 'utf8')
    installProfile(dshHome)
    assert.equal(readFileSync(join(first.profile, 'package.json'), 'utf8'), manifest)
    assert.equal(readFileSync(join(first.profile, 'cordis.patch.yml'), 'utf8'), patch)
    profileManifest.dependencies['@e-mate/dsh-plugin-im'] = '2.0.8'
    profileManifest.dependencies['@e-mate/dsh-plugin-idesign'] = '2.0.12'
    profileManifest.dependencies['@e-mate/dsh-plugin-search-mcp'] = '2.0.11'
    profileManifest.dependencies['@e-mate/dsh-plugin-xin-assistant'] = '2.0.10'
    profileManifest.dependencies['@yuxianglin/dsh-bridge-browser'] = '0.0.1'
    const retiredXin = join(first.profile, 'node_modules', '@e-mate', 'dsh-plugin-xin-assistant')
    const retiredIDesign = join(first.profile, 'node_modules', '@e-mate', 'dsh-plugin-idesign')
    const retiredSearchMcp = join(first.profile, 'node_modules', '@e-mate', 'dsh-plugin-search-mcp')
    mkdirSync(retiredXin, { recursive: true })
    writeFileSync(join(retiredXin, 'stale.txt'), 'retired')
    mkdirSync(retiredIDesign, { recursive: true })
    writeFileSync(join(retiredIDesign, 'stale.txt'), 'retired')
    mkdirSync(retiredSearchMcp, { recursive: true })
    writeFileSync(join(retiredSearchMcp, 'stale.txt'), 'retired')
    profileManifest.dsh.profile.bundles.push(
      '@e-mate/dsh-plugin-im',
      '@e-mate/dsh-plugin-idesign',
      '@e-mate/dsh-plugin-search-mcp',
      '@e-mate/dsh-plugin-xin-assistant',
      '@yuxianglin/dsh-bridge-browser',
    )
    writeFileSync(join(first.profile, 'package.json'), `${JSON.stringify(profileManifest, null, 2)}\n`)
    installProfile(dshHome)
    const repairedManifest = JSON.parse(readFileSync(join(first.profile, 'package.json'), 'utf8'))
    assert.equal(repairedManifest.dependencies['@e-mate/dsh-plugin-im'], undefined)
    assert.equal(repairedManifest.dependencies['@e-mate/dsh-plugin-idesign'], undefined)
    assert.equal(repairedManifest.dependencies['@e-mate/dsh-plugin-search-mcp'], undefined)
    assert.equal(repairedManifest.dependencies['@e-mate/dsh-plugin-xin-assistant'], undefined)
    assert.equal(repairedManifest.dependencies['@yuxianglin/dsh-bridge-browser'], undefined)
    assert.equal(repairedManifest.dsh.profile.bundles.includes('@e-mate/dsh-plugin-im'), false)
    assert.equal(repairedManifest.dsh.profile.bundles.includes('@e-mate/dsh-plugin-idesign'), false)
    assert.equal(repairedManifest.dsh.profile.bundles.includes('@e-mate/dsh-plugin-search-mcp'), false)
    assert.equal(repairedManifest.dsh.profile.bundles.includes('@e-mate/dsh-plugin-xin-assistant'), false)
    assert.equal(repairedManifest.dsh.profile.bundles.includes('@yuxianglin/dsh-bridge-browser'), false)
    assert.equal(existsSync(retiredXin), false)
    assert.equal(existsSync(retiredIDesign), false)
    assert.equal(existsSync(retiredSearchMcp), false)
    const patchRows = parseYaml(patch).flatMap(operation => operation.insert ?? (operation.id ? [operation] : []))
    const patchById = new Map(patchRows.map(row => [row.id, row]))
    assert.deepEqual(patchById.get('credentials'), {
      id: 'credentials',
      name: '@deepseek-ai/dsh-credentials-local',
      disabled: true,
    })
    assert.equal(patchById.get('emate-credentials-os').name, './plugins/credentials-os.js')
    assert.equal(patchById.has('emate-connections'), false)
    assert.deepEqual(patchById.get('emate-qr-generation'), {
      id: 'emate-qr-generation',
      name: './plugins/qr-generation.js',
      inject: ['tools', 'jobs', 'attachments'],
    })
    assert.deepEqual(patchById.get('ui-settings-models'), {
      id: 'ui-settings-models',
      name: '@deepseek-ai/dsh-client-ui-settings-models',
      disabled: true,
    })
    assert.deepEqual(patchById.get('ui-agent-preset'), {
      id: 'ui-agent-preset',
      name: '@deepseek-ai/dsh-client-ui-agent-preset',
      disabled: false,
    })
    assert.deepEqual(patchById.get('ui-trajectory'), {
      id: 'ui-trajectory',
      name: '@deepseek-ai/dsh-client-ui-trajectory',
      disabled: true,
    })
    assert.equal(patchById.get('agent-presets').config.default, 'standard')
    assert.equal(patchById.get('sandbox-policy').config.mode, 'danger-full-access')
    assert.equal(patchById.get('approval').config.policy, 'never')
    assert.equal(patchById.get('permission').config.defaultPreset, 'danger-full-access')
    assert.deepEqual(patchById.get('web').config, { searchProvider: 'deepseek-official' })
    assert.deepEqual(patchById.get('web-search-deepseek'), {
      id: 'web-search-deepseek',
      disabled: false,
      config: {
        apiKeyEnv: 'E_MATE_SEARCH_KEY_DEEPSEEK',
        baseURL: 'https://api.deepseek.com/anthropic/v1',
        model: 'deepseek-v4-flash',
      },
    })
    assert.deepEqual(patchById.get('tool-web'), {
      id: 'tool-web',
      disabled: false,
      config: { fetch: false, searchTimeoutMs: 60000, searchMaxResults: 50 },
    })
    assert.equal(patchById.has('search-mcp'), false)
    assert.equal(patchById.get('llm-deepseek').disabled, true)
    assert.deepEqual(patchById.get('agent-default-model').config, {
      provider: 'e-mate-enterprise',
      model: 'gpt-5.6-luna',
    })
    assert.equal(patchById.get('agent-loop').config.maxParallelToolCalls, 4)
    assert.deepEqual(patchById.get('llm-pi-ai').config.providers, {})
    assert.equal(patchById.get('emate-general-workspace').name, './plugins/general-workspace.js')
    assert.deepEqual(patchById.get('emate-settings-document-boundary'), {
      id: 'emate-settings-document-boundary',
      name: './plugins/settings-document-boundary.js',
      inject: ['settings'],
    })
    assert.equal(patchById.get('schedule').name, '@deepseek-ai/dsh-schedule')
    assert.equal(patchById.get('emate-schedule-import').name, './plugins/schedule-import.js')
    assert.equal(patchById.has('emate-schedules'), false)
    assert.equal(patchById.get('emate-legacy-migration').name, './plugins/legacy-migration.js')
    assert.equal(patchById.get('emate-model-policy').name, './plugins/model-policy.js')
    assert.deepEqual(patchById.get('emate-model-policy').inject, [
      'apiProxy', 'connection', 'credentials', 'settings', 'storageDomain', 'llm', 'emateIdentity',
    ])
    assert.equal(patchById.get('emate-identity').config.enterprise.clientId, 'e-mate-web')
    assert.equal(patchById.get('emate-identity').config.enterprise.organization, 'emate-v2')
    assert.equal(patchById.get('emate-share').name, './plugins/share.js')
    assert.deepEqual(patchById.get('emate-share').inject, ['apiProxy', 'connection', 'credentials'])
    assert.equal(patchById.get('emate-share').config.rootUrl, 'https://emate-share.emate-zyfjacksonchen.workers.dev')
    assert.equal(patchById.get('emate-audit').name, './plugins/audit.js')
    assert.deepEqual(patchById.get('emate-audit').inject, [
      'connection', 'sessionPersistence', 'storageDomain', 'timer', 'emateModelPolicy', 'emateIdentity',
    ])
    assert.equal(patchById.get('emate-agent-operations').name, './plugins/agent-operations.js')
    assert.deepEqual(patchById.get('emate-agent-operations').inject, ['systemPrompt'])
    assert.equal(patchById.has('ui-sidebar'), false)
    assert.equal(patchById.has('emate-shell'), false)
    assert.match(patch, /\.\/plugins\/health\.js/)
    assert.match(patch, /id: emate-general-workspace[\s\S]*\.\/plugins\/general-workspace\.js[\s\S]*inject: \[workspaceRegistry\]/)
    assert.match(patch, /id: emate-identity[\s\S]*\.\/plugins\/identity\/index\.js/)
    assert.match(patch, /id: emate-capabilities[\s\S]*\.\/plugins\/capabilities\.js/)
    assert.doesNotMatch(patch, /emate-connections|plugins\/connections\.js/)
    assert.match(patch, /id: emate-qr-generation[\s\S]*\.\/plugins\/qr-generation\.js[\s\S]*inject: \[tools, jobs, attachments\]/)
    assert.match(patch, /id: emate-agent-operations[\s\S]*\.\/plugins\/agent-operations\.js/)
    assert.doesNotMatch(patch, /emate-skill-hub-agent|plugins\/skill-hub-agent\.js/)
    assert.doesNotMatch(patch, /emate-(?:office-ocr|browser-computer-use|memory|dream|learning)/)
    assert.match(patch, /id: emate-model-policy[\s\S]*\.\/plugins\/model-policy\.js[\s\S]*inject: \[apiProxy, connection, credentials, settings, storageDomain, llm, emateIdentity\]/)
    assert.match(patch, /id: emate-audit[\s\S]*\.\/plugins\/audit\.js[\s\S]*inject: \[connection, sessionPersistence, storageDomain, timer, emateModelPolicy, emateIdentity\]/)
    assert.match(patch, /id: emate-image-generation[\s\S]*\.\/plugins\/image-generation\.js[\s\S]*inject: \[tools, jobs, attachments, sandboxPolicy, emateIdentity, emateModelPolicy, emateCapabilities\][\s\S]*rootUrl: https:\/\/mvdcm\.ecoremedia\.net\/e-mate\/model-api\/v1/)
    assert.match(patch, /id: emate-legacy-migration[\s\S]*\.\/plugins\/legacy-migration\.js[\s\S]*inject: \[sessionPersistence, webServer\]/)
    assert.match(patch, /id: emate-schedule-import[\s\S]*\.\/plugins\/schedule-import\.js[\s\S]*inject: \[tools\]/)
    assert.ok(readFileSync(join(first.profile, 'plugins', 'agent-operations.js')).byteLength > 0)
    const schedules = readFileSync(join(first.profile, 'node_modules', '@e-mate', 'dsh-plugin-schedules', 'lib', 'index.js'), 'utf8')
    assert.match(schedules, /\/emate\.schedules/u)
    assert.match(schedules, /foldScheduleEvents/u)
    assert.ok(readFileSync(join(first.profile, 'plugins', 'capabilities.js')).byteLength > 0)
    assert.ok(readFileSync(join(first.profile, 'plugins', 'general-workspace.js')).byteLength > 0)
    assert.ok(readFileSync(join(first.profile, 'plugins', 'settings-document-boundary.js')).byteLength > 0)
    const qrGeneration = readFileSync(join(first.profile, 'plugins', 'qr-generation.js'), 'utf8')
    assert.match(qrGeneration, /e_mate_qr_generate/)
    assert.match(qrGeneration, /ctx\.jobs\.start/)
    assert.match(qrGeneration, /attachments\.saveImage/)
    assert.doesNotMatch(qrGeneration, /from ["']qrcode["']/)
    const credentials = readFileSync(join(first.profile, 'plugins', 'credentials-os.js'), 'utf8')
    assert.match(credentials, /loadTargetCredentials/)
    assert.match(credentials, /DataProtectionScope\]::CurrentUser/)
    assert.match(credentials, /find-generic-password/)
    assert.doesNotMatch(credentials, /ctx\.connection|\.credentials\.yaml/)
    for (const name of pluginPackages) {
      const pluginRoot = join(first.profile, 'node_modules', ...name.split('/'))
      const pluginManifest = JSON.parse(readFileSync(join(pluginRoot, 'package.json'), 'utf8'))
      assert.equal(pluginManifest.name, name)
      assert.equal(pluginManifest.version, '2.0.12')
      assert.ok(readFileSync(join(pluginRoot, pluginManifest.main)).byteLength > 0)
      const pluginPatch = readFileSync(join(pluginRoot, pluginManifest.dsh.bundle.patch), 'utf8')
      assert.ok(pluginPatch.length >= 2)
      const patchBody = pluginPatch.split('\n').map(line => line.trim()).filter(line => line !== '' && !line.startsWith('#')).join('\n')
      if (patchBody !== '[]') {
        assert.ok(pluginPatch.includes(`name: './node_modules/${name}/${pluginManifest.main}'`))
        assert.doesNotMatch(pluginPatch, new RegExp(`name: '${name}'`, 'u'))
      }
    }
    const imageGeneration = readFileSync(join(first.profile, 'plugins', 'image-generation.js'), 'utf8')
    assert.match(imageGeneration, /name: "imagegen"/)
    assert.match(imageGeneration, /ctx\.jobs\.start/)
    assert.match(imageGeneration, /attachments\.saveImage/)
    assert.match(imageGeneration, /emateIdentity/)
    assert.match(imageGeneration, /emateModelPolicy/)
    assert.doesNotMatch(imageGeneration, /\bfetch\(/)
    const legacyMigration = readFileSync(join(first.profile, 'plugins', 'legacy-migration.js'), 'utf8')
    assert.match(legacyMigration, /sessionPersistence/)
    assert.match(legacyMigration, /legacy-sessions-v1\.json/)
    assert.doesNotMatch(legacyMigration, /WebSocket|EventSource/)
    const scheduleImport = readFileSync(join(first.profile, 'plugins', 'schedule-import.js'), 'utf8')
    assert.match(scheduleImport, /e_mate_schedule_import_list/)
    assert.match(scheduleImport, /e_mate_schedule_import_enable/)
    assert.match(scheduleImport, /schedule_list/)
    assert.match(scheduleImport, /schedule_create/)
    const binding = JSON.parse(readFileSync(join(first.profile, 'plugins', 'runtime-binding.json'), 'utf8'))
    assert.match(binding.storage_domain_module_sha256, /^[0-9a-f]{64}$/)
    assert.match(binding.llm_module_sha256, /^[0-9a-f]{64}$/)
    assert.match(binding.schedule_module_sha256, /^[0-9a-f]{64}$/)
    assert.match(binding.credentials_module_sha256, /^[0-9a-f]{64}$/)
    assert.match(binding.launch_environment_module_sha256, /^[0-9a-f]{64}$/)
    const dumped = spawnSync(process.execPath, [
      new URL('../lib/bin.js', import.meta.url).pathname,
      '--profile', 'e-mate', '--dump-config',
    ], {
      cwd: dshHome,
      env: {
        ...process.env,
        DSH_HOME: dshHome,
        DEEPSEEK_SEARCH_BASE_URL: 'https://environment-override.invalid/anthropic/v1',
      },
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
    })
    assert.equal(dumped.status, 0, dumped.stderr)
    assert.match(dumped.stdout, /- id: credentials\n  name: '@deepseek-ai\/dsh-credentials-local'\n  disabled: true/)
    assert.match(dumped.stdout, /- id: emate-credentials-os\n  name: \.\/plugins\/credentials-os\.js/)
    assert.match(dumped.stdout, /- id: ui-trajectory\n  name: '@deepseek-ai\/dsh-client-ui-trajectory'\n  disabled: true/)
    assert.match(dumped.stdout, /- id: web\n  name: '@deepseek-ai\/dsh-web'\n  config:\n    searchProvider: deepseek-official/)
    assert.match(dumped.stdout, /- id: web-search-deepseek\n  name: '@deepseek-ai\/dsh-web-search-deepseek'\n  config:\n    apiKeyEnv: E_MATE_SEARCH_KEY_DEEPSEEK\n    baseURL: https:\/\/api\.deepseek\.com\/anthropic\/v1\n    model: deepseek-v4-flash\n  disabled: false/)
    assert.doesNotMatch(dumped.stdout, /environment-override\.invalid/)
    assert.match(dumped.stdout, /- id: tool-web\n  name: '@deepseek-ai\/dsh-tool-web'\n  config:\n    fetch: false\n    searchTimeoutMs: 60000\n    searchMaxResults: 50\n  disabled: false/)
    assert.doesNotMatch(dumped.stdout, /- id: search-mcp\b|TAVILY_API_KEY/)
    assert.doesNotMatch(dumped.stdout, /- id: credentials\n  name: '@deepseek-ai\/dsh-credentials-local'\n(?!  disabled: true)/)
    assert.doesNotMatch(dumped.stdout, /- id: ui-trajectory\n  name: '@deepseek-ai\/dsh-client-ui-trajectory'\n(?!  disabled: true)/)
    assert.match(binding.zod_module_sha256, /^[0-9a-f]{64}$/)
    const shell = join(first.profile, 'node_modules', '@deepseek-ai', 'dsh-client-ui-sidebar')
    const shellManifest = JSON.parse(readFileSync(join(shell, 'package.json'), 'utf8'))
    assert.deepEqual(shellManifest.dsh.client.inject, [
      '@deepseek-ai/dsh-client-runtime',
      '@deepseek-ai/dsh-client-connection',
      '@deepseek-ai/dsh-client-ui-layout',
      '@deepseek-ai/dsh-client-ui-conversation',
      '@deepseek-ai/dsh-client-ui-input-trigger',
      '@deepseek-ai/dsh-client-ui-attachment',
      '@deepseek-ai/dsh-client-locale',
      '@deepseek-ai/dsh-session-log-export',
    ])
    const client = readFileSync(join(shell, 'lib', 'client.js'), 'utf8')
    assert.match(client, /window\.__ModuleLoader__\.load\(\s*\{/)
    assert.match(client, /\bid:\s*["']@deepseek-ai\/dsh-client-ui-sidebar["']/)
    assert.match(client, /data-emate-home-hero/)
    assert.match(client, /data-emate-home-overview/)
    assert.match(client, /data-chain-overlay-fallback/)
    assert.match(client, /ctx\.slots\.inject\(["']shell\.overlay["']/)
    assert.match(client, /welcome-notice/)
    assert.match(client, /deepseek-official/)
    assert.match(client, /priority:\s*-1/)
    assert.match(client, /e-mate-identity-gate/)
    assert.match(client, /e-mate-user-center/)
    assert.match(client, /data-emate-settings-header/)
    assert.match(client, /ctx\.slots\.inject\(["']settings\.section["']/)
    assert.match(client, /ctx\.slots\.inject\(["']settings\.action["']/)
    assert.match(client, /identity\.bootstrap/)
    assert.match(client, /verification\.issue/)
    assert.match(client, /session\.register/)
    assert.match(client, /remember_login/)
    assert.match(client, /真实姓名/)
    assert.match(client, /保持登录/)
    assert.match(client, /session\.logout/)
    assert.match(client, /session\.password/)
    assert.match(client, /\.inert\s*=\s*true/)
    assert.match(client, /\/emate\.mcpManage/)
    assert.match(client, /外部连接/)
    assert.match(client, /电脑操控/)
    const skillHubRoot = join(first.profile, 'node_modules', '@e-mate', 'dsh-plugin-skill-hub')
    const skillHubClient = readFileSync(join(skillHubRoot, 'lib', 'client.js'), 'utf8')
    assert.match(skillHubClient, /e-mate-capabilities-entry/)
    assert.match(skillHubClient, /data-emate-capabilities/)
    assert.match(skillHubClient, /\/emate\.capabilities/)
    assert.match(skillHubClient, /\/emate\.skillHub/)
    assert.match(skillHubClient, /catalog\.search/)
    assert.match(skillHubClient, /skills\.publish/)
    assert.match(skillHubClient, /\/capabilities/)
    assert.match(skillHubClient, /保存 ZIP/)
    assert.match(client, /emate\/legacy-artifacts/)
    assert.match(client, /conversationEvents\.register/)
    assert.match(client, /legacy-artifact\.download/)
    assert.match(client, /e-mate-image-disclosure/)
    assert.doesNotMatch(client, /e-mate-activity-group|data-emate-activity-header|e-mate-message-disclosure/)
    const capabilities = readFileSync(new URL('../../dsh-plugin-skill-hub/src/client/capabilities.tsx', import.meta.url), 'utf8')
    assert.match(capabilities, /icons\[capability\.icon_key\]/)
    assert.match(capabilities, /社区 Skill 暂时不可用；内置能力仍可正常使用。/)
    assert.doesNotMatch(capabilities, /capability\.(?:id|title)\s*===|switch\s*\(\s*capability\.(?:id|title)/)
    assert.doesNotMatch(capabilities, /\b(?:fetch|WebSocket|EventSource)\s*\(/)
    const connectionsUi = readFileSync(new URL('../profile/plugins/emate-shell/src/client/composer-connectors.tsx', import.meta.url), 'utf8')
    assert.match(connectionsUi, /已生效的外部连接/)
    assert.match(connectionsUi, /查找并安装对应 Skill/)
    assert.doesNotMatch(connectionsUi, /\b(?:fetch|WebSocket|EventSource)\s*\(/)
    const sessionRoute = readFileSync(new URL('../profile/plugins/emate-shell/src/client/session-route.tsx', import.meta.url), 'utf8')
    assert.match(sessionRoute, /state\.phase !== ['"]ready['"]/) // waits for the target list baseline
    assert.match(sessionRoute, /Object\.prototype\.hasOwnProperty\.call\(state\.byId, id\)/)
    assert.match(sessionRoute, /openSession\(id\)/)
    assert.match(sessionRoute, /startHomeSession\(\)/)
    assert.doesNotMatch(sessionRoute, /clearSession\(\)/)
    assert.match(sessionRoute, /\/chat\/\$\{encodeURIComponent\(current\)\}/)
    assert.doesNotMatch(sessionRoute, /\b(?:fetch|WebSocket|EventSource|createSnapshotStore|defineStore)\b/)
    const home = readFileSync(new URL('../profile/plugins/emate-shell/src/client/home.tsx', import.meta.url), 'utf8')
    const homeCss = readFileSync(new URL('../profile/plugins/emate-shell/src/client/home.module.css', import.meta.url), 'utf8')
    assert.match(home, /\[data-chain-overlay-fallback="conversation\.composer"\] > div/)
    assert.match(homeCss, /\[data-chain-overlay-fallback='conversation\.composer'\] > div > svg:first-child \+ div/)
    assert.match(homeCss, /min-height:\s*44px/)
    assert.doesNotMatch(homeCss, /> div > div:first-of-type/)
    const chatCss = readFileSync(new URL('../profile/plugins/emate-shell/src/client/chat-chrome.module.css', import.meta.url), 'utf8')
    assert.doesNotMatch(chatCss, /data-turn-tail|data-emate-activity/)
    assert.doesNotMatch(chatCss, /data-chat-flow-kind='(?:steering|model-retry|turn-error|command)'/)
    assert.match(chatCss, /--dsw-font-markdown-base:\s*14px\/22px/)
    assert.match(chatCss, /\[data-chat-flow-kind='user'\] \[data-time-hover-root\]/)
    assert.match(chatCss, /\[data-chat-flow-kind='tool-call'\] \[data-disclosure-row\]/)
    assert.match(chatCss, /\[data-chat-flow-kind='assistant-step'\] \[data-align='start'\] > \[data-variant='single'\]/)
    assert.match(chatCss, /\[data-chat-flow-kind='assistant-step'\] \[data-align='start'\] > \[data-variant='tile'\]/)
    assert.match(chatCss, /width:\s*clamp\(112px, 18vw, 160px\) !important/)
    assert.match(chatCss, /height:\s*clamp\(112px, 18vw, 160px\) !important/)
    assert.doesNotMatch(chatCss, /(?:e_mate_|imagegen|office|ocr|browser|feishu|weixin|dingtalk)/i)
    const catalogLoader = capabilities.slice(capabilities.indexOf('const loadCatalog'), capabilities.indexOf('const loadInstalled'))
    assert.match(catalogLoader, /setBuiltins\(/)
    assert.match(catalogLoader, /callSkillHub\('catalog\.search'/)
    assert.ok(catalogLoader.indexOf('setBuiltins(') < catalogLoader.indexOf("callSkillHub('catalog.search'"))
    assert.match(catalogLoader, /catch \(skillHubError\) \{\s*if \(cursor === undefined\) setItems\(\[\]\)\s*setError\(message\(skillHubError\)\)/)
    const imageGallery = readFileSync(new URL('../profile/plugins/emate-shell/src/client/image-gallery.tsx', import.meta.url), 'utf8')
    assert.match(imageGallery, /kind: 'e-mate-image-disclosure'/)
    assert.match(imageGallery, /event\.type !== 'assistant\/message'/)
    assert.match(imageGallery, /isAppendSurfaceEvent\(event\)/)
    assert.match(imageGallery, /querySelectorAll<HTMLElement>\('\[data-align="start"\]'\)/)
    assert.match(imageGallery, /gallery\.hidden = !expanded/)
    assert.doesNotMatch(imageGallery, /\b(?:fetch|WebSocket|EventSource|setTimeout)\s*\(/)
    const legacyArtifactCss = readFileSync(new URL('../profile/plugins/emate-shell/src/client/legacy-artifacts.module.css', import.meta.url), 'utf8')
    assert.match(legacyArtifactCss, /flex-direction:\s*column/)
    assert.match(legacyArtifactCss, /\.item \+ \.item/)
    assert.match(legacyArtifactCss, /background:\s*var\(--dsw-alias-bg-layer-1\)/)
    assert.doesNotMatch(client, /e-mate-office-artifacts|officeArtifactsDefinition|OfficeArtifacts/)
    assert.doesNotMatch(client, /\b(?:WebSocket|EventSource)\b|\bfetch\s*\(/)
    assert.ok(readFileSync(join(shell, 'assets', 'emate-logo.png')).byteLength > 0)
    assert.ok(readFileSync(join(shell, 'assets', 'lucide-send.svg')).byteLength > 0)
  } finally {
    rmSync(dshHome, { recursive: true, force: true })
  }
})

test('public share RPC publishes the native DSH Session ZIP and revokes the returned link', async () => {
  let registration
  const shareId = 'S'.repeat(32)
  const expiresAt = new Date(Date.now() + 86_400_000).toISOString()
  const requests = []
  const sessionLogCalls = []
  applyShare({
    apiProxy: { downloads: { sessionLog: async (request, signal) => {
      sessionLogCalls.push(request)
      assert.equal(signal.aborted, false)
      return new Response(new Uint8Array([80, 75, 3, 4]), {
        headers: { 'content-type': 'application/zip' },
      })
    } } },
    credentials: { resolve: async ref => {
      assert.equal(ref, 'E_MATE_MODEL_SESSION_TOKEN')
      return { value: 'model-session-token-which-is-long-enough', source: 'test' }
    } },
    connection: { rpc: { handle: (channel, handler, options) => {
      registration = { channel, handler, options }
      return async () => {}
    } } },
    effect: effect => effect(),
  }, {
    rootUrl: 'https://share.example',
    fetchImplementation: async (input, init = {}) => {
      const url = String(input)
      requests.push({ url, init })
      if (url.endsWith('/healthz')) {
        return Response.json({ schema_version: 1, ready: true })
      }
      if (url.includes('/v1/shares?')) {
        assert.equal(new Headers(init.headers).get('authorization'), 'Bearer model-session-token-which-is-long-enough')
        assert.equal(url, `https://share.example/v1/shares?session_sha256=${createHash('sha256').update('session-1').digest('hex')}`)
        return Response.json({
          schema_version: 1,
          shares: [{
            id: shareId,
            public_url: `https://share.example/s/${shareId}`,
            expires_at: expiresAt,
          }],
        })
      }
      if (init.method === 'POST') {
        assert.equal(new Headers(init.headers).get('authorization'), 'Bearer model-session-token-which-is-long-enough')
        assert.equal(new Headers(init.headers).get('x-emate-session-sha256'), createHash('sha256').update('session-1').digest('hex'))
        assert.deepEqual(new Uint8Array(await new Response(init.body).arrayBuffer()), new Uint8Array([80, 75, 3, 4]))
        return Response.json({
          schema_version: 1,
          share: {
            id: shareId,
            public_url: `https://share.example/s/${shareId}`,
            expires_at: expiresAt,
          },
        }, { status: 201 })
      }
      if (init.method === 'DELETE') return Response.json({ schema_version: 1, revoked: true })
      return new Response(null, { status: 404 })
    },
  })
  assert.equal(registration.channel, SHARE_CHANNEL)
  assert.deepEqual(registration.options, { authority: 'loopback' })
  assert.deepEqual(await registration.handler('status', {}), {
    ok: true,
    value: { schema_version: 1, ready: true },
  })
  assert.deepEqual(await registration.handler('create', { session_id: 'session-1' }), {
    ok: true,
    value: {
      schema_version: 1,
      share_id: shareId,
      public_url: `https://share.example/s/${shareId}`,
      expires_at: expiresAt,
    },
  })
  assert.deepEqual(sessionLogCalls, [{ sessionId: 'session-1', includeDescendants: true }])
  assert.deepEqual(await registration.handler('list', { session_id: 'session-1' }), {
    ok: true,
    value: {
      schema_version: 1,
      shares: [{
        share_id: shareId,
        public_url: `https://share.example/s/${shareId}`,
        expires_at: expiresAt,
      }],
    },
  })
  assert.deepEqual(await registration.handler('revoke', { share_id: shareId }), {
    ok: true,
    value: { schema_version: 1, revoked: true },
  })
  assert.equal(requests.at(-1).url, `https://share.example/v1/shares/${shareId}`)
  assert.equal((await registration.handler('create', {})).error.code, 'bad-request')
  assert.equal((await registration.handler('status', [])).error.code, 'bad-request')
})

test('OS credential provider preserves target layering without exposing values through describe', async () => {
  const stored = new Map()
  let reads = 0
  let writes = 0
  let rejectWrite = false
  let rejectUnset = false
  const backend = {
    source: 'keychain',
    get: async ref => { reads += 1; return stored.get(ref) },
    has: async ref => stored.has(ref),
    set: async (ref, value) => {
      if (rejectWrite) throw new Error('simulated credential write failure')
      writes += 1
      stored.set(ref, value)
    },
    unset: async ref => {
      if (rejectUnset) throw new Error('simulated credential unset failure')
      return stored.delete(ref)
    },
  }
  const layers = {
    process: new Map(),
    'project-env': new Map([['PROJECT_ONLY', 'project-secret']]),
    'user-env': new Map([['USER_ONLY', 'user-secret']]),
  }
  const environment = {
    getFrom(ref, sources) {
      for (const source of sources) {
        const value = layers[source].get(ref)
        if (value !== undefined) return { value, source }
      }
    },
  }
  const credentials = new CredentialStore(environment, backend)
  await credentials.set('CONNECTOR_TOKEN', 'stored-secret')
  assert.deepEqual(await credentials.resolve('CONNECTOR_TOKEN'), { value: 'stored-secret', source: 'keychain' })
  assert.deepEqual(await credentials.resolve('CONNECTOR_TOKEN'), { value: 'stored-secret', source: 'keychain' })
  await credentials.set('CONNECTOR_TOKEN', 'stored-secret')
  assert.deepEqual({ reads, writes }, { reads: 0, writes: 1 })
  const restored = new CredentialStore(environment, backend)
  assert.deepEqual(await restored.resolve('CONNECTOR_TOKEN'), { value: 'stored-secret', source: 'keychain' })
  assert.deepEqual(await restored.resolve('CONNECTOR_TOKEN'), { value: 'stored-secret', source: 'keychain' })
  assert.equal(reads, 1)
  await credentials.set('CONNECTOR_TOKEN', 'next-account-secret')
  assert.deepEqual(await credentials.resolve('CONNECTOR_TOKEN'), { value: 'next-account-secret', source: 'keychain' })
  rejectWrite = true
  await assert.rejects(credentials.set('CONNECTOR_TOKEN', 'failed-account-secret'), /simulated credential write failure/u)
  rejectWrite = false
  assert.deepEqual(await credentials.resolve('CONNECTOR_TOKEN'), { value: 'next-account-secret', source: 'keychain' })
  rejectUnset = true
  await assert.rejects(credentials.unset('CONNECTOR_TOKEN'), /simulated credential unset failure/u)
  rejectUnset = false
  assert.deepEqual(await credentials.resolve('CONNECTOR_TOKEN'), { value: 'next-account-secret', source: 'keychain' })
  const described = await credentials.describe('CONNECTOR_TOKEN')
  assert.deepEqual(described, { configured: true, source: 'keychain', writable: true })
  assert.equal(JSON.stringify(described).includes('next-account-secret'), false)
  assert.deepEqual(await credentials.resolve('PROJECT_ONLY'), { value: 'project-secret', source: 'project-env' })
  for (const ref of [
    'E_MATE_MODEL_KEY_GPT',
    'E_MATE_MODEL_KEY_DEEPSEEK',
    'E_MATE_MODEL_KEY_DOUBAO',
    'E_MATE_SEARCH_KEY_DEEPSEEK',
  ]) {
    layers.process.set(ref, `${ref}-process-secret`)
    layers['project-env'].set(ref, `${ref}-project-secret`)
    layers['user-env'].set(ref, `${ref}-user-secret`)
    assert.equal(await credentials.resolve(ref), undefined)
    assert.deepEqual(await credentials.describe(ref), { configured: false, writable: true })
    await credentials.set(ref, `${ref}-managed-secret`)
    assert.deepEqual(await credentials.resolve(ref), { value: `${ref}-managed-secret`, source: 'keychain' })
    assert.equal(await credentials.unset(ref), true)
    assert.equal(await credentials.resolve(ref), undefined)
  }
  layers.process.set('CONNECTOR_TOKEN', 'process-secret')
  assert.deepEqual(await credentials.resolve('CONNECTOR_TOKEN'), { value: 'process-secret', source: 'env' })
  assert.deepEqual(await credentials.describe('CONNECTOR_TOKEN'), { configured: true, source: 'env', writable: false })
  await assert.rejects(credentials.set('CONNECTOR_TOKEN', 'replacement'), /read-only/)
  await assert.rejects(credentials.unset('CONNECTOR_TOKEN'), /read-only/)
  layers.process.delete('CONNECTOR_TOKEN')
  assert.equal(await credentials.unset('CONNECTOR_TOKEN'), true)
  assert.deepEqual(await credentials.describe('CONNECTOR_TOKEN'), { configured: false, writable: true })
  await assert.rejects(credentials.set('CONNECTOR_TOKEN', ''), /empty value/)
})

test('OS credential backends use Keychain and CurrentUser DPAPI without plaintext files', async () => {
  const keychain = new Map()
  const macCommands = []
  let rejectedChunkSuffix
  const rejectedDeletes = new Set()
  let blockConcurrentChunk = false
  let concurrentChunkEntered
  let releaseConcurrentChunk
  let armManifestReadFailure
  let rejectRestoreWrite
  const mac = createOsCredentialBackend('darwin', '/unused', async (file, args, input = '') => {
    macCommands.push({ file, args, input })
    if (file === '/usr/bin/expect') {
      assert.equal(args.length, 2)
      assert.match(args[1], /password data for new item:/)
      assert.match(args[1], /retype password for new item:/)
      assert.match(args[1], /set timeout 30/)
      assert.match(args[1], /spawn -noecho \/usr\/bin\/security/)
      assert.match(args[1], /set service \{net\.ecoremedia\.e-mate\.credentials\.v1\}/)
      assert.doesNotMatch(args[1], /mac-secret|bWFjLXNlY3JldA==/)
      const account = /set account \{([A-Za-z0-9_]+)\}/u.exec(args[1])?.[1]
      assert.ok(account)
      if (rejectRestoreWrite === account) {
        rejectRestoreWrite = undefined
        return { status: 1, stdout: '' }
      }
      if (rejectedChunkSuffix !== undefined && account.endsWith(rejectedChunkSuffix)) {
        return { status: 1, stdout: '' }
      }
      if (blockConcurrentChunk && account.startsWith('CONCURRENT_TOKEN_EMATE1_') && account.endsWith('_0')) {
        blockConcurrentChunk = false
        await new Promise(resolve => {
          releaseConcurrentChunk = resolve
          concurrentChunkEntered()
        })
      }
      keychain.set(account, input.trim())
      if (armManifestReadFailure === account) armManifestReadFailure = `armed:${account}`
      return { status: 0, stdout: '' }
    }
    const ref = args[args.indexOf('-a') + 1]
    if (args[0] === 'find-generic-password') {
      if (armManifestReadFailure === `armed:${ref}` && args.includes('-w')) {
        armManifestReadFailure = undefined
        rejectRestoreWrite = ref
        return { status: 1, stdout: '' }
      }
      if (!keychain.has(ref)) return { status: 44, stdout: '' }
      return { status: 0, stdout: args.includes('-w') ? `${keychain.get(ref)}\n` : '' }
    }
    if (args[0] === 'delete-generic-password') {
      if (rejectedDeletes.has(ref)) return { status: 1, stdout: '' }
      return { status: keychain.delete(ref) ? 0 : 44, stdout: '' }
    }
    return { status: 1, stdout: '' }
  })
  await mac.set('CONNECTOR_TOKEN', 'mac-secret')
  assert.equal(await mac.get('CONNECTOR_TOKEN'), 'mac-secret')
  assert.equal(await mac.has('CONNECTOR_TOKEN'), true)
  assert.equal(await mac.unset('CONNECTOR_TOKEN'), true)

  const firstLongValue = 's'.repeat(4_096)
  const secondLongValue = 't'.repeat(8_192)
  await mac.set('SESSION_TOKEN', firstLongValue)
  assert.equal(await mac.get('SESSION_TOKEN'), firstLongValue)
  const firstGeneration = [...keychain.keys()].filter(ref => ref.startsWith('SESSION_TOKEN_EMATE1_'))
  assert.ok(firstGeneration.length > 1)
  await mac.set('SESSION_TOKEN', secondLongValue)
  assert.equal(await mac.get('SESSION_TOKEN'), secondLongValue)
  assert.ok(firstGeneration.every(ref => !keychain.has(ref)))

  const committedEntries = new Set(keychain.keys())
  rejectedChunkSuffix = '_2'
  await assert.rejects(mac.set('SESSION_TOKEN', 'u'.repeat(12_288)), /macOS Keychain operation failed/)
  rejectedChunkSuffix = undefined
  assert.deepEqual(new Set(keychain.keys()), committedEntries)
  assert.equal(await mac.get('SESSION_TOKEN'), secondLongValue)

  let enteredConcurrentChunk
  const concurrentChunk = new Promise(resolve => { enteredConcurrentChunk = resolve })
  concurrentChunkEntered = enteredConcurrentChunk
  blockConcurrentChunk = true
  const firstConcurrentSet = mac.set('CONCURRENT_TOKEN', 'a'.repeat(1_024))
  await concurrentChunk
  const commandsBeforeSecondSet = macCommands.length
  const secondConcurrentSet = mac.set('CONCURRENT_TOKEN', 'b'.repeat(1_024))
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(macCommands.length, commandsBeforeSecondSet)
  releaseConcurrentChunk()
  await Promise.all([firstConcurrentSet, secondConcurrentSet])
  assert.equal(await mac.get('CONCURRENT_TOKEN'), 'b'.repeat(1_024))

  await mac.set('CLEANUP_TOKEN', 'c'.repeat(1_024))
  const staleChunk = [...keychain.keys()].find(ref => ref.startsWith('CLEANUP_TOKEN_EMATE1_'))
  assert.ok(staleChunk)
  rejectedDeletes.add(staleChunk)
  await mac.set('CLEANUP_TOKEN', 'd'.repeat(1_024))
  assert.equal(await mac.get('CLEANUP_TOKEN'), 'd'.repeat(1_024))
  assert.equal(keychain.has(staleChunk), true)
  rejectedDeletes.clear()

  await mac.set('ROLLBACK_TOKEN', 'e'.repeat(1_024))
  armManifestReadFailure = 'ROLLBACK_TOKEN'
  await assert.rejects(mac.set('ROLLBACK_TOKEN', 'f'.repeat(1_024)), /rollback failed/)
  assert.equal(await mac.get('ROLLBACK_TOKEN'), 'f'.repeat(1_024))

  const activeChunk = [...keychain.keys()].find(ref => ref.startsWith('SESSION_TOKEN_EMATE1_'))
  assert.ok(activeChunk)
  keychain.set(activeChunk, Buffer.from('tampered').toString('base64'))
  await assert.rejects(mac.get('SESSION_TOKEN'), /integrity check failed/)
  assert.equal(await mac.unset('SESSION_TOKEN'), true)
  assert.equal([...keychain.keys()].some(ref => ref.startsWith('SESSION_TOKEN')), false)

  const macSet = macCommands.find(command => command.file === '/usr/bin/expect')
  assert.equal(macSet.args[0], '-c')
  assert.equal(macSet.args.includes('mac-secret'), false)
  assert.equal(macSet.args.includes(Buffer.from('mac-secret').toString('base64')), false)
  assert.equal(macSet.input.trim(), Buffer.from('mac-secret').toString('base64'))

  const dshHome = mkdtempSync(join(tmpdir(), 'e-mate-dpapi-'))
  const powershell = async (file, args, input) => {
    assert.equal(file, 'powershell.exe')
    assert.deepEqual(args.slice(0, 3), ['-NoProfile', '-NonInteractive', '-Command'])
    assert.match(args[3], /Add-Type -AssemblyName System\.Security/)
    assert.match(args[3], /System\.Security\.Cryptography\.ProtectedData/)
    assert.match(args[3], /System\.Security\.Cryptography\.DataProtectionScope\]::CurrentUser/)
    const request = JSON.parse(input)
    if (request.op === 'probe') return { status: 0, stdout: 'ok' }
    if (request.op === 'protect') {
      return { status: 0, stdout: Buffer.from(`cipher:${request.value_base64}`).toString('base64') }
    }
    const wrapped = Buffer.from(request.value_base64, 'base64').toString('utf8')
    return { status: 0, stdout: wrapped.slice('cipher:'.length) }
  }
  try {
    const windows = createOsCredentialBackend('win32', dshHome, powershell)
    await windows.set('CONNECTOR_TOKEN', 'windows-secret')
    assert.equal(await windows.get('CONNECTOR_TOKEN'), 'windows-secret')
    const storedPath = join(dshHome, 'e-mate', 'credentials', 'CONNECTOR_TOKEN.dpapi')
    assert.equal(readFileSync(storedPath, 'utf8').includes('windows-secret'), false)
    assert.equal(await windows.unset('CONNECTOR_TOKEN'), true)
    assert.deepEqual(await checkOsCredentialBackend('win32', powershell), {
      ok: true,
      detail: 'Windows CurrentUser DPAPI available',
    })
  } finally {
    rmSync(dshHome, { recursive: true, force: true })
  }
})

test('managed profile exposes only user-facing plugin capabilities', () => {
  const dshHome = mkdtempSync(join(tmpdir(), 'e-mate-capability-profile-'))
  try {
    const paths = installProfile(dshHome)
    const visible = new Set([
      '@e-mate/dsh-plugin-office-skills',
      '@e-mate/dsh-plugin-tool-search',
      '@e-mate/dsh-plugin-cdp',
    ])
    const packages = [
      '@e-mate/dsh-plugin-better-sidebar',
      '@e-mate/dsh-plugin-cdp',
      '@e-mate/dsh-plugin-computer-use',
      '@e-mate/dsh-plugin-file-import',
      '@e-mate/dsh-plugin-find-skill',
      '@e-mate/dsh-plugin-genui',
      '@e-mate/dsh-plugin-mcp-manage',
      '@e-mate/dsh-plugin-memory-evolve',
      '@e-mate/dsh-plugin-office-skills',
      '@e-mate/dsh-plugin-schedules',
    ]
    for (const name of packages) {
      const pluginRoot = join(paths.profile, 'node_modules', ...name.split('/'))
      const pluginManifest = JSON.parse(readFileSync(join(pluginRoot, 'package.json'), 'utf8'))
      const source = readFileSync(join(pluginRoot, pluginManifest.main), 'utf8')
      if (visible.has(name)) assert.match(source, /emateCapabilities/)
      else assert.doesNotMatch(source, /emateCapabilities/)
    }
  } finally {
    rmSync(dshHome, { recursive: true, force: true })
  }
})

test('capability registry projects only registered plugin metadata and actions', async () => {
  let handler
  let registry
  applyCapabilities({
    connection: { rpc: { handle: (channel, callback, options) => {
      assert.equal(channel, CAPABILITIES_CHANNEL)
      assert.deepEqual(options, { authority: 'loopback' })
      handler = callback
      return async () => {}
    } } },
    provide: (name, value) => {
      assert.equal(name, 'emateCapabilities')
      registry = value
    },
    effect: effect => effect(),
  })
  const dispose = registry.register({
    id: 'office',
    title: 'Office',
    summary: 'Create and edit documents.',
    icon_key: 'office',
    order: 20,
    actions: [
      { id: 'setup', label: '设置', kind: 'primary' },
      { id: 'credential', label: '配置凭据', kind: 'primary', input: 'credential' },
    ],
    status: async () => ({
      state: 'setup-required', detail: '首次使用需要配置。',
      action_ids: ['setup', 'credential'], credential_refs: { credential: 'OFFICE_API_KEY' },
    }),
    invoke: async (action, data) => ({ action, data, accepted: true }),
  })
  const listed = await handler('list', {})
  assert.equal(listed.value.schema_version, 1)
  assert.deepEqual(listed.value.items.map(item => [item.id, item.state]), [['office', 'setup-required']])
  assert.equal(listed.value.items[0].icon_key, 'office')
  assert.deepEqual(listed.value.items[0].actions[1], {
    id: 'credential', label: '配置凭据', kind: 'primary', input: 'credential', credential_ref: 'OFFICE_API_KEY',
  })
  const acted = await handler('action', { capability_id: 'office', action_id: 'setup', data: { source: 'user' } })
  assert.deepEqual(acted.value.result, { action: 'setup', data: { source: 'user' }, accepted: true })
  assert.equal((await handler('action', { capability_id: 'office', action_id: 'credential', data: { secret: 'must-not-pass' } })).error.code, 'bad-request')
  assert.equal((await handler('action', { capability_id: 'office', action_id: 'missing', data: {} })).error.code, 'bad-request')
  assert.throws(() => registry.register({
    id: 'bad-icon', title: 'Bad', summary: 'Bad icon.', icon_key: 'emoji', order: 99,
    actions: [], status: async () => ({ state: 'blocked', action_ids: [] }),
  }), /invalid e-Mate capability definition/)
  assert.throws(() => registry.register({ id: 'office' }), /invalid e-Mate capability definition/)
  dispose()
  assert.deepEqual((await handler('list', {})).value.items, [])
})


test('Agent QR generation uses the target Tool, Job, Attachment, and image renderer path', async () => {
  const temporary = mkdtempSync(join(tmpdir(), 'e-mate-qr-generation-'))
  const context = new Context()
  let attachmentFiber
  try {
    const paths = installProfile(join(temporary, 'dsh-home'))
    attachmentFiber = await context.plugin(LocalAttachmentStore, { dshHome: join(temporary, 'dsh-home') })
    const tools = new Map()
    const jobs = []
    const controllers = []
    await applyQrGeneration({
      tools: { register: tool => { tools.set(tool.name, tool); return () => tools.delete(tool.name) } },
      jobs: {
        attachController: kind => { controllers.push(kind); return () => {} },
        start(spec) {
          assert.equal(spec.kind, 'emate-qr')
          assert.equal(spec.owner.id, 'qr-session')
          const id = `emate-qr-${jobs.length + 1}`
          const run = spec.run()
          jobs.push({ id, spec, ...run })
          return id
        },
      },
      attachments: context.attachments,
      effect: effect => effect(),
    }, { bindingPath: join(paths.profile, 'plugins', 'runtime-binding.json') })

    assert.deepEqual([...tools.keys()], ['e_mate_qr_generate'])
    assert.deepEqual(controllers, ['emate-qr'])
    const tool = tools.get('e_mate_qr_generate')
    assert.match(tool.description, /never encode passwords, API keys/iu)
    const result = await tool.execute({ content: 'https://example.com/e-mate' }, {
      agent: { id: 'qr-session' },
      signal: new AbortController().signal,
    })
    assert.match(result.image.attachmentId, /^sha256:[0-9a-f]{64}$/u)
    assert.equal(result.image.mediaType, 'image/png')
    assert.equal(tool.output.render({}, result).some(block => block.type === 'image'), true)
    assert.equal((await jobs[0].done).output, '{"image_count":1}')
    assert.doesNotMatch(JSON.stringify(await jobs[0].done), /example\.com/u)
    const stored = await context.attachments.readImage(result.image, new AbortController().signal)
    assert.equal(Buffer.from(stored.data).subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), true)
    await assert.rejects(
      tool.execute({ content: 'x'.repeat(1025) }, { agent: { id: 'qr-session' }, signal: new AbortController().signal }),
      /1 to 1024 UTF-8 bytes/u,
    )
    await assert.rejects(
      tool.execute({ content: 'safe', model: 'external' }, { agent: { id: 'qr-session' }, signal: new AbortController().signal }),
      /accepts only content/u,
    )
  } finally {
    await attachmentFiber?.dispose()
    await context.fiber.dispose()
    rmSync(temporary, { recursive: true, force: true })
  }
})

test('image capability stays visible and inert until its managed endpoint is configured', async () => {
  for (const [config, state] of [
    [{}, 'setup-required'],
    [{ rootUrl: 'http://model.example/e-mate/model-api/v1' }, 'blocked'],
  ]) {
    const registered = []
    await applyImageGeneration({
      get: name => name === 'emateCapabilities'
        ? { register: definition => { registered.push(definition); return () => {} } }
        : undefined,
      effect: effect => effect(),
    }, config)
    assert.equal(registered.length, 1)
    assert.equal(registered[0].id, 'image-generation')
    assert.equal(registered[0].icon_key, 'image')
    assert.deepEqual(registered[0].actions, [])
    assert.deepEqual(await registered[0].status(), {
      state,
      detail: state === 'setup-required'
        ? '企业管理端尚未下发生图服务地址。'
        : 'e-Mate managed image gateway must be a fixed HTTPS Model Gateway /v1 endpoint',
      action_ids: [],
    })
  }
})

test('image generation reuses the Model Gateway with Harness Jobs and attachments', async () => {
  const temporary = mkdtempSync(join(tmpdir(), 'e-mate-image-generation-'))
  const context = new Context()
  const cleanups = []
  let attachmentFiber
  try {
    const paths = installProfile(join(temporary, 'dsh-home'))
    attachmentFiber = await context.plugin(LocalAttachmentStore, { dshHome: join(temporary, 'dsh-home') })
    const inputBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')
    const requests = []
    const requestScopes = []
    let remoteCounter = 0
    let nextFailureStatus
    let activeSubmissions = 0
    let maximumSubmissions = 0
    const json = (value, status = 200) => new Response(JSON.stringify(value), {
      status,
      headers: { 'content-type': 'application/json' },
    })
    const identity = {
      async request(url, init = {}) {
        assert.equal(url.origin, 'https://model.example')
        assert.equal(url.pathname.startsWith('/e-mate/model-api/v1/images/'), true)
        const outgoing = new Request(url, init)
        requestScopes.push({
          task: outgoing.headers.get('x-e-mate-task-id'),
          trace: outgoing.headers.get('x-e-mate-trace-id'),
          session: outgoing.headers.get('session_id'),
          client: outgoing.headers.get('x-client-request-id'),
        })
        activeSubmissions += 1
        maximumSubmissions = Math.max(maximumSubmissions, activeSubmissions)
        await new Promise(resolveImmediate => setImmediate(resolveImmediate))
        activeSubmissions -= 1
        if (url.pathname.endsWith('/generations')) {
          requests.push({ path: url.pathname, body: await outgoing.json() })
        } else if (url.pathname.endsWith('/edits')) {
          const form = await outgoing.formData()
          const images = [...form.entries()].filter(([key]) => key === 'image' || key === 'image[]')
          requests.push({
            path: url.pathname,
            body: {
              model: form.get('model'),
              prompt: form.get('prompt'),
              imageFields: images.map(([key]) => key),
              imageBytes: await Promise.all(images.map(([, value]) => value.arrayBuffer().then(buffer => buffer.byteLength))),
            },
          })
        } else {
          throw new Error(`unexpected managed image request ${init.method ?? 'GET'} ${url.pathname}`)
        }
        if (nextFailureStatus !== undefined) {
          const status = nextFailureStatus
          nextFailureStatus = undefined
          return json({ error: 'upstream unavailable' }, status)
        }
        return json({
          id: `image-response-${++remoteCounter}`,
          data: [{ b64_json: inputBytes.toString('base64') }],
          usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
        })
      },
    }
    const tools = new Map()
    const jobs = []
    const waitedJobs = []
    const controllers = []
    const capabilities = []
    const policyModels = []
    let sandboxMode = 'read-only'
    let preStep
    const modelPolicy = { assertModel: async model => { policyModels.push(model) } }
    const pluginCtx = {
      tools: { register: tool => { tools.set(tool.name, tool); return () => { tools.delete(tool.name) } } },
      jobs: {
        attachController: kind => { controllers.push(kind); return () => {} },
        start(spec) {
          assert.equal(spec.kind, 'emate-image')
          assert.equal(spec.owner.id, 'image-session')
          const id = `emate-image-${jobs.length + 1}`
          const run = spec.run()
          jobs.push({ id, spec, ...run })
          return id
        },
        async wait(id, _timeoutMs, owner) {
          const job = jobs.find(value => value.id === id)
          assert.ok(job)
          assert.equal(owner.id, 'image-session')
          waitedJobs.push(id)
          const outcome = await job.done
          return { id, kind: job.spec.kind, label: job.spec.label, status: outcome.status, reported: true }
        },
      },
      attachments: context.attachments,
      sandboxPolicy: { resolve: () => ({ mode: sandboxMode, workspaceRoot: temporary }) },
      get: name => name === 'emateIdentity'
        ? identity
        : name === 'emateModelPolicy'
          ? modelPolicy
          : name === 'emateCapabilities'
            ? { register: definition => { capabilities.push(definition); return () => {} } }
            : undefined,
      effect(effect) {
        const cleanup = effect()
        if (typeof cleanup === 'function') cleanups.push(cleanup)
        return cleanup
      },
      on(name, listener) {
        assert.equal(name, 'agent/pre-step')
        preStep = listener
        return () => {}
      },
    }
    await applyImageGeneration(pluginCtx, {
      bindingPath: join(paths.profile, 'plugins', 'runtime-binding.json'),
      rootUrl: 'https://model.example/e-mate/model-api/v1',
    })
    assert.deepEqual([...tools.keys()], ['imagegen', 'image_pack'])
    assert.deepEqual(controllers, ['emate-image'])
    assert.equal(typeof preStep, 'function')
    assert.equal(capabilities.length, 1)
    assert.deepEqual(await capabilities[0].status(), {
      state: 'ready',
      detail: 'gpt-image-2-pro',
      action_ids: [],
    })
    const sessionMessages = []
    const sessionEvents = []
    const agent = {
      id: 'image-session',
      session: {
        header: { id: 'image-session', cwd: temporary },
        events: sessionEvents,
        append(type, data, options) {
          sessionEvents.push({ type, data, ...options, seq: sessionEvents.length, time: Date.now() })
        },
        deriveMessages: () => sessionMessages,
      },
    }
    let callIndex = 0
    const execution = () => ({
      agent,
      callId: `image-call-${++callIndex}`,
      signal: new AbortController().signal,
    })
    const imagegen = tools.get('imagegen')
    assert.deepEqual(Object.keys(imagegen.parameters.properties), ['prompt', 'image_url'])
    assert.deepEqual(imagegen.parameters.required, ['prompt'])
    assert.match(imagegen.description, /Never pass a provider, model, output path, size, quality, timeout, or concurrency policy/u)

    const selected = await context.attachments.saveImage({
      data: inputBytes,
      mediaType: 'image/png',
      name: 'selected-locally.png',
    })
    const userUpload = {
      id: 'local-upload-message',
      role: 'user',
      source: { kind: 'user' },
      content: [{ type: 'image', attachment: selected }, { type: 'text', text: '请修改这张图。' }],
    }
    const admitted = await preStep({ agent, messages: [userUpload] }, async () => ({ kind: 'enter', messages: [userUpload] }))
    assert.equal(admitted.messages.length, 2)
    assert.deepEqual(admitted.messages[0], userUpload)
    assert.deepEqual(admitted.messages[1].source, {
      kind: 'plugin', plugin: '@e-mate/dsh-image-generation', form: 'catalog',
    })
    assert.match(admitted.messages[1].content[0].text, new RegExp(selected.attachmentId))
    assert.match(admitted.messages[1].content[0].text, /never ask the user to upload an image already listed here/u)

    const textOnly = { ...userUpload, id: 'text-only-message', content: [{ type: 'text', text: '只生成一张新图。' }] }
    const unchanged = await preStep({ agent, messages: [textOnly] }, async () => ({ kind: 'enter', messages: [textOnly] }))
    assert.deepEqual(unchanged.messages, [textOnly])
    sessionMessages.push(textOnly)

    const generated = await imagegen.execute({ prompt: 'Generate one verified image.' }, execution())
    assert.equal(generated.images.length, 1)
    assert.equal(generated.images[0].model, 'gpt-image-2-pro')
    assert.equal(sessionEvents.at(-1)?.type, 'emate/image-output')
    assert.equal(sessionEvents.at(-1)?.ignorable, true)
    assert.deepEqual(requests.at(-1), {
      path: '/e-mate/model-api/v1/images/generations',
      body: { model: 'gpt-image-2-pro', prompt: 'Generate one verified image.' },
    })
    const generatedContent = imagegen.output.render({}, generated)
    const attachmentId = String(generated.images[0].image.attachmentId)
    assert.deepEqual(await jobs.at(-1).done, {
      status: 'completed',
      detail: '1 image, 0 failures',
      output: JSON.stringify({
        image_count: 1,
        failure_count: 0,
        request_ids: [generated.images[0].request_id],
        attachment_ids: [attachmentId],
      }),
    })
    assert.equal(generatedContent.some(block => block.type === 'image'), false)
    assert.equal(generatedContent.some(block => block.type === 'text' && block.text.includes(attachmentId)), true)
    assert.deepEqual(sessionEvents.at(-1), {
      type: 'emate/image-output',
      ignorable: true,
      data: {
        call_id: 'image-call-1',
        content: [{ type: 'image', attachment: generated.images[0].image }],
      },
      seq: 0,
      time: sessionEvents[0].time,
    })
    sessionMessages.push({
      id: 'generated-tool-result',
      source: { kind: 'tool', callId: 'image-call-1' },
      content: [{
        type: 'tool-result',
        toolCallId: 'image-call-1',
        isError: false,
        content: generatedContent,
      }],
    })

    const modifyAbove = {
      id: 'modify-above-message', role: 'user', source: { kind: 'user' },
      content: [{ type: 'text', text: '就直接修改上图，不要让我重新上传。' }],
    }
    const resumed = await preStep({ agent, messages: [...sessionMessages, modifyAbove] }, async () => ({
      kind: 'enter', messages: [...sessionMessages, modifyAbove],
    }))
    assert.match(resumed.messages.at(-1).content[0].text, new RegExp(attachmentId))
    assert.match(resumed.messages.at(-1).content[0].text, /normally the newest image/u)
    sessionMessages.push(modifyAbove)

    const implicitEdit = await imagegen.execute({ prompt: 'Retouch the referenced image only.' }, execution())
    assert.equal(implicitEdit.images.length, 1)
    assert.deepEqual(requests.at(-1), {
      path: '/e-mate/model-api/v1/images/edits',
      body: {
        model: 'gpt-image-2-pro',
        prompt: 'Retouch the referenced image only.',
        imageFields: ['image'],
        imageBytes: [inputBytes.byteLength],
      },
    })

    sessionMessages.push({
      id: 'modify-text-on-image', role: 'user', source: { kind: 'user' },
      content: [{ type: 'text', text: '图上的方林改为圣都。' }],
    })
    await imagegen.execute({ prompt: '把图片中的方林改成圣都。' }, execution())
    assert.equal(requests.at(-1).path, '/e-mate/model-api/v1/images/edits')

    sessionMessages.push({
      id: 'new-map-image', role: 'user', source: { kind: 'user' },
      content: [{ type: 'text', text: '生成一张地图上的路线图。' }],
    })
    await imagegen.execute({ prompt: '生成一张地图上的路线图。' }, execution())
    assert.equal(requests.at(-1).path, '/e-mate/model-api/v1/images/generations')

    const edited = await imagegen.execute({
      prompt: 'Retouch only the supplied image.',
      image_url: [attachmentId],
    }, execution())
    assert.equal(edited.images[0].model, 'gpt-image-2-pro')
    assert.deepEqual(requests.at(-1), {
      path: '/e-mate/model-api/v1/images/edits',
      body: {
        model: 'gpt-image-2-pro',
        prompt: 'Retouch only the supplied image.',
        imageFields: ['image'],
        imageBytes: [inputBytes.byteLength],
      },
    })

    const second = await context.attachments.saveImage({
      data: readFileSync(new URL('../../../upstream/deepseek-harness/examples/acp-agent/tests/snapshots/read-image/workspace/red.png', import.meta.url)),
      mediaType: 'image/png',
      name: 'red.png',
    })
    await assert.rejects(
      imagegen.execute({ prompt: 'Edit both current images independently.' }, {
        agent: {
          id: 'multi-image-session',
          session: {
            header: { id: 'multi-image-session', cwd: temporary },
            events: [],
            deriveMessages: () => [{
              id: 'multi-image-message', role: 'user', source: { kind: 'user' },
              content: [
                { type: 'image', attachment: selected },
                { type: 'image', attachment: second },
                { type: 'text', text: '分别修改这两张图。' },
              ],
            }],
          },
        },
        callId: 'multi-image-call', signal: new AbortController().signal,
      }),
      /multiple source images.*exact attachment ID/iu,
    )
    sessionMessages.push({
      id: 'second-tool-result', source: { kind: 'tool', callId: 'image-call-pack' },
      content: [{
        type: 'tool-result', toolCallId: 'image-call-pack', isError: false,
        content: [{ type: 'image', attachment: second }],
      }],
    })
    const imagePack = tools.get('image_pack')
    await assert.rejects(
      imagePack.execute({ image_url: [attachmentId, second.attachmentId] }, execution()),
      /read-only sandbox policy/u,
    )
    assert.equal(existsSync(join(temporary, '.e-mate', 'images')), false)
    sandboxMode = 'workspace-write'
    const packed = await imagePack.execute({ image_url: [attachmentId, second.attachmentId] }, execution())
    assert.equal(packed.image_count, 2)
    assert.match(packed.relative_path, /^\.e-mate\/images\/e-Mate-images-[0-9a-f]{12}\.zip$/u)
    const archive = unzipSync(readFileSync(join(temporary, packed.relative_path)))
    assert.deepEqual(Object.keys(archive), ['image-001.png', 'image-002.png'])
    assert.equal(Buffer.from(archive['image-001.png']).equals(inputBytes), true)
    assert.equal(Buffer.from(archive['image-002.png']).equals(readFileSync(new URL('../../../upstream/deepseek-harness/examples/acp-agent/tests/snapshots/read-image/workspace/red.png', import.meta.url))), true)
    assert.deepEqual(imagePack.presentCall({ image_url: [attachmentId, second.attachmentId] }), {
      card: 'generic', title: '打包图片', kind: 'edit', rawInput: '2 images',
      locations: [{ path: packed.relative_path }],
    })
    assert.match(imagePack.output.render({}, packed)[0].text, /2 张图片打包到本地产物/u)
    sandboxMode = 'danger-full-access'
    assert.deepEqual(
      await imagePack.execute({ image_url: [attachmentId, second.attachmentId] }, execution()),
      packed,
    )

    sessionMessages.push({
      id: 'new-variants-message', role: 'user', source: { kind: 'user' },
      content: [{ type: 'text', text: '生成两个全新的独立方案。' }],
    })
    const concurrent = await Promise.all([
      imagegen.execute({ prompt: 'Generate independent variant A.' }, execution()),
      imagegen.execute({ prompt: 'Generate independent variant B.' }, execution()),
    ])
    assert.deepEqual(concurrent.map(result => result.images.length), [1, 1])
    assert.equal(maximumSubmissions >= 2, true)
    assert.deepEqual(policyModels, Array(7).fill('gpt-image-2-pro'))
    assert.deepEqual(waitedJobs, jobs.map(job => job.id))
    assert.equal(requests.every(request => !('provider' in request.body) && !('api_key' in request.body)), true)
    const firstScope = `image-${createHash('sha256').update('image-session\0image-call-1').digest('hex').slice(0, 32)}`
    assert.deepEqual(requestScopes[0], { task: firstScope, trace: firstScope, session: firstScope, client: firstScope })
    assert.equal(new Set(requestScopes.map(scope => scope.task)).size, 7)
    await assert.rejects(
      imagegen.execute({ prompt: 'Edit missing image.', image_url: `sha256:${'f'.repeat(64)}` }, execution()),
      /not present in this e-Mate session/,
    )
    await assert.rejects(
      imagegen.execute({ prompt: 'Do not accept caller-selected model.', model: 'gpt-image-2' }, execution()),
      /additional property|only prompt and optional image_url/iu,
    )
    await assert.rejects(
      imagegen.execute({ prompt: 'Modify the above image only.' }, {
        agent: {
          id: 'empty-image-session',
          session: {
            header: { id: 'empty-image-session', cwd: temporary },
            deriveMessages: () => [{
              id: 'empty-edit', role: 'user', source: { kind: 'user' },
              content: [{ type: 'text', text: '修改上图。' }],
            }],
          },
        },
        callId: 'empty-edit-call', signal: new AbortController().signal,
      }),
      /needs a source image.*upload one image once/u,
    )
    const requestsBeforeFailure = requests.length
    nextFailureStatus = 503
    await assert.rejects(
      imagegen.execute({ prompt: 'Do not retry an unknown upstream failure.' }, execution()),
      /HTTP 503/u,
    )
    assert.equal(requests.length, requestsBeforeFailure + 1)
    assert.deepEqual(waitedJobs, jobs.map(job => job.id))
  } finally {
    for (const cleanup of cleanups.reverse()) await cleanup()
    await attachmentFiber?.dispose()
    await context.fiber.dispose()
    rmSync(temporary, { recursive: true, force: true })
  }
})

test('Agent operation guidance owns only the e-Mate persona', () => {
  let section
  applyAgentOperations({
    systemPrompt: { section: value => { section = value } },
  })
  assert.equal(section.name, 'emate:agent-operations')
  assert.equal(section.order, 180)
  assert.match(section.text, /我是小芯，你的 AI 办公助手/u)
  assert.match(section.text, /运行在 e-Mate 内，是亦芯开发的全场景办公 AI Agent/u)
  assert.match(section.text, /Never use Bash, PowerShell, npm, pnpm/)
  assert.match(section.text, /e_mate_desktop_update/)
  assert.doesNotMatch(section.text, /e-mate update --json|e_mate_skill_hub_/)
  assert.match(section.text, /installed find-skill provider/u)
  assert.match(section.text, /use `mcp_manage`/u)
  assert.match(section.text, /user-visible Chrome page exposed through the DSH CDP adapter/u)
  assert.match(section.text, /Do not invent a built-in connector or ask the user to paste secrets into chat/u)
})

test('identity agreements are immutable, explicit, and use the target Connection RPC', async () => {
  assert.equal(agreementDocuments.length, 2)
  assert.match(agreementBundleSha256, /^[0-9a-f]{64}$/)
  assert.deepEqual(requiredAcknowledgements, [
    'agreements_read',
    'ai_output_requires_human_verification',
    'lawful_use_and_ai_labels',
  ])
  for (const document of agreementDocuments) {
    assert.match(document.sha256, /^[0-9a-f]{64}$/)
    assert.match(document.markdown, /人工核实|AI 输出/u)
  }
  assert.deepEqual(describeAgreements().blocker, 'provider-identity-not-configured')
  assert.equal(describeAgreements('  亦芯测试主体  ').provider_legal_name, '亦芯测试主体')
  assert.deepEqual(
    describeAgreements('亦芯测试主体').acknowledgements.map(item => item.id),
    requiredAcknowledgements,
  )

  let registration
  let identity
  const ctx = {
    connection: {
      rpc: {
        handle: (channel, handler, options) => {
          registration = { channel, handler, options }
          return async () => {}
        },
      },
    },
    provide: (name, value) => {
      assert.equal(name, 'emateIdentity')
      identity = value
    },
    effect: effect => effect(),
  }
  applyIdentity(ctx, { providerLegalName: '亦芯测试主体' })
  assert.equal(registration.channel, IDENTITY_CHANNEL)
  assert.deepEqual(registration.options, { authority: 'loopback' })
  const described = await registration.handler('agreements.describe', {}, AbortSignal.abort())
  assert.equal(described.ok, true)
  assert.equal(described.value.ready, true)
  assert.equal(described.value.documents.length, 2)
  const blocked = await registration.handler('identity.bootstrap', {})
  assert.equal(blocked.ok, true)
  assert.equal(blocked.value.ready, false)
  assert.equal(blocked.value.workspace_unlocked, false)
  assert.equal((await registration.handler('agreements.describe', { extra: true })).error.code, 'bad-request')
  assert.equal((await registration.handler('other', {})).error.code, 'bad-request')
  await assert.rejects(identity.request(new URL('https://dl.ecoremedia.net/')), /identity transport is unavailable/)
  await assert.rejects(identity.uploadAudit([]), /audit transport is unavailable/)

  let configuredRegistration
  let authenticated = false
  let archived = false
  let activePassword = 'secret-value'
  let challengeExpiresAt = '2030-01-01T00:00:00.000Z'
  const captchaImage = `data:image/png;base64,${Buffer.from('captcha-image').toString('base64')}`
  applyIdentity({
    connection: { rpc: { handle: (_channel, handler) => {
      configuredRegistration = handler
      return async () => {}
    } } },
    provide: () => {},
    effect: effect => effect(),
  }, {
    providerLegalName: '亦芯测试主体',
    identityProvider: {
      bootstrap: async () => ({
        authenticated,
        workspace_unlocked: authenticated && archived,
        ...(authenticated ? { account_status: 'active', weekly_token_limit: 50_000 } : {}),
        ...(archived ? { agreement_receipt_id: 'receipt-1' } : {}),
      }),
      usage: async timezone => ({
        schema_version: 1,
        scope: 'account',
        timezone,
        week: { total_tokens: 12_345 },
        week_started_at: '2030-01-07T00:00:00.000Z',
        calculated_at: '2030-01-08T00:00:00.000Z',
      }),
      issueRegistrationChallenge: async () => ({
        schema_version: 1,
        challenge_id: 'registration_challenge:test-1',
        image_data_url: captchaImage,
        expires_at: challengeExpiresAt,
      }),
      register: async ({ account, real_name, password, challenge_id, verification_code }) => {
        assert.equal(account, 'test.user')
        assert.equal(real_name, '测试用户')
        assert.equal(password, 'registration-secret')
        assert.equal(challenge_id, 'registration_challenge:test-1')
        assert.equal(verification_code, 'A207')
        return { schema_version: 1, registration_id: 'registration:test-1', status: 'pending_approval' }
      },
      login: async ({ identifier, password, remember_login }) => {
        assert.equal(identifier, 'user@example.com')
        assert.equal(password, activePassword)
        assert.equal(remember_login, true)
        authenticated = true
      },
      acceptAgreements: async ({ bundle_sha256, acknowledgements }) => {
        assert.equal(bundle_sha256, agreementBundleSha256)
        assert.deepEqual(acknowledgements, requiredAcknowledgements)
        archived = true
      },
      changePassword: async ({ current_password, new_password, client_request_id }) => {
        assert.equal(current_password, activePassword)
        assert.equal(new_password, 'new-secret-value')
        assert.equal(client_request_id, 'session_password:test-1')
        activePassword = new_password
        authenticated = false
        return { receipt_id: 'password-receipt-1', reauthentication_required: true }
      },
      logout: async ({ client_request_id }) => {
        assert.equal(client_request_id, 'session_logout:test-1')
        authenticated = false
        return { receipt_id: 'logout-receipt-1' }
      },
    },
  })
  const challenge = await configuredRegistration('verification.issue', { purpose: 'registration' })
  assert.equal(challenge.value.image_data_url, captchaImage)
  challengeExpiresAt = '2020-01-01T00:00:00.000Z'
  await assert.rejects(
    configuredRegistration('verification.issue', { purpose: 'registration' }),
    /registration challenge is invalid/,
  )
  challengeExpiresAt = '2030-01-01T00:00:00.000Z'
  const registered = await configuredRegistration('session.register', {
    account: ' test.user ',
    real_name: ' 测试用户 ',
    password: 'registration-secret',
    challenge_id: 'registration_challenge:test-1',
    verification_code: ' A207 ',
  })
  assert.equal(registered.value.status, 'pending_approval')
  assert.equal((await configuredRegistration('session.register', {
    account: 'x',
    real_name: '测试用户',
    password: 'registration-secret',
    challenge_id: 'registration_challenge:test-1',
    verification_code: 'A207',
  })).error.code, 'bad-request')
  const loggedIn = await configuredRegistration('session.login', {
    identifier: ' user@example.com ',
    password: 'secret-value',
    remember_login: true,
  })
  assert.equal(loggedIn.value.authenticated, true)
  assert.equal(loggedIn.value.workspace_unlocked, false)
  const accepted = await configuredRegistration('agreements.accept', {
    bundle_sha256: agreementBundleSha256,
    acknowledgements: [...requiredAcknowledgements],
  })
  assert.equal(accepted.value.workspace_unlocked, true)
  assert.equal(accepted.value.agreement_receipt_id, 'receipt-1')
  const usage = await configuredRegistration('identity.usage', { timezone: 'Asia/Shanghai' })
  assert.equal(usage.value.week.total_tokens, 12_345)
  assert.equal((await configuredRegistration('identity.usage', { timezone: '' })).error.code, 'bad-request')
  const passwordChanged = await configuredRegistration('session.password', {
    client_request_id: 'session_password:test-1',
    current_password: 'secret-value',
    new_password: 'new-secret-value',
  })
  assert.equal(passwordChanged.value.receipt_id, 'password-receipt-1')
  assert.equal(passwordChanged.value.reauthentication_required, true)
  assert.equal(passwordChanged.value.state.authenticated, false)
  assert.equal(passwordChanged.value.state.workspace_unlocked, false)
  assert.equal((await configuredRegistration('session.password', {
    client_request_id: 'short',
    current_password: 'secret-value',
    new_password: 'new-secret-value',
  })).error.code, 'bad-request')
  const relogged = await configuredRegistration('session.login', {
    identifier: 'user@example.com',
    password: 'new-secret-value',
    remember_login: true,
  })
  assert.equal(relogged.value.workspace_unlocked, true)
  const loggedOut = await configuredRegistration('session.logout', {
    client_request_id: 'session_logout:test-1',
    confirmed: true,
  })
  assert.equal(loggedOut.value.receipt_id, 'logout-receipt-1')
  assert.equal(loggedOut.value.state.authenticated, false)
  assert.equal((await configuredRegistration('session.logout', {
    client_request_id: 'session_logout:test-2',
    confirmed: false,
  })).error.code, 'bad-request')
  assert.equal((await configuredRegistration('agreements.accept', {
    bundle_sha256: agreementBundleSha256,
    acknowledgements: requiredAcknowledgements.slice(0, 2),
  })).error.code, 'bad-request')

  let invalidBootstrap
  applyIdentity({
    connection: { rpc: { handle: (_channel, handler) => {
      invalidBootstrap = handler
      return async () => {}
    } } },
    provide: () => {},
    effect: effect => effect(),
  }, {
    providerLegalName: '亦芯测试主体',
    identityProvider: { bootstrap: async () => ({ authenticated: true, workspace_unlocked: false }) },
  })
  await assert.rejects(
    invalidBootstrap('identity.bootstrap', {}),
    /identity bootstrap is invalid/,
  )
})

test('enterprise identity provider maps target credentials and the production HTTP contracts without exposing tokens', async () => {
  const values = new Map()
  let rejectModelCredential = false
  let holdModelCredential
  let modelCredentialStarted
  let holdSessionCredential
  let sessionCredentialStarted
  const credentials = {
    resolve: async ref => {
      if (holdSessionCredential !== undefined && ref === 'E_MATE_ENTERPRISE_SESSION') {
        sessionCredentialStarted()
        await holdSessionCredential
        holdSessionCredential = undefined
      }
      return values.has(ref) ? { value: values.get(ref), source: 'test' } : undefined
    },
    set: async (ref, value) => {
      if (rejectModelCredential && ref === MODEL_SESSION_REF) throw new Error('simulated model credential failure')
      if (holdModelCredential !== undefined && ref === MODEL_SESSION_REF) {
        modelCredentialStarted()
        await holdModelCredential
        holdModelCredential = undefined
      }
      values.set(ref, value)
    },
    unset: async ref => { values.delete(ref) },
  }
  let clock = Date.parse('2030-01-08T12:00:00.000Z')
  const accessToken = 'access.payload.signature'
  const modelToken = 'model.payload.signature'
  const refreshToken = `emate_rt_${'r'.repeat(43)}`
  const usageKeys = generateKeyPairSync('ed25519')
  const usagePublicKey = usageKeys.publicKey.export({ type: 'spki', format: 'pem' }).toString()
  const userAgreement = agreementDocuments.find(document => document.id === 'e-mate-user-agreement')
  const disclaimer = agreementDocuments.find(document => document.id === 'yixin-enterprise-disclaimer')
  const policy = {
    schemaVersion: 1,
    agreementId: 'e-mate-legal-bundle',
    agreementVersion: userAgreement.version,
    disclaimerVersion: disclaimer.version,
    contentHash: agreementBundleSha256,
  }
  let accepted = false
  const searchKey = 'managed-search-key-not-persisted-here'
  const runtimePayload = {
    schemaVersion: 1,
    models: [{
      id: 'gpt-5.6-luna',
      apiMode: 'responses',
      upstreamModelId: 'gpt-5.6-luna',
      upstreamBaseUrl: 'http://provider.example:8080/v1',
      allowInsecureHttpUpstream: true,
      upstreamApiKey: 'runtime-provider-key-not-persisted-here',
      label: 'GPT-5.6 Luna · 最大推理',
      input: ['text', 'image'],
      reasoning: true,
      contextWindow: 1_050_000,
      maxTokens: 128_000,
    }],
    searchCredentialGrant: {
      schemaVersion: 1,
      status: 'granted',
      purpose: 'web-search',
      provider: 'deepseek-official',
      credentialRef: 'E_MATE_SEARCH_KEY_DEEPSEEK',
      upstreamApiKey: searchKey,
    },
  }
  let runtimeResponse = runtimePayload
  const requests = []
  let auditBody
  let taskAuditBody
  let transportAvailable = true
  let refreshRejected = false
  const json = value => new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
  const session = {
    schemaVersion: 1,
    sessionId: 'session-enterprise-207',
    accessToken,
    refreshToken,
    expiresAt: new Date(clock + 15 * 60_000).toISOString(),
    identity: {
      tenantId: 'tenant-207',
      userId: 'user-207',
      displayName: '测试用户',
      roles: ['MEMBER'],
      weeklyTokenLimit: 50_000,
    },
    modelGateway: {
      baseUrl: 'https://mvdcm.ecoremedia.net/e-mate/model-api',
      sessionToken: modelToken,
      expiresAt: new Date(clock + 10 * 60_000).toISOString(),
      usageKeyId: 'usage-key-207',
      usagePublicKey,
      allowedModelIds: ['gpt-5.6-luna', 'gpt-image-2-pro'],
    },
  }
  const fetchImplementation = async (input, init = {}) => {
    if (!transportAvailable) throw new Error('simulated enterprise transport outage')
    const url = new URL(input)
    requests.push({ url: url.href, path: url.pathname, authorization: new Headers(init.headers).get('authorization') })
    if (url.pathname.endsWith('/v1/auth/registration/challenge')) {
      return json({
        schemaVersion: 1,
        challengeId: 'registration-challenge-207',
        imageDataUrl: `data:image/png;base64,${Buffer.from('captcha').toString('base64')}`,
        expiresAt: new Date(clock + 5 * 60_000).toISOString(),
      })
    }
    if (url.pathname.endsWith('/v1/auth/register')) {
      return new Response(JSON.stringify({
        schemaVersion: 1,
        registrationId: 'registration-receipt-207',
        status: 'PENDING_APPROVAL',
      }), { status: 201, headers: { 'content-type': 'application/json' } })
    }
    if (url.pathname.endsWith('/v1/auth/password')) return json(session)
    if (url.pathname.endsWith('/v1/auth/refresh')) {
      if (refreshRejected) {
        return new Response(JSON.stringify({ error: { code: 'TOKEN_REUSED' } }), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        })
      }
      return json({
        ...session,
        expiresAt: new Date(clock + 15 * 60_000).toISOString(),
        modelGateway: {
          ...session.modelGateway,
          expiresAt: new Date(clock + 10 * 60_000).toISOString(),
        },
      })
    }
    if (url.pathname.endsWith('/v1/auth/logout')) {
      return json({ schemaVersion: 1, receiptId: 'logout-receipt-207', reauthenticationRequired: false })
    }
    if (url.pathname.endsWith('/v1/consents/current')) {
      return json({
        schemaVersion: 1,
        policy,
        required: !accepted,
        acceptance: accepted ? {
          ...policy,
          acceptanceId: 'acceptance-receipt-207',
          userId: 'user-207',
          acceptedAt: new Date(clock).toISOString(),
          clientVersion: '2.0.12',
          locale: 'zh-CN',
        } : null,
      })
    }
    if (url.pathname.endsWith('/v1/consents/accept')) {
      accepted = true
      return json({
        ...policy,
        acceptanceId: 'acceptance-receipt-207',
        userId: 'user-207',
        acceptedAt: new Date(clock).toISOString(),
        clientVersion: '2.0.12',
        locale: 'zh-CN',
      })
    }
    if (url.pathname.endsWith('/v1/usage/current')) {
      return json({
        schemaVersion: 1,
        totalTokens: 12_345,
        weekStartedAt: '2030-01-07T00:00:00.000Z',
        calculatedAt: new Date(clock).toISOString(),
      })
    }
    if (url.pathname.endsWith('/v1/audit/usage')) {
      auditBody = JSON.parse(String(init.body))
      return json({
        schema_version: 1,
        receipts: auditBody.records.map(record => ({
          fact_id: record.fact_id,
          payload_sha256: record.payload_sha256,
          receipt_id: `receipt:${record.fact_id}`,
          accepted_at: new Date(clock).toISOString(),
        })),
      })
    }
    if (url.pathname.endsWith('/v1/audit/tasks')) {
      taskAuditBody = JSON.parse(String(init.body))
      return json({
        schema_version: 1,
        receipts: taskAuditBody.records.map(record => ({
          event_id: record.event_id,
          payload_sha256: record.payload_sha256,
          receipt_id: `receipt:${record.event_id}`,
          accepted_at: new Date(clock).toISOString(),
        })),
      })
    }
    if (url.pathname.endsWith('/v1/runtime-models')) {
      return json(runtimeResponse)
    }
    if (url.pathname.endsWith('/v1/authenticated-probe')
      || url.pathname.startsWith('/ecorex-agent/client/skill-hub/v1/')) {
      return json({ ok: true })
    }
    throw new Error(`unexpected test endpoint ${url.pathname}`)
  }
  const providerOptions = {
    credentials,
    enterprise: {
      authBaseUrl: 'https://mvdcm.ecoremedia.net/e-mate/auth-api',
      modelBaseUrl: 'https://mvdcm.ecoremedia.net/e-mate/model-api',
      clientId: 'e-mate-desktop',
      organization: 'emate',
    },
    fetchImplementation,
    now: () => clock,
  }
  let provider = createEnterpriseIdentityProvider(providerOptions)

  const challenge = await provider.issueRegistrationChallenge()
  assert.equal(challenge.challenge_id, 'registration-challenge-207')
  const registration = await provider.register({
    account: 'test.user',
    real_name: '测试用户',
    password: 'registration-secret',
    challenge_id: challenge.challenge_id,
    verification_code: '123456',
  })
  assert.equal(registration.status, 'pending_approval')
  const nonEd25519PublicKey = generateKeyPairSync('ec', { namedCurve: 'P-256' })
    .publicKey.export({ type: 'spki', format: 'pem' }).toString()
  const privateKey = usageKeys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
  for (const invalid of [privateKey, nonEd25519PublicKey, `${usagePublicKey}\u0000`, 'x'.repeat(8_193)]) {
    session.modelGateway.usagePublicKey = invalid
    await assert.rejects(
      provider.login({ identifier: 'test.user', password: 'secret-value', remember_login: true }),
      /usage public key is invalid/,
    )
    assert.equal(values.size, 0)
  }
  session.modelGateway.usagePublicKey = usagePublicKey.replaceAll('\n', '\r\n')
  values.set(MODEL_SESSION_REF, 'previous-model-token')
  rejectModelCredential = true
  await assert.rejects(
    provider.login({ identifier: 'test.user', password: 'secret-value', remember_login: true }),
    /simulated model credential failure/,
  )
  assert.equal(values.has('E_MATE_ENTERPRISE_SESSION'), false)
  assert.equal(values.has(MODEL_SESSION_REF), false)
  rejectModelCredential = false
  values.delete(MODEL_SESSION_REF)
  await provider.login({ identifier: 'test.user', password: 'secret-value', remember_login: true })
  assert.equal(values.get(MODEL_SESSION_REF), modelToken)
  assert.doesNotMatch(values.get('E_MATE_ENTERPRISE_SESSION'), /secret-value|registration-secret/)
  assert.equal(
    JSON.parse(values.get('E_MATE_ENTERPRISE_SESSION')).session.modelGateway.usagePublicKey,
    usagePublicKey,
  )
  const locked = await provider.bootstrap()
  assert.equal(locked.authenticated, true)
  assert.equal(locked.workspace_unlocked, false)
  assert.equal('accessToken' in locked, false)
  assert.equal('sessionToken' in locked, false)
  const consentRequestsAfterFirstBootstrap = requests.filter(request => request.path.endsWith('/v1/consents/current')).length
  await provider.bootstrap()
  assert.equal(
    requests.filter(request => request.path.endsWith('/v1/consents/current')).length,
    consentRequestsAfterFirstBootstrap + 1,
  )
  const modelPolicy = await provider.modelPolicy()
  assert.equal(modelPolicy.default_chat_model_id, 'gpt-5.6-luna')
  assert.deepEqual(modelPolicy.allowed_model_ids, [
    'gpt-5.6-luna', 'gpt-image-2-pro', 'gpt-image-2',
  ])
  const runtimePolicy = await provider.modelRuntimePolicy()
  assert.equal(runtimePolicy.models[0].provider, 'e-mate-enterprise')
  assert.equal(runtimePolicy.models[0].credentialRef, 'E_MATE_MODEL_KEY_GPT')
  assert.equal(runtimePolicy.models[0].upstreamBaseUrl, 'http://provider.example:8080/v1')
  assert.deepEqual(runtimePolicy.searchCredentialGrant, runtimePayload.searchCredentialGrant)
  assert.equal(runtimePolicy.policy.allowed_model_ids.includes('deepseek'), false)
  assert.equal(values.has('E_MATE_MODEL_KEY_GPT'), false)
  assert.equal(values.has('E_MATE_MODEL_KEY_DEEPSEEK'), false)
  assert.equal(values.has('E_MATE_SEARCH_KEY_DEEPSEEK'), false)
  assert.doesNotMatch(values.get('E_MATE_ENTERPRISE_SESSION'), /managed-search-key/u)
  for (const status of ['denied', 'unavailable']) {
    runtimeResponse = {
      ...runtimePayload,
      searchCredentialGrant: {
        schemaVersion: 1,
        status,
        purpose: 'web-search',
        provider: 'deepseek-official',
        credentialRef: 'E_MATE_SEARCH_KEY_DEEPSEEK',
      },
    }
    assert.equal((await provider.modelRuntimePolicy()).searchCredentialGrant.status, status)
  }
  for (const invalid of [
    { ...runtimePayload, unexpected: true },
    { ...runtimePayload, searchCredentialGrant: { ...runtimePayload.searchCredentialGrant, credentialRef: 'UNMANAGED_KEY' } },
    { ...runtimePayload, searchCredentialGrant: { ...runtimePayload.searchCredentialGrant, status: 'denied' } },
    { schemaVersion: 1, models: runtimePayload.models },
  ]) {
    runtimeResponse = invalid
    await assert.rejects(provider.modelRuntimePolicy(), error => {
      assert.match(error.message, /runtime models are invalid|search credential grant is invalid/u)
      if (/search credential grant is invalid/u.test(error.message)) {
        assert.equal(error.code, 'E_MATE_SEARCH_GRANT_INVALID')
      }
      return true
    })
  }
  runtimeResponse = runtimePayload
  const accountSubject = provider.localAccountSubject()
  clock += 9 * 60_000
  let releaseModelCredential
  holdModelCredential = new Promise(resolve => { releaseModelCredential = resolve })
  const modelCredentialWriteStarted = new Promise(resolve => { modelCredentialStarted = resolve })
  const refreshingPolicy = provider.modelRuntimePolicy()
  await modelCredentialWriteStarted
  assert.equal(provider.localAccountSubject(), accountSubject)
  releaseModelCredential()
  await refreshingPolicy
  const refreshRequestsBeforeIdle = requests.filter(request => request.path.endsWith('/v1/auth/refresh')).length
  clock += 16 * 60_000
  let releaseSessionCredential
  holdSessionCredential = new Promise(resolve => { releaseSessionCredential = resolve })
  const sessionCredentialReadStarted = new Promise(resolve => { sessionCredentialStarted = resolve })
  provider = createEnterpriseIdentityProvider(providerOptions)
  const idleLease = provider.keepAlive()
  await sessionCredentialReadStarted
  const idlePolicy = provider.modelPolicy()
  const idleBootstrap = provider.bootstrap()
  releaseSessionCredential()
  await idleLease
  assert.equal((await idlePolicy).default_chat_model_id, 'gpt-5.6-luna')
  assert.equal((await idleBootstrap).authenticated, true)
  assert.equal(
    requests.filter(request => request.path.endsWith('/v1/auth/refresh')).length,
    refreshRequestsBeforeIdle + 1,
  )
  assert.ok(Date.parse(JSON.parse(values.get('E_MATE_ENTERPRISE_SESSION')).session.expiresAt) > clock)
  const usage = await provider.usage('Asia/Shanghai')
  assert.equal(usage.week.total_tokens, 12_345)
  assert.equal(usage.timezone, 'Asia/Shanghai')
  const auditRecords = [{ fact_id: 'auditfact_test-207', payload_sha256: 'a'.repeat(64), payload: { total_tokens: 17 } }]
  const auditReceipt = await provider.auditUpload(auditRecords)
  assert.deepEqual(auditBody, { schema_version: 1, records: auditRecords })
  assert.equal(auditReceipt.receipts[0].fact_id, auditRecords[0].fact_id)
  const taskAuditRecords = [{
    event_id: `taskevent_${'b'.repeat(64)}`,
    account_subject_sha256: 'c'.repeat(64),
    payload_sha256: 'd'.repeat(64),
    payload: { schemaVersion: 1 },
  }]
  const taskAuditReceipt = await provider.taskAuditUpload(taskAuditRecords)
  assert.deepEqual(taskAuditBody, { schema_version: 1, records: taskAuditRecords })
  assert.equal(taskAuditReceipt.receipts[0].event_id, taskAuditRecords[0].event_id)
  const modelProbe = await provider.authenticatedRequest(
    'https://mvdcm.ecoremedia.net/e-mate/model-api/v1/authenticated-probe',
  )
  assert.equal(modelProbe.ok, true)
  await assert.rejects(
    provider.authenticatedRequest('https://mvdcm.ecoremedia.net/e-mate/model-api/v1/authenticated-probe?query=blocked'),
    /outside the managed enterprise root/,
  )
  const skillHubUrl = 'https://emate-skill-hub.emate-zyfjacksonchen.workers.dev/ecorex-agent/client/skill-hub/v1/skills?query=office&limit=24'
  const skillHubResponse = await provider.authenticatedRequest(skillHubUrl)
  assert.equal(skillHubResponse.ok, true)
  assert.deepEqual(requests.at(-1), {
    url: skillHubUrl,
    path: '/ecorex-agent/client/skill-hub/v1/skills',
    authorization: `Bearer ${modelToken}`,
  })
  for (const target of [
    'https://emate-skill-hub.emate-zyfjacksonchen.workers.dev/ecorex-agent/client/skill-hub/v10/skills?query=office&limit=24',
    'https://example.com/ecorex-agent/client/skill-hub/v1/skills?query=office&limit=24',
    'https://user:password@emate-skill-hub.emate-zyfjacksonchen.workers.dev/ecorex-agent/client/skill-hub/v1/skills?query=office&limit=24',
    'https://emate-skill-hub.emate-zyfjacksonchen.workers.dev/ecorex-agent/client/skill-hub/v1/skills?query=office&limit=24#fragment',
  ]) {
    await assert.rejects(provider.authenticatedRequest(target), /outside the managed enterprise root/)
  }
  await assert.rejects(
    provider.authenticatedRequest(skillHubUrl, { headers: { authorization: 'Bearer caller-token' } }),
    /cannot override authorization/,
  )
  await provider.acceptAgreements()
  const unlocked = await provider.bootstrap()
  assert.equal(unlocked.workspace_unlocked, true)
  assert.equal(unlocked.agreement_receipt_id, 'acceptance-receipt-207')
  const consentRequestsAfterAcceptance = requests.filter(request => request.path.endsWith('/v1/consents/current')).length
  await provider.bootstrap()
  assert.equal(
    requests.filter(request => request.path.endsWith('/v1/consents/current')).length,
    consentRequestsAfterAcceptance + 1,
  )
  const protectedRequests = requests.filter(request => request.path.includes('/v1/consents/'))
  assert.ok(protectedRequests.every(request => request.authorization === `Bearer ${modelToken}`))
  const runtimeRequests = requests.filter(request => request.path.endsWith('/v1/runtime-models'))
  assert.ok(runtimeRequests.length >= 2)
  assert.ok(runtimeRequests.every(request => request.authorization === `Bearer ${modelToken}`))
  assert.ok(runtimeRequests.every(request => new URL(request.url).search === '?client_version=2.0.12'))
  const auditRequests = requests.filter(request => request.path.endsWith('/v1/audit/usage'))
  assert.equal(auditRequests.length, 1)
  assert.equal(auditRequests[0].authorization, `Bearer ${modelToken}`)
  const taskAuditRequests = requests.filter(request => request.path.endsWith('/v1/audit/tasks'))
  assert.equal(taskAuditRequests.length, 1)
  assert.equal(taskAuditRequests[0].authorization, `Bearer ${modelToken}`)
  clock += 16 * 60_000
  transportAvailable = false
  provider = createEnterpriseIdentityProvider(providerOptions)
  const offlineWorkspace = await provider.bootstrap()
  assert.equal(offlineWorkspace.authenticated, true)
  assert.equal(offlineWorkspace.workspace_unlocked, true)
  await assert.rejects(provider.modelPolicy(), /企业身份服务暂时不可用/)
  assert.equal(values.has('E_MATE_ENTERPRISE_SESSION'), true)
  transportAvailable = true
  refreshRejected = true
  await assert.rejects(provider.bootstrap(), /登录刷新凭据已失效/)
  assert.equal(values.has('E_MATE_ENTERPRISE_SESSION'), false)
  refreshRejected = false
  await provider.login({ identifier: 'test.user', password: 'secret-value', remember_login: true })
  values.set('E_MATE_MODEL_KEY_GPT', 'runtime-provider-key-not-persisted-here')
  const logout = await provider.logout({ client_request_id: 'logout-request-207' })
  assert.equal(logout.receipt_id, 'logout-receipt-207')
  assert.equal(values.size, 0)

  accepted = false
  session.identity.roles = ['AUDIT_ADMIN']
  await provider.login({ identifier: 'audit.admin', password: 'secret-value', remember_login: false })
  const consentRequestsBeforeAdminBootstrap = requests.filter(request => request.path.includes('/v1/consents/')).length
  const administrator = await provider.bootstrap()
  assert.equal(administrator.workspace_unlocked, true)
  assert.equal(administrator.agreement_exempt, true)
  assert.equal(administrator.agreement_receipt_id, undefined)
  assert.equal(
    requests.filter(request => request.path.includes('/v1/consents/')).length,
    consentRequestsBeforeAdminBootstrap,
  )
  await provider.logout({ client_request_id: 'admin-logout-request-207' })
})

test('enterprise identity rejects expected gateway responses through the target RPC result', async () => {
  let identityHandler
  let keepAliveTick
  let keepAliveInterval
  let response = { status: 400, body: { error: { code: 'INVALID_CHALLENGE' } } }
  let transportFailure = false
  let requestSignal
  const warnings = []
  const credentials = {
    resolve: async () => undefined,
    set: async () => {},
    unset: async () => {},
  }
  applyIdentity({
    get: name => name === 'credentials' ? credentials : undefined,
    connection: { rpc: { handle: (_channel, handler) => {
      identityHandler = handler
      return async () => {}
    } } },
    provide: () => {},
    effect: effect => effect(),
    logger: { warn: warning => { warnings.push(warning) } },
    interval: (callback, delay) => {
      keepAliveTick = callback
      keepAliveInterval = delay
      return () => {}
    },
  }, {
    providerLegalName: '亦芯测试主体',
    enterprise: {
      authBaseUrl: 'https://mvdcm.ecoremedia.net/e-mate/auth-api',
      modelBaseUrl: 'https://mvdcm.ecoremedia.net/e-mate/model-api',
      clientId: 'e-mate-web',
      organization: 'emate-v2',
    },
    fetchImplementation: async (_input, init) => {
      requestSignal = init.signal
      if (transportFailure) throw new Error('simulated transport failure')
      return new Response(JSON.stringify(response.body), {
        status: response.status,
        headers: { 'content-type': 'application/json' },
      })
    },
  })
  assert.equal(keepAliveInterval, ENTERPRISE_KEEP_ALIVE_MS)
  keepAliveTick()
  const payload = {
    account: 'test.user',
    real_name: '测试用户',
    password: 'registration-secret',
    challenge_id: 'registration-challenge-207',
    verification_code: '123456',
  }

  assert.deepEqual(await identityHandler('session.register', payload), {
    ok: false,
    error: { code: 'bad-request', message: '验证码无效或已过期', details: { issues: [] } },
  })
  response = { status: 409, body: { error: { code: 'ACCOUNT_EXISTS' } } }
  assert.deepEqual(await identityHandler('session.register', payload), {
    ok: false,
    error: { code: 'bad-request', message: '该账号已存在', details: { issues: [] } },
  })

  response = { status: 500, body: { error: { code: 'ACCOUNT_EXISTS', message: 'sensitive upstream detail' } } }
  assert.deepEqual(await identityHandler('session.register', payload), {
    ok: false,
    error: { code: 'unavailable', message: '企业身份服务暂时不可用，请稍后重试。', details: { issues: [] } },
  })

  const login = { identifier: 'test.user', password: 'old-password', remember_login: true }
  response = { status: 401, body: { error: { code: 'INVALID_GRANT' } } }
  assert.deepEqual(await identityHandler('session.login', login), {
    ok: false,
    error: { code: 'bad-request', message: '账号或密码错误', details: { issues: [] } },
  })
  response = { status: 500, body: { error: { code: 'INVALID_GRANT' } } }
  assert.deepEqual(await identityHandler('session.login', login), {
    ok: false,
    error: { code: 'unavailable', message: '企业身份服务暂时不可用，请稍后重试。', details: { issues: [] } },
  })
  assert.match(warnings.at(-1), /session\.login unavailable \(upstream-http 500\)/u)
  transportFailure = true
  assert.deepEqual(await identityHandler('session.login', login), {
    ok: false,
    error: { code: 'unavailable', message: '企业身份服务暂时不可用，请稍后重试。', details: { issues: [] } },
  })
  assert.equal(requestSignal instanceof AbortSignal, true)
  assert.match(warnings.at(-1), /session\.login unavailable \(transport\)/u)
  transportFailure = false
  response = { status: 400, body: { error: { code: 'UNKNOWN_CONTRACT_FAILURE' } } }
  await assert.rejects(identityHandler('session.login', login), /UNKNOWN_CONTRACT_FAILURE/u)
})

test('enterprise model switch keeps native history and survives a cached-policy outage and cold restart', async () => {
  const temporary = mkdtempSync(join(tmpdir(), 'e-mate-model-policy-'))
  const cleanups = []
  const records = new Map()
  const projectionRecords = new Map()
  let rejectProjectionMarkerWrite = false
  const table = {
    entries: () => records.entries(),
    get: key => records.get(key),
    put: async (key, value) => { records.set(key, structuredClone(value)) },
    delete: async key => records.delete(key),
  }
  const projectionTable = {
    entries: () => projectionRecords.entries(),
    get: key => projectionRecords.get(key),
    put: async (key, value) => {
      if (rejectProjectionMarkerWrite) throw new Error('simulated runtime projection marker failure')
      projectionRecords.set(key, structuredClone(value))
    },
    delete: async key => projectionRecords.delete(key),
  }
  let rejectQuotaSnapshotWrite = false
  const quotaRecords = { snapshots: new Map(), reservations: new Map(), usage: new Map() }
  const domain = {
    table: name => name === 'active' ? table : name === 'runtime_projection' ? projectionTable : undefined,
    close: async () => {},
  }
  const quotaDomain = {
    table: name => ({
      entries: () => quotaRecords[name].entries(),
      put: async (key, value) => {
        if (name === 'snapshots' && rejectQuotaSnapshotWrite) {
          throw new Error('simulated quota snapshot failure')
        }
        quotaRecords[name].set(key, structuredClone(value))
      },
      delete: async key => quotaRecords[name].delete(key),
    }),
    close: async () => {},
  }
  let openedDomains = 0
  const calls = { selected: [], policy: 0 }
  const credentialValues = new Map()
  let llmSettings = {
    providers: {
      'e-mate-enterprise': {
        apiKeyEnv: 'E_MATE_MODEL_KEY_GPT',
        api: 'openai-responses',
        baseURL: 'http://provider.example:8080/v1',
        models: [{ id: 'gpt-5.6-luna' }],
      },
    },
  }
  let defaultModelSettings
  let failDefaultModelWrite = false
  let delayedCredentialWrite
  let rejectedCredentialWrite
  let credentialWriteRejected = false
  let projectedGptKey = 'production-key-redacted-for-test-123'
  let projectedGptBaseUrl = 'http://provider.example:8080/v1'
  let policyDefaultModel = 'gpt-5.6-luna'
  let deepseekChatAllowed = true
  let searchGrantStatus = 'granted'
  let searchGrantFailure
  let rejectSearchUnset = false
  let projectedSearchKey = 'deepseek-key-redacted-for-test-123'
  let projectedDeepseekChatKey = 'deepseek-chat-key-redacted-for-test-123'
  credentialValues.set('E_MATE_MODEL_KEY_GPT', 'legacy-gpt-key-redacted-for-test-000')
  const session = {
    current: { provider: 'e-mate-enterprise', model: 'gpt-5.6-luna', reasoningEffort: 'max' },
    messages: [
      { id: 'user-1', role: 'user', content: 'first turn' },
      { id: 'assistant-1', role: 'assistant', content: 'first answer' },
    ],
  }
  let accountSubject = 'account:test-207'
  let providerAvailable = true
  let rpc
  let requestPolicy
  let streamPolicy
  const modelPolicyHandlers = new Map()
  let modelPolicy
  const now = Date.now()
  const policy = () => ({
    schema_version: 1,
    account_subject: accountSubject,
    revision: 7,
    allowed_model_ids: [
      'gpt-5.6-luna', 'gpt-5.6-sol',
      ...(deepseekChatAllowed ? ['deepseek'] : []),
      'gpt-image-2-pro', 'gpt-image-2',
    ],
    default_chat_model_id: policyDefaultModel,
    default_chat_reasoning_effort: policyDefaultModel === 'gpt-5.6-luna' ? 'max' : 'medium',
    image_primary_model_id: 'gpt-image-2-pro',
    image_fallback_upstream_model_id: 'gpt-image-2',
    issued_at: new Date(now - 1_000).toISOString(),
    expires_at: new Date(now + 60 * 60_000).toISOString(),
    receipt_id: 'policy-receipt:test-207',
  })
  records.set('active', validateModelPolicy(policy(), accountSubject, now))
  const catalog = {
    groups: [{
      id: 'enterprise',
      name: 'e-Mate Enterprise',
      models: [
        { id: 'gpt-5.6-luna', name: 'e-Mate Chat' },
        { id: 'gpt-5.6-sol', name: 'e-Mate Sol' },
        { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Pro' },
      ],
    }],
    failures: [],
  }
  const apiProxy = {
    sessions: {
      models: async request => ({
        rpcId: request.rpcId,
        result: { ok: true, value: { current: structuredClone(session.current), routable: true, ...catalog } },
      }),
      selectModel: async request => {
        calls.selected.push(structuredClone(request.payload))
        session.current = {
          provider: request.payload.provider,
          model: request.payload.model,
          ...request.payload.reasoningEffort === undefined ? {} : { reasoningEffort: request.payload.reasoningEffort },
        }
        return { rpcId: request.rpcId, result: { ok: true, value: { selected: structuredClone(session.current) } } }
      },
    },
    llm: {
      models: async request => ({ rpcId: request.rpcId, result: { ok: true, value: catalog } }),
    },
  }
  try {
    const paths = installProfile(join(temporary, 'dsh-home'))
    const modelPolicyContext = {
      apiProxy,
      connection: { rpc: { handle: (channel, handler, options) => {
        rpc = { channel, handler, options }
        return () => {}
      } } },
      llm: {},
      credentials: {
        resolve: async ref => credentialValues.has(ref) ? { value: credentialValues.get(ref), source: 'test' } : undefined,
        set: async (ref, value) => {
          if (delayedCredentialWrite?.ref === ref && delayedCredentialWrite.value === value) {
            delayedCredentialWrite.started()
            await delayedCredentialWrite.release
            delayedCredentialWrite = undefined
          }
          if (rejectedCredentialWrite?.ref === ref && rejectedCredentialWrite.value === value) {
            rejectedCredentialWrite = undefined
            credentialWriteRejected = true
            throw new Error('simulated ordered credential write failure')
          }
          credentialValues.set(ref, value)
        },
        unset: async ref => {
          if (rejectSearchUnset && ref === 'E_MATE_SEARCH_KEY_DEEPSEEK') {
            throw new Error('simulated search credential revocation failure')
          }
          credentialValues.delete(ref)
        },
      },
      settings: {
        get: ns => ns === 'llm-pi-ai'
          ? structuredClone(llmSettings)
          : ns === 'agent-default-model' ? structuredClone(defaultModelSettings) : undefined,
        replace: async (ns, value) => {
          if (ns === 'llm-pi-ai') llmSettings = structuredClone(value)
          else if (ns === 'agent-default-model') {
            if (failDefaultModelWrite) {
              failDefaultModelWrite = false
              throw new Error('simulated default model settings failure')
            }
            defaultModelSettings = structuredClone(value)
          }
          else assert.fail(`unexpected settings namespace ${ns}`)
        },
      },
      storageDomain: { open: async () => openedDomains++ === 0 ? domain : quotaDomain },
      emateIdentity: {
        localAccountSubject: () => accountSubject,
        state: async () => ({
          authenticated: true,
          workspace_unlocked: true,
          account_subject: accountSubject,
          weekly_token_limit: 100_000,
        }),
        usage: async timezone => {
          const date = new Date(now)
          date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7))
          date.setUTCHours(0, 0, 0, 0)
          return {
            schema_version: 1,
            scope: 'account',
            timezone,
            week: { total_tokens: 48_855 },
            week_started_at: date.toISOString(),
            calculated_at: new Date(now).toISOString(),
          }
        },
        modelRuntimePolicy: async () => {
          calls.policy += 1
          if (!providerAvailable) throw new Error('enterprise unavailable')
          if (searchGrantFailure !== undefined) throw searchGrantFailure
          return {
            policy: policy(),
            models: [
              {
                id: 'gpt-5.6-luna',
                provider: 'e-mate-enterprise',
                credentialRef: 'E_MATE_MODEL_KEY_GPT',
                api: 'openai-responses',
                upstreamModelId: 'gpt-5.6-luna',
                upstreamBaseUrl: projectedGptBaseUrl,
                upstreamApiKey: projectedGptKey,
                label: 'GPT-5.6 Luna · 最大推理',
                input: ['text', 'image'],
                contextWindow: 1_050_000,
                maxTokens: 128_000,
              },
              {
                id: 'gpt-5.6-sol',
                provider: 'e-mate-enterprise',
                credentialRef: 'E_MATE_MODEL_KEY_GPT',
                api: 'openai-responses',
                upstreamModelId: 'gpt-5.6-sol',
                upstreamBaseUrl: projectedGptBaseUrl,
                upstreamApiKey: projectedGptKey,
                label: 'GPT-5.6 Sol · 中等推理',
                input: ['text', 'image'],
                contextWindow: 1_050_000,
                maxTokens: 128_000,
              },
              ...(deepseekChatAllowed ? [{
                id: 'deepseek',
                provider: 'e-mate-enterprise-deepseek',
                credentialRef: 'E_MATE_MODEL_KEY_DEEPSEEK',
                api: 'openai-completions',
                upstreamModelId: 'deepseek-v4-flash',
                upstreamBaseUrl: 'https://api.deepseek.com/v1',
                upstreamApiKey: projectedDeepseekChatKey,
                label: 'DeepSeek V4 Pro · 最大推理',
                input: ['text'],
                contextWindow: 131_072,
                maxTokens: 65_536,
              }] : []),
            ],
            searchCredentialGrant: {
              schemaVersion: 1,
              status: searchGrantStatus,
              purpose: 'web-search',
              provider: 'deepseek-official',
              credentialRef: 'E_MATE_SEARCH_KEY_DEEPSEEK',
              ...(searchGrantStatus === 'granted' ? { upstreamApiKey: projectedSearchKey } : {}),
            },
          }
        },
      },
      provide: (name, value) => {
        assert.equal(name, 'emateModelPolicy')
        modelPolicy = value
      },
      effect(effect) {
        const cleanup = effect()
        if (typeof cleanup === 'function') cleanups.push(cleanup)
        return cleanup
      },
      on: (event, handler) => {
        if (event === 'agent/request') requestPolicy = handler
        else if (event === 'llm/stream') streamPolicy = handler
        else if (event === 'session/event' || event === 'session/flush') modelPolicyHandlers.set(event, handler)
        else assert.fail(`unexpected model policy event ${event}`)
        return () => {}
      },
    }
    const modelPolicyConfig = { bindingPath: join(paths.profile, 'plugins', 'runtime-binding.json') }
    await applyModelPolicy(modelPolicyContext, modelPolicyConfig)

    assert.equal(rpc.channel, MODEL_POLICY_CHANNEL)
    assert.deepEqual(rpc.options, { authority: 'loopback' })
    assert.equal(credentialValues.has('E_MATE_SEARCH_KEY_DEEPSEEK'), false)
    assert.deepEqual(
      await requestPolicy({}, async () => ({ provider: 'e-mate-enterprise', model: 'gpt-5.6-luna' })),
      { provider: 'e-mate-enterprise', model: 'gpt-5.6-luna' },
    )
    assert.equal(calls.policy, 1)
    const current = await rpc.handler('policy.current', {})
    assert.equal(current.ok, true)
    assert.equal(current.value.revision, 7)
    assert.equal('account_subject' in current.value, false)
    assert.match(records.get('active').policy_sha256, /^[0-9a-f]{64}$/)
    assert.equal(projectionRecords.get('active').search_status, 'granted')
    assert.doesNotMatch(JSON.stringify(projectionRecords.get('active')), /redacted-for-test/u)
    assert.equal(credentialValues.get('E_MATE_MODEL_KEY_GPT'), 'production-key-redacted-for-test-123')
    assert.equal(credentialValues.get('E_MATE_MODEL_KEY_DEEPSEEK'), projectedDeepseekChatKey)
    assert.equal(credentialValues.get('E_MATE_SEARCH_KEY_DEEPSEEK'), projectedSearchKey)
    assert.equal(llmSettings.providers['e-mate-enterprise'].baseURL, 'http://provider.example:8080/v1')
    assert.equal(llmSettings.providers['e-mate-enterprise'].apiKeyEnv, 'E_MATE_MODEL_KEY_GPT')
    assert.deepEqual(
      llmSettings.providers['e-mate-enterprise'].models.map(model => model.id),
      ['gpt-5.6-luna', 'gpt-5.6-sol'],
    )
    assert.deepEqual(
      llmSettings.providers['e-mate-enterprise-deepseek'].models.map(model => model.id),
      ['deepseek-v4-flash'],
    )
    assert.deepEqual(
      llmSettings.providers['e-mate-enterprise'].models.map(model => model.name),
      ['gpt-5.6-luna', 'gpt-5.6-sol'],
    )
    assert.deepEqual(defaultModelSettings, {
      provider: 'e-mate-enterprise',
      model: 'gpt-5.6-luna',
      reasoningEffort: 'max',
    })
    assert.doesNotMatch(JSON.stringify(llmSettings), /redacted-for-test/u)
    assert.doesNotMatch(JSON.stringify(llmSettings), /model-api/u)
    assert.equal((await rpc.handler('unknown', {})).error.code, 'bad-request')

    searchGrantStatus = 'denied'
    rejectQuotaSnapshotWrite = true
    assert.equal((await modelPolicy.refresh({ force: true })).revision, 7)
    assert.equal(credentialValues.has('E_MATE_SEARCH_KEY_DEEPSEEK'), false)
    assert.equal(projectionRecords.has('active'), false)
    await assert.rejects(
      requestPolicy({}, async () => ({ provider: 'e-mate-enterprise', model: 'gpt-5.6-luna' })),
      /native runtime model projection is not ready/u,
    )
    rejectQuotaSnapshotWrite = false
    await modelPolicy.refresh({ force: true })
    assert.equal(projectionRecords.get('active').search_status, 'denied')
    searchGrantStatus = 'granted'
    await modelPolicy.refresh({ force: true })
    assert.equal(credentialValues.get('E_MATE_SEARCH_KEY_DEEPSEEK'), projectedSearchKey)

    const projectedSettings = structuredClone(llmSettings)
    const projectedDefault = structuredClone(defaultModelSettings)
    const projectedCredentials = new Map(credentialValues)
    const invalidatedSearchCredentials = new Map(projectedCredentials)
    invalidatedSearchCredentials.delete('E_MATE_SEARCH_KEY_DEEPSEEK')
    projectedSearchKey = 'slow-search-key-redacted-for-test-456'
    projectedGptKey = 'fast-fail-gpt-key-redacted-for-test-456'
    let releaseDelayedCredential
    let markCredentialStarted
    const credentialStarted = new Promise(resolve => { markCredentialStarted = resolve })
    delayedCredentialWrite = {
      ref: 'E_MATE_SEARCH_KEY_DEEPSEEK',
      value: projectedSearchKey,
      started: markCredentialStarted,
      release: new Promise(resolve => { releaseDelayedCredential = resolve }),
    }
    rejectedCredentialWrite = { ref: 'E_MATE_MODEL_KEY_GPT', value: projectedGptKey }
    const orderedFailure = modelPolicy.refresh({ force: true })
    await credentialStarted
    assert.equal(credentialWriteRejected, false)
    releaseDelayedCredential()
    assert.equal((await orderedFailure).revision, 7)
    assert.equal(credentialWriteRejected, true)
    assert.deepEqual(llmSettings, projectedSettings)
    assert.deepEqual(defaultModelSettings, projectedDefault)
    assert.deepEqual(credentialValues, invalidatedSearchCredentials)
    projectedSearchKey = 'deepseek-key-redacted-for-test-123'
    projectedGptKey = 'production-key-redacted-for-test-123'

    projectedGptKey = 'rotated-key-redacted-for-test-456'
    projectedGptBaseUrl = 'http://provider.example:8081/v1'
    policyDefaultModel = 'gpt-5.6-sol'
    failDefaultModelWrite = true
    assert.equal((await modelPolicy.refresh({ force: true })).revision, 7)
    assert.deepEqual(llmSettings, projectedSettings)
    assert.deepEqual(defaultModelSettings, projectedDefault)
    assert.deepEqual(credentialValues, invalidatedSearchCredentials)
    projectedGptKey = 'production-key-redacted-for-test-123'
    projectedGptBaseUrl = 'http://provider.example:8080/v1'
    policyDefaultModel = 'gpt-5.6-luna'
    await modelPolicy.refresh({ force: true })
    assert.deepEqual(credentialValues, projectedCredentials)

    const models = await apiProxy.sessions.models({ rpcId: 'models-1', payload: { sessionId: 'session-1' } })
    assert.deepEqual(models.result.value.groups[0].models.map(model => model.id), [
      'gpt-5.6-luna', 'gpt-5.6-sol', 'deepseek-v4-flash',
    ])
    assert.equal(models.result.value.routable, true)
    const settingsModels = await apiProxy.llm.models({ rpcId: 'models-2', payload: {} })
    assert.deepEqual(settingsModels.result.value.groups[0].models.map(model => model.id), [
      'gpt-5.6-luna', 'gpt-5.6-sol', 'deepseek-v4-flash',
    ])
    const allowed = await apiProxy.sessions.selectModel({
      rpcId: 'select-1', payload: { sessionId: 'session-1', provider: 'e-mate-enterprise', model: 'gpt-5.6-luna' },
    })
    assert.equal(allowed.result.ok, true)
    assert.equal(allowed.result.value.selected.reasoningEffort, 'max')
    const historyBeforeSwitch = structuredClone(session.messages)
    const switched = await apiProxy.sessions.selectModel({
      rpcId: 'select-2', payload: { sessionId: 'session-1', provider: 'e-mate-enterprise', model: 'gpt-5.6-sol' },
    })
    assert.deepEqual(switched.result.value.selected, session.current)
    assert.equal(switched.result.value.selected.reasoningEffort, 'medium')
    assert.deepEqual(session.messages, historyBeforeSwitch)
    assert.equal((await apiProxy.sessions.models({ rpcId: 'models-3', payload: { sessionId: 'session-1' } })).result.value.current.model, 'gpt-5.6-sol')
    const blocked = await apiProxy.sessions.selectModel({
      rpcId: 'select-3', payload: { sessionId: 'session-1', provider: 'e-mate-enterprise', model: 'unknown' },
    })
    assert.equal(blocked.result.error.code, 'model-unavailable')
    assert.deepEqual(calls.selected.map(call => call.model), ['gpt-5.6-luna', 'gpt-5.6-sol'])
    assert.ok(calls.selected.every(call => call.sessionId === 'session-1'))
    assert.deepEqual(
      await requestPolicy({ agent: { id: 'session-1' }, turn: 1, step: 1 }, async () => structuredClone(session.current)),
      session.current,
    )
    await assert.rejects(
      requestPolicy({}, async () => ({ provider: 'e-mate-enterprise', model: 'unknown-native-model' })),
      /not allowed/,
    )
    assert.deepEqual(
      await requestPolicy({}, async () => ({ provider: 'e-mate-enterprise-deepseek', model: 'deepseek-v4-flash' })),
      { provider: 'e-mate-enterprise-deepseek', model: 'deepseek-v4-flash' },
    )
    deepseekChatAllowed = false
    await modelPolicy.refresh({ force: true })
    assert.equal(credentialValues.has('E_MATE_MODEL_KEY_DEEPSEEK'), false)
    assert.equal(credentialValues.get('E_MATE_SEARCH_KEY_DEEPSEEK'), projectedSearchKey)
    assert.equal(llmSettings.providers['e-mate-enterprise-deepseek'], undefined)
    assert.deepEqual(
      llmSettings.providers['e-mate-enterprise'].models.map(model => model.id),
      ['gpt-5.6-luna', 'gpt-5.6-sol'],
    )
    assert.doesNotMatch(JSON.stringify(llmSettings), /redacted-for-test/u)
    assert.deepEqual(
      (await apiProxy.sessions.models({ rpcId: 'models-gpt-only', payload: { sessionId: 'session-1' } }))
        .result.value.groups[0].models.map(model => model.id),
      ['gpt-5.6-luna', 'gpt-5.6-sol'],
    )
    await assert.rejects(
      requestPolicy({}, async () => ({ provider: 'e-mate-enterprise-deepseek', model: 'deepseek-v4-flash' })),
      /not allowed/u,
    )
    searchGrantStatus = 'denied'
    rejectSearchUnset = true
    await assert.rejects(
      modelPolicy.refresh({ force: true }),
      /invalid search grant revocation failed/u,
    )
    assert.equal(projectionRecords.has('active'), false)
    assert.equal(credentialValues.get('E_MATE_SEARCH_KEY_DEEPSEEK'), projectedSearchKey)
    await assert.rejects(
      requestPolicy({}, async () => ({ provider: 'e-mate-enterprise', model: 'gpt-5.6-luna' })),
      /invalid search grant revocation failed/u,
    )
    rejectSearchUnset = false
    await modelPolicy.refresh({ force: true })
    assert.equal(credentialValues.has('E_MATE_SEARCH_KEY_DEEPSEEK'), false)
    assert.deepEqual(
      await requestPolicy({}, async () => ({ provider: 'e-mate-enterprise', model: 'gpt-5.6-luna' })),
      { provider: 'e-mate-enterprise', model: 'gpt-5.6-luna' },
    )
    credentialValues.set('E_MATE_SEARCH_KEY_DEEPSEEK', 'stale-search-key-redacted-for-test-000')
    searchGrantStatus = 'unavailable'
    await modelPolicy.refresh({ force: true })
    assert.equal(credentialValues.has('E_MATE_SEARCH_KEY_DEEPSEEK'), false)
    projectedSearchKey = 'rotated-search-key-redacted-for-test-789'
    searchGrantStatus = 'granted'
    await modelPolicy.refresh({ force: true })
    assert.equal(credentialValues.get('E_MATE_SEARCH_KEY_DEEPSEEK'), projectedSearchKey)
    searchGrantFailure = Object.assign(
      new Error('e-Mate enterprise search credential grant is invalid'),
      { code: 'E_MATE_SEARCH_GRANT_INVALID' },
    )
    rejectProjectionMarkerWrite = true
    await assert.rejects(
      modelPolicy.refresh({ force: true }),
      /runtime projection marker failure/u,
    )
    assert.equal(projectionRecords.has('active'), false)
    assert.equal(credentialValues.has('E_MATE_SEARCH_KEY_DEEPSEEK'), false)
    await assert.rejects(
      requestPolicy({}, async () => ({ provider: 'e-mate-enterprise', model: 'gpt-5.6-luna' })),
      /runtime projection marker failure/u,
    )
    rejectProjectionMarkerWrite = false
    assert.equal((await modelPolicy.refresh({ force: true })).revision, 7)
    assert.equal(credentialValues.has('E_MATE_SEARCH_KEY_DEEPSEEK'), false)
    assert.equal(projectionRecords.get('active').search_status, 'unavailable')
    assert.deepEqual(
      await requestPolicy({}, async () => ({ provider: 'e-mate-enterprise', model: 'gpt-5.6-luna' })),
      { provider: 'e-mate-enterprise', model: 'gpt-5.6-luna' },
    )
    searchGrantFailure = undefined
    await modelPolicy.refresh({ force: true })
    assert.equal(credentialValues.get('E_MATE_SEARCH_KEY_DEEPSEEK'), projectedSearchKey)
    searchGrantFailure = Object.assign(
      new Error('e-Mate enterprise search credential grant is invalid'),
      { code: 'E_MATE_SEARCH_GRANT_INVALID' },
    )
    rejectSearchUnset = true
    await assert.rejects(
      modelPolicy.refresh({ force: true }),
      /invalid search grant revocation failed/u,
    )
    assert.equal(projectionRecords.has('active'), false)
    assert.equal(credentialValues.get('E_MATE_SEARCH_KEY_DEEPSEEK'), projectedSearchKey)
    rejectSearchUnset = false
    assert.equal((await modelPolicy.refresh({ force: true })).revision, 7)
    assert.equal(credentialValues.has('E_MATE_SEARCH_KEY_DEEPSEEK'), false)
    searchGrantFailure = undefined
    await modelPolicy.refresh({ force: true })
    assert.equal(credentialValues.get('E_MATE_SEARCH_KEY_DEEPSEEK'), projectedSearchKey)
    rejectProjectionMarkerWrite = true
    projectedSearchKey = 'marker-failure-search-key-redacted-for-test-321'
    assert.equal((await modelPolicy.refresh({ force: true })).revision, 7)
    assert.equal(projectionRecords.has('active'), false)
    await assert.rejects(
      requestPolicy({}, async () => ({ provider: 'e-mate-enterprise', model: 'gpt-5.6-luna' })),
      /native runtime model projection is not ready/u,
    )
    rejectProjectionMarkerWrite = false
    await modelPolicy.refresh({ force: true })
    assert.equal(credentialValues.get('E_MATE_SEARCH_KEY_DEEPSEEK'), projectedSearchKey)
    const policyCallsBeforeHotPath = calls.policy
    await requestPolicy(
      { agent: { id: 'session-1' }, turn: 1, step: 1 },
      async () => ({ provider: 'e-mate-enterprise', model: 'gpt-5.6-luna' }),
    )
    const streamed = []
    for await (const chunk of streamPolicy(
      { provider: 'e-mate-enterprise', model: 'gpt-5.6-luna', sessionId: 'session-1' },
      () => (async function* () {
        yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 2 } }
        yield { type: 'finish', reason: { kind: 'stop' } }
      })(),
    )) streamed.push(chunk)
    assert.deepEqual(streamed.map(chunk => chunk.type), ['usage', 'finish'])
    assert.equal(calls.policy, policyCallsBeforeHotPath)
    modelPolicyHandlers.get('session/event')({ id: 'session-1' }, {
      type: 'assistant/message',
      seq: 9,
      time: now,
      data: {
        turn: 1,
        step: 1,
        message: {
          source: { kind: 'model', provider: 'e-mate-enterprise', model: 'gpt-5.6-luna' },
        },
        usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 2 },
      },
    })
    await modelPolicyHandlers.get('session/flush')()
    assert.equal(quotaRecords.usage.size, 1)
    assert.equal(quotaRecords.reservations.size, 0)

    await requestPolicy(
      { agent: { id: 'session-throw' }, turn: 1, step: 1 },
      async () => ({ provider: 'e-mate-enterprise', model: 'gpt-5.6-luna' }),
    )
    const streamFailure = new Error('real downstream stream failure')
    await assert.rejects(async () => {
      for await (const _chunk of streamPolicy(
        { provider: 'e-mate-enterprise', model: 'gpt-5.6-luna', sessionId: 'session-throw' },
        () => (async function* () { throw streamFailure })(),
      )) {}
    }, error => error === streamFailure)
    assert.equal(quotaRecords.reservations.size, 0)

    await requestPolicy(
      { agent: { id: 'session-no-finish' }, turn: 1, step: 1 },
      async () => ({ provider: 'e-mate-enterprise', model: 'gpt-5.6-luna' }),
    )
    for await (const _chunk of streamPolicy(
      { provider: 'e-mate-enterprise', model: 'gpt-5.6-luna', sessionId: 'session-no-finish' },
      () => (async function* () { yield { type: 'text-delta', index: 0, text: 'partial' } })(),
    )) {}
    assert.equal(quotaRecords.reservations.size, 1)

    await assert.rejects(async () => {
      for await (const _chunk of streamPolicy(
        { provider: 'e-mate-enterprise', model: 'unknown-native-model' },
        () => (async function* () { yield 'blocked' })(),
      )) {}
    }, /not allowed/)

    providerAvailable = false
    assert.equal((await modelPolicy.refresh({ force: true })).revision, 7)
    const cachedSwitch = await apiProxy.sessions.selectModel({
      rpcId: 'select-4', payload: { sessionId: 'session-1', provider: 'e-mate-enterprise', model: 'gpt-5.6-luna', reasoningEffort: 'max' },
    })
    assert.equal(cachedSwitch.result.ok, true)
    assert.deepEqual(session.messages, historyBeforeSwitch)
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
    openedDomains = 0
    await applyModelPolicy(modelPolicyContext, modelPolicyConfig)
    assert.deepEqual(
      await requestPolicy({}, async () => ({ provider: 'e-mate-enterprise', model: 'gpt-5.6-luna' })),
      { provider: 'e-mate-enterprise', model: 'gpt-5.6-luna' },
    )
    providerAvailable = true
    accountSubject = 'account:other-207'
    assert.deepEqual(
      await requestPolicy({}, async () => ({ provider: 'e-mate-enterprise', model: 'gpt-5.6-luna' })),
      { provider: 'e-mate-enterprise', model: 'gpt-5.6-luna' },
    )
    assert.equal(records.get('active').account_subject, accountSubject)
    accountSubject = 'account:invalid-search-grant-207'
    credentialValues.set('E_MATE_SEARCH_KEY_DEEPSEEK', 'stale-no-cache-search-key-redacted-for-test-000')
    searchGrantFailure = Object.assign(
      new Error('e-Mate enterprise search credential grant is invalid'),
      { code: 'E_MATE_SEARCH_GRANT_INVALID' },
    )
    await assert.rejects(
      modelPolicy.refresh({ force: true }),
      /search credential grant is invalid/u,
    )
    assert.equal(credentialValues.has('E_MATE_SEARCH_KEY_DEEPSEEK'), false)
    assert.equal(projectionRecords.has('active'), false)
    searchGrantFailure = undefined
    providerAvailable = false
    accountSubject = 'account:unavailable-207'
    await assert.rejects(
      requestPolicy({}, async () => ({ provider: 'e-mate-enterprise', model: 'gpt-5.6-luna' })),
      /enterprise unavailable/,
    )
    await assert.rejects(modelPolicy.refresh({ force: true }), /enterprise unavailable/)
    assert.throws(
      () => validateModelPolicy({ ...policy(), allowed_model_ids: ['gpt-5.6-luna', 'unknown'] }, accountSubject, now),
      /policy is invalid/,
    )
  } finally {
    for (const cleanup of cleanups.reverse()) await cleanup()
    rmSync(temporary, { recursive: true, force: true })
  }
})

test('local weekly quota serializes finite accounts and settles only real terminal Harness usage', async () => {
  const monday = new Date()
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7))
  monday.setUTCHours(0, 0, 0, 0)
  let clock = monday.getTime() + 24 * 60 * 60_000
  let subject = 'account:quota-207'
  let limit = 100
  let enterpriseTokens = 90
  let calculatedAt = clock
  let usageAvailable = true
  const records = { snapshots: new Map(), reservations: new Map(), usage: new Map() }
  const table = name => ({
    entries: () => records[name].entries(),
    put: async (key, value) => { records[name].set(key, structuredClone(value)) },
    delete: async key => records[name].delete(key),
  })
  const warnings = []
  const identity = {
    localAccountSubject: () => subject,
    state: async () => ({
      authenticated: true,
      workspace_unlocked: true,
      account_subject: subject,
      weekly_token_limit: limit,
    }),
    usage: async timezone => {
      if (!usageAvailable) throw new Error('enterprise unavailable')
      return {
        schema_version: 1,
        scope: 'account',
        timezone,
        week: { total_tokens: enterpriseTokens },
        week_started_at: monday.toISOString(),
        calculated_at: new Date(calculatedAt).toISOString(),
      }
    },
  }
  const service = () => createQuotaService(
    { emateIdentity: identity, logger: { warn: message => warnings.push(message) } },
    table('snapshots'),
    table('reservations'),
    table('usage'),
    () => clock,
  )
  const quota = service()
  const policy = () => ({
    account_subject: subject,
    expires_at: new Date(monday.getTime() + 7 * 24 * 60 * 60_000).toISOString(),
  })
  const arm = (target, turn = 1, step = 1) => quota.armRequest(
    { agent: { id: target }, turn, step },
    { provider: 'e-mate-enterprise', model: 'gpt-5.6-luna' },
  )
  const options = target => ({
    sessionId: target,
    provider: 'e-mate-enterprise',
    model: 'gpt-5.6-luna',
  })

  await quota.refresh(policy())
  arm('quota-session-1')
  const failed = await quota.admit(options('quota-session-1'))
  assert.equal(records.reservations.values().next().value.reserved_tokens, 10)
  arm('quota-session-2')
  await assert.rejects(quota.admit(options('quota-session-2')), /unsettled request/)
  await quota.finish(failed, undefined, 'error')
  assert.equal(records.reservations.size, 0)

  arm('quota-session-3')
  const completed = await quota.admit(options('quota-session-3'))
  const realUsage = { inputTokens: 2, outputTokens: 3 }
  await quota.finish(completed, realUsage, 'stop')
  const event = {
    type: 'assistant/message',
    seq: 7,
    time: clock,
    data: {
      turn: 1,
      step: 1,
      message: { source: { kind: 'model', provider: 'e-mate-enterprise', model: 'gpt-5.6-luna' } },
      usage: realUsage,
    },
  }
  await quota.captureEvent('quota-session-3', event)
  await quota.captureEvent('quota-session-3', structuredClone(event))
  assert.equal(records.usage.size, 1)
  assert.equal(records.reservations.size, 0)
  assert.deepEqual(quota.status(), {
    ready: true,
    unlimited: false,
    enterprise_tokens: 90,
    local_tokens: 5,
    reservations: 0,
  })

  const factId = records.usage.keys().next().value
  await quota.markAuditDelivered(factId, new Date(clock).toISOString())
  clock += 1
  calculatedAt = clock
  enterpriseTokens = 95
  await quota.refresh(policy())
  assert.equal(quota.status().local_tokens, 0)

  usageAvailable = false
  arm('quota-session-offline')
  const orphan = await quota.admit(options('quota-session-offline'))
  const restarted = service()
  restarted.armRequest(
    { agent: { id: 'quota-session-restart' }, turn: 1, step: 1 },
    { provider: 'e-mate-enterprise', model: 'gpt-5.6-luna' },
  )
  await assert.rejects(
    restarted.admit(options('quota-session-restart')),
    /unsettled request/,
  )
  await restarted.finish(orphan, undefined, 'aborted')
  assert.equal(records.reservations.size, 0)

  usageAvailable = true
  enterpriseTokens = 100
  calculatedAt = ++clock
  await restarted.refresh(policy())
  restarted.armRequest(
    { agent: { id: 'quota-session-exhausted' }, turn: 1, step: 1 },
    { provider: 'e-mate-enterprise', model: 'gpt-5.6-luna' },
  )
  await assert.rejects(
    restarted.admit(options('quota-session-exhausted')),
    /allowance is exhausted/,
  )

  subject = 'account:other-207'
  assert.deepEqual(restarted.status(), { ready: false })
  subject = 'account:unlimited-207'
  limit = Number.MAX_SAFE_INTEGER
  enterpriseTokens = 123_456
  usageAvailable = true
  calculatedAt = clock
  await restarted.refresh(policy())
  restarted.armRequest(
    { agent: { id: 'quota-unlimited-1' }, turn: 1, step: 1 },
    { provider: 'e-mate-enterprise', model: 'gpt-5.6-luna' },
  )
  restarted.armRequest(
    { agent: { id: 'quota-unlimited-2' }, turn: 1, step: 1 },
    { provider: 'e-mate-enterprise', model: 'gpt-5.6-luna' },
  )
  assert.equal((await restarted.admit(options('quota-unlimited-1'))).unlimited, true)
  assert.equal((await restarted.admit(options('quota-unlimited-2'))).unlimited, true)
  assert.equal(records.reservations.size, 0)
  clock = monday.getTime() + 7 * 24 * 60 * 60_000
  assert.deepEqual(restarted.status(), { ready: false })
  assert.deepEqual(warnings, [
    'e-Mate finite weekly quota permits one in-flight request; one real request may exceed its remaining allowance',
  ])
})

test('audit records only real Harness usage and deduplicates reconnect replay and concurrent flush', async () => {
  const temporary = mkdtempSync(join(tmpdir(), 'e-mate-audit-'))
  const tables = { bindings: new Map(), outbox: new Map() }
  const taskTables = { bindings: new Map(), outbox: new Map() }
  const handlers = new Map()
  const cleanups = []
  const uploads = []
  const taskUploads = []
  const deliveredFacts = []
  let audit
  let rpc
  let interval
  let uploadAvailable = false
  const provider = {
    async upload(facts) {
      uploads.push(structuredClone(facts))
      if (!uploadAvailable) throw new Error('audit endpoint unavailable')
      return {
        schema_version: 1,
        receipts: facts.map(fact => ({
          fact_id: fact.fact_id,
          payload_sha256: fact.payload_sha256,
          receipt_id: `audit-receipt:${fact.fact_id.slice(-16)}`,
          accepted_at: new Date().toISOString(),
        })),
      }
    },
  }
  const taskProvider = {
    async upload(facts) {
      taskUploads.push(structuredClone(facts))
      if (!uploadAvailable) throw new Error('task audit endpoint unavailable')
      return {
        schema_version: 1,
        receipts: facts.map(fact => ({
          event_id: fact.event_id,
          payload_sha256: fact.payload_sha256,
          receipt_id: `task-receipt:${fact.event_id.slice(-16)}`,
          accepted_at: new Date().toISOString(),
        })),
      }
    },
  }
  const domain = source => ({
    table: name => ({
      entries: () => source[name].entries(),
      put: async (key, value) => { source[name].set(key, structuredClone(value)) },
    }),
    close: async () => {},
  })
  let openedDomains = 0
  try {
    const paths = installProfile(join(temporary, 'dsh-home'))
    await applyAudit({
      connection: { rpc: { handle: (channel, handler, options) => {
        rpc = { channel, handler, options }
        return () => {}
      } } },
      sessionPersistence: { list: async () => [], readFrom: async () => ({ events: [] }) },
      storageDomain: { open: async () => domain(openedDomains++ === 0 ? tables : taskTables) },
      emateIdentity: { localAccountSubject: () => 'tenant-207:user-207' },
      emateModelPolicy: {
        auditContext: async model => {
          assert.equal(model, 'gpt-5.6-luna')
          return {
            account_subject_sha256: 'a'.repeat(64),
            policy_revision: 3,
            policy_receipt_id: 'policy-receipt:audit-207',
            policy_sha256: 'b'.repeat(64),
          }
        },
        markAuditDelivered: async (factId, acceptedAt) => {
          deliveredFacts.push({ factId, acceptedAt })
        },
      },
      provide: (name, value) => {
        assert.equal(name, 'emateAudit')
        audit = value
      },
      effect(effect) {
        const cleanup = effect()
        if (typeof cleanup === 'function') cleanups.push(cleanup)
        return cleanup
      },
      on: (event, handler) => {
        handlers.set(event, handler)
        return () => { handlers.delete(event) }
      },
      interval: (callback, milliseconds) => {
        interval = { callback, milliseconds }
        return () => {}
      },
      logger: { warn: () => {} },
    }, {
      bindingPath: join(paths.profile, 'plugins', 'runtime-binding.json'),
      auditProvider: provider,
      taskAuditProvider: taskProvider,
      flushIntervalMs: 30_000,
    })
    await new Promise(resolve => setImmediate(resolve))

    assert.equal(rpc.channel, AUDIT_CHANNEL)
    assert.deepEqual(rpc.options, { authority: 'loopback' })
    assert.equal(interval.milliseconds, 30_000)
    const startedAt = Date.now()
    handlers.get('session/event')({ id: 'audit-session-1' }, {
      type: 'turn/start', seq: 0, time: startedAt, data: { turn: 1 },
    })
    const request = await handlers.get('agent/request')({
      agent: { id: 'audit-session-1' }, turn: 1, step: 1,
    }, async () => ({ provider: 'e-mate-enterprise', model: 'gpt-5.6-luna' }))
    assert.deepEqual(request, { provider: 'e-mate-enterprise', model: 'gpt-5.6-luna' })
    const event = {
      type: 'assistant/message',
      seq: 8,
      time: startedAt + 1,
      data: {
        turn: 1,
        step: 1,
        message: {
          id: 'assistant-message-1',
          role: 'assistant',
          content: [{ type: 'text', text: 'must never enter audit payload' }],
          source: { kind: 'model', provider: 'e-mate-enterprise', model: 'gpt-5.6-luna' },
        },
        usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 2, reasoningTokens: 1 },
      },
    }
    handlers.get('session/event')({ id: 'audit-session-1' }, event)
    handlers.get('session/event')({ id: 'audit-session-1' }, {
      type: 'tool/call', seq: 9, time: startedAt + 2,
      data: { turn: 1, step: 1, callId: 'private-call-id', name: 'private-tool-name', arguments: '{"secret":true}' },
    })
    handlers.get('session/event')({ id: 'audit-session-1' }, {
      type: 'approval/asked', seq: 10, time: startedAt + 3,
      data: { id: 'private-approval-id', toolName: 'private-tool-name' },
    })
    handlers.get('session/event')({ id: 'audit-session-1' }, {
      type: 'turn/end', seq: 11, time: startedAt + 4,
      data: { turn: 1, reason: { kind: 'completed' } },
    })
    await handlers.get('session/flush')()
    assert.equal(tables.bindings.size, 1)
    assert.equal(tables.outbox.size, 1)
    assert.equal(taskTables.bindings.size, 1)
    assert.equal(taskTables.outbox.size, 5)
    assert.deepEqual(
      [...taskTables.outbox.values()].map(record => record.payload.type),
      ['RECEIVED', 'FIRST_RESPONSE', 'TOOL_EXECUTION', 'PERMISSION_REQUESTED', 'COMPLETED'],
    )
    assert.ok([...taskTables.outbox.values()].every(record => record.payload.scenario === 'GENERAL'))
    assert.equal(JSON.stringify([...taskTables.outbox.values()]).includes('private-tool-name'), false)
    assert.equal(JSON.stringify([...taskTables.outbox.values()]).includes('private-call-id'), false)
    const stored = [...tables.outbox.values()][0]
    assert.equal(stored.status, 'pending')
    assert.equal(stored.payload.total_tokens, 17)
    assert.equal(stored.payload.account_subject_sha256, 'a'.repeat(64))
    assert.equal(JSON.stringify(stored).includes('audit-session-1'), false)
    assert.equal(JSON.stringify(stored).includes('must never enter audit payload'), false)
    handlers.get('session/event')({ id: 'audit-session-1' }, event)
    await handlers.get('session/flush')()
    assert.equal(tables.outbox.size, 1)

    const deferred = await audit.flush({ force: true })
    assert.equal(deferred.delivered_now, 0)
    assert.match(deferred.error_code, /^[0-9a-f]{16}$/)
    assert.equal(audit.status().pending, 1)
    assert.equal(audit.status().task_events_pending, 5)
    uploadAvailable = true
    const [delivered, sameFlight] = await Promise.all([
      audit.flush({ force: true }),
      audit.flush({ force: true }),
    ])
    assert.deepEqual(sameFlight, delivered)
    assert.equal(delivered.delivered_now, 1)
    assert.equal(delivered.delivered, 1)
    assert.equal(delivered.task_delivered_now, 5)
    assert.equal(deliveredFacts.length, 1)
    assert.equal(deliveredFacts[0].factId, stored.fact_id)
    assert.equal(Number.isFinite(Date.parse(deliveredFacts[0].acceptedAt)), true)
    assert.equal(tables.outbox.values().next().value.status, 'delivered')
    assert.equal(uploads.length, 2)
    assert.equal(taskUploads.length, 2)
    assert.equal('content' in uploads[1][0].payload, false)
    assert.deepEqual(uploads[1][0], uploads[0][0])
    handlers.get('session/event')({ id: 'audit-session-1' }, structuredClone(event))
    await handlers.get('session/flush')()
    assert.equal((await audit.flush({ force: true })).delivered_now, 0)
    assert.equal(uploads.length, 2)
    const status = await rpc.handler('audit.status', {})
    assert.equal(status.value.delivered_tokens, 17)
    assert.equal(status.value.task_events_delivered, 5)
    assert.equal((await rpc.handler('unknown', {})).error.code, 'bad-request')

    const blocked = createUsageFact('unbound-session', event, undefined)
    assert.equal(blocked.status, 'blocked')
    assert.equal(blocked.last_error_code, 'identity-policy-binding-missing-or-conflicting')
    const taskFact = createTaskAuditFact('audit-session-1', {
      type: 'turn/end', seq: 12, time: startedAt + 5, data: { turn: 2, reason: { kind: 'aborted' } },
    }, 'CANCELLED', { schema_version: 1, account_subject_sha256: 'e'.repeat(64) })
    assert.equal(taskFact.payload.type, 'CANCELLED')
    assert.equal(JSON.stringify(taskFact).includes('audit-session-1'), false)
  } finally {
    for (const cleanup of cleanups.reverse()) await cleanup()
    rmSync(temporary, { recursive: true, force: true })
  }
})

test('audit startup flushes a persisted outbox through the Host identity transport', async () => {
  const temporary = mkdtempSync(join(tmpdir(), 'e-mate-audit-backfill-'))
  const paths = installProfile(join(temporary, 'dsh-home'))
  const tables = { bindings: new Map(), outbox: new Map() }
  const taskTables = { bindings: new Map(), outbox: new Map() }
  const cleanups = []
  const deliveredFacts = []
  const uploads = []
  let audit
  let uploadAvailable = false
  let notifyAttempt
  const attempted = new Promise(resolve => { notifyAttempt = resolve })
  const event = {
    type: 'assistant/message',
    seq: 21,
    time: Date.now(),
    data: {
      turn: 2,
      step: 1,
      message: {
        source: { kind: 'model', provider: 'e-mate-enterprise', model: 'gpt-5.6-luna' },
      },
      usage: { inputTokens: 9, outputTokens: 4 },
    },
  }
  const pending = createUsageFact('audit-backfill-session', event, {
    schema_version: 1,
    account_subject_sha256: 'c'.repeat(64),
    policy_revision: 4,
    policy_receipt_id: 'policy-receipt:backfill-207',
    policy_sha256: 'd'.repeat(64),
    provider: 'e-mate-enterprise',
    model: 'gpt-5.6-luna',
  })
  tables.outbox.set(pending.fact_id, pending)
  const domain = source => ({
    table: name => ({
      entries: () => source[name].entries(),
      put: async (key, value) => { source[name].set(key, structuredClone(value)) },
    }),
    close: async () => {},
  })
  let openedDomains = 0
  try {
    await applyAudit({
      connection: { rpc: { handle: () => () => {} } },
      sessionPersistence: { list: async () => [], readFrom: async () => ({ events: [] }) },
      storageDomain: { open: async () => domain(openedDomains++ === 0 ? tables : taskTables) },
      emateIdentity: {
        uploadAudit: async records => {
          uploads.push(structuredClone(records))
          notifyAttempt()
          if (!uploadAvailable) throw new Error('e-Mate login is required')
          return {
            schema_version: 1,
            receipts: records.map(record => ({
              fact_id: record.fact_id,
              payload_sha256: record.payload_sha256,
              receipt_id: `audit-receipt:${record.fact_id.slice(-16)}`,
              accepted_at: new Date().toISOString(),
            })),
          }
        },
      },
      emateModelPolicy: {
        markAuditDelivered: async (factId, acceptedAt) => { deliveredFacts.push({ factId, acceptedAt }) },
      },
      provide: (_name, value) => { audit = value },
      effect(effect) {
        const cleanup = effect()
        if (typeof cleanup === 'function') cleanups.push(cleanup)
        return cleanup
      },
      on: () => () => {},
      interval: () => () => {},
      logger: { warn: () => {} },
    }, {
      bindingPath: join(paths.profile, 'plugins', 'runtime-binding.json'),
      flushIntervalMs: 30_000,
    })

    await attempted
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(audit.status().pending, 1)
    assert.equal(tables.outbox.get(pending.fact_id).attempt_count, 1)
    uploadAvailable = true
    const delivered = await audit.flush({ force: true })
    assert.equal(delivered.delivered_now, 1)
    assert.equal(tables.outbox.get(pending.fact_id).status, 'delivered')
    assert.equal(deliveredFacts.length, 1)
    assert.equal(uploads.length, 2)
  } finally {
    for (const cleanup of cleanups.reverse()) await cleanup()
    rmSync(temporary, { recursive: true, force: true })
  }
})

test('environment check validates the pinned Harness and embedded plugin closure', async () => {
  const dshHome = join(tmpdir(), `e-mate-check-${process.pid}`)
  const report = await checkEnvironment({ dshHome, includeProfile: false })
  assert.equal(report.checks.find(item => item.id === 'harness')?.status, 'pass')
  assert.equal(report.checks.find(item => item.id === 'plugin_bundles')?.status, 'pass')
  const credentialStore = await checkOsCredentialBackend()
  assert.equal(report.checks.find(item => item.id === 'platform')?.status, platformSupported() ? 'pass' : 'fail')
  assert.equal(report.checks.find(item => item.id === 'credential_store')?.status, credentialStore.ok ? 'pass' : 'fail')
  for (const removedId of [
    'platform_runtime', 'browser_runtime', 'office_worker', 'ocr_worker', 'chromium',
  ]) assert.equal(report.checks.some(item => item.id === removedId), false)
  assert.equal(report.ok, platformSupported() && credentialStore.ok)
})

test('health route reports real projected job activity and rejects writes', () => {
  const effects = []
  const jobs = []
  let changed
  let route
  let transformIndex
  const ctx = {
    jobs: {
      list: () => jobs,
      onJobsChanged: listener => {
        changed = listener
        return () => {}
      },
    },
    webServer: {
      tapIndex: transform => {
        transformIndex = transform
        return () => {}
      },
      register: value => {
        route = value
        return () => {}
      },
    },
    effect: effect => effects.push(effect()),
  }
  applyHealth(ctx)
  jobs.push({ id: 'image-1', status: 'running' })
  changed(undefined)

  const response = () => ({
    status: undefined,
    headers: undefined,
    body: undefined,
    writeHead(status, headers) { this.status = status; this.headers = headers },
    end(body) { this.body = body },
  })
  const get = response()
  route.handler({ method: 'GET' }, get)
  assert.equal(get.status, 200)
  assert.equal(JSON.parse(get.body).active_runs, 1)
  assert.equal(JSON.parse(get.body).product, 'e-Mate')

  const post = response()
  route.handler({ method: 'POST' }, post)
  assert.equal(post.status, 405)
  const branded = transformIndex('<head><title data-old="1">DeepSeek\nHarness</title><link rel="icon" href="/favicon.svg"></head>')
  assert.match(branded, /<title>e-Mate<\/title>/)
  assert.match(branded, /id="e-mate-boot-brand"/)
  assert.match(branded, /url\('\/assets\/e-mate\/logo\.png'\)/)
  assert.match(branded, /\[class\^="_wordmark_"\]/)
  assert.match(branded, /正在加载…/)
  assert.match(branded, /rel="icon" type="image\/png" href="\/assets\/e-mate\/xiaoxin-avatar\.png"/)
  assert.match(branded, /rel="manifest" href="\/manifest\.webmanifest"/)
  assert.doesNotMatch(branded, /favicon\.svg|DeepSeek|Harness/)
  assert.equal(transformIndex('<main>no title</main>'), '<main>no title</main>')
  assert.equal(effects.length, 3)
})

test('shell plugin serves branded Web resources without adding a transport', () => {
  const routes = new Map()
  const ctx = {
    webServer: {
      register: route => {
        routes.set(route.path, route)
        return () => { routes.delete(route.path) }
      },
    },
    effect: effect => effect(),
  }
  applyShell(ctx)
  assert.deepEqual([...routes.keys()], [
    '/assets/e-mate/logo.png',
    '/assets/e-mate/mark.png',
    '/assets/e-mate/team-hero.png',
    '/assets/e-mate/xiaoxin-avatar.png',
    '/assets/e-mate/send.svg',
    '/manifest.webmanifest',
  ])

  const response = () => ({
    status: undefined,
    headers: undefined,
    body: undefined,
    writeHead(status, headers) { this.status = status; this.headers = headers },
    end(body) { this.body = body },
  })
  const get = response()
  routes.get('/assets/e-mate/logo.png').handler({ method: 'GET' }, get)
  assert.equal(get.status, 200)
  assert.equal(get.headers['Content-Type'], 'image/png')
  assert.ok(get.body.byteLength > 0)

  const head = response()
  routes.get('/assets/e-mate/mark.png').handler({ method: 'HEAD' }, head)
  assert.equal(head.status, 200)
  assert.equal(head.body, undefined)

  const send = response()
  routes.get('/assets/e-mate/send.svg').handler({ method: 'GET' }, send)
  assert.equal(send.status, 200)
  assert.equal(send.headers['Content-Type'], 'image/svg+xml')
  assert.ok(send.body.byteLength > 0)

  const post = response()
  routes.get('/assets/e-mate/logo.png').handler({ method: 'POST' }, post)
  assert.equal(post.status, 405)
  assert.equal(post.headers.Allow, 'GET, HEAD')

  const webManifest = response()
  routes.get('/manifest.webmanifest').handler({ method: 'GET' }, webManifest)
  assert.equal(webManifest.status, 200)
  assert.equal(webManifest.headers['Cache-Control'], 'no-cache')
  assert.equal(webManifest.headers['Content-Type'], 'application/manifest+json; charset=utf-8')
  assert.equal(JSON.parse(webManifest.body).name, 'e-Mate')
  assert.equal(JSON.parse(webManifest.body).icons[0].src, '/assets/e-mate/xiaoxin-avatar.png')
})

test('user-visible runtime copy exposes only the e-Mate product brand', () => {
  const profile = new URL('../src/profile/', import.meta.url)
  const sources = [
    new URL('../src/e-mate.ts', import.meta.url),
    new URL('../src/legacy-migration.ts', import.meta.url),
    ...readdirSync(profile).filter(name => name.endsWith('.ts')).map(name => new URL(name, profile)),
  ]
  const leakedBrandLiteral = /(?:'[^'\n]*\b(?:DeepSeek Harness|Harness)\b[^'\n]*'|"[^"\n]*\b(?:DeepSeek Harness|Harness)\b[^"\n]*"|`[^`\n]*\b(?:DeepSeek Harness|Harness)\b[^`\n]*`)/u
  for (const source of sources) assert.doesNotMatch(readFileSync(source, 'utf8'), leakedBrandLiteral, source.pathname)
})

test('general conversations reuse a managed Harness workspace outside user projects', async () => {
  const dshHome = mkdtempSync(join(tmpdir(), 'e-mate-general-'))
  let created
  let renamed
  try {
    await applyGeneralWorkspace({
      workspaceRegistry: {
        create: async (path, title) => {
          created = { path: realpathSync(path), title }
          return { title: 'general', setTitle: async value => { renamed = value } }
        },
      },
    }, { dshHome })
    assert.deepEqual(created, {
      path: realpathSync(join(dshHome, 'e-mate', 'general')),
      title: '通用会话',
    })
    assert.equal(renamed, '通用会话')
  } finally {
    rmSync(dshHome, { recursive: true, force: true })
  }
})

test('shell assets are byte-identical to the pinned final e-Mate 2.0.5 UI', () => {
  const digest = path => createHash('sha256').update(readFileSync(path)).digest('hex')
  for (const name of [
    'e-mate-team-hero-transparent.png',
    'emate-logo.png',
    'emate-mark.png',
    'xiaoxin-avatar.png',
  ]) {
    assert.equal(
      digest(new URL(`../profile/plugins/emate-shell/assets/${name}`, import.meta.url)),
      digest(new URL(`../../../upstream/e-mate-2.0.5/desktop/src/v1/assets/${name}`, import.meta.url)),
      name,
    )
  }
})
