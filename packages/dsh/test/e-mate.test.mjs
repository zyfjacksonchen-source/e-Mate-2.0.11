import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { strToU8, zipSync } from 'fflate'
import { parse as parseYaml } from 'yaml'
import { Context } from '../../../upstream/deepseek-harness/vendor/cordis/lib/index.js'
import { LocalSubprocessRuntime } from '../../../upstream/deepseek-harness/packages/subprocess/subprocess-local/lib/index.js'
import { LocalAttachmentStore } from '../../../upstream/deepseek-harness/packages/attachment/attachment-local/lib/index.js'
import Storage from '../../../upstream/deepseek-harness/packages/storage/storage/lib/index.js'
import { JsonStorageBackend } from '../../../upstream/deepseek-harness/packages/storage/storage-json/lib/index.js'
import { DomainFacility } from '../../../upstream/deepseek-harness/packages/storage/storage-domain/lib/index.js'
import WorkspaceRegistry from '../../../upstream/deepseek-harness/packages/workspace/workspace/lib/index.js'

import {
  HARNESS_COMMIT,
  HARNESS_VERSION,
  checkEnvironment,
  latestUpdateReceipt,
  managedStatus,
  nodeVersionSupported,
  platformSupported,
  resolveHarness,
} from '../lib/e-mate.js'
import { installTestProfile as installProfile } from './runtime-binding.fixture.mjs'
import { apply as applyHealth } from '../profile/plugins/health.js'
import { apply as applyShare, SHARE_CHANNEL } from '../profile/plugins/share.js'
import { apply as applyGeneralWorkspace } from '../profile/plugins/general-workspace.js'
import { apply as applyAgentOperations } from '../profile/plugins/agent-operations.js'
import { apply as applyCapabilities, CAPABILITIES_CHANNEL } from '../profile/plugins/capabilities.js'
import { apply as applyConnections, CONNECTIONS_CHANNEL } from '../profile/plugins/connections.js'
import {
  CredentialStore,
  checkOsCredentialBackend,
  createOsCredentialBackend,
} from '../profile/plugins/credentials-os.js'
import { apply as applyOfficeOcr, loadRuntimeBinding, runWorker } from '../profile/plugins/office-ocr.js'
import { apply as applyBrowser } from '../profile/plugins/browser-computer-use.js'
import { apply as applyMemory, migrateLegacyMemory } from '../profile/plugins/memory.js'
import { apply as applyDream } from '../profile/plugins/dream.js'
import { apply as applyLearning } from '../profile/plugins/learning.js'
import { apply as applyImageGeneration } from '../profile/plugins/image-generation.js'
import { apply as applyModelPolicy, MODEL_POLICY_CHANNEL, validateModelPolicy } from '../profile/plugins/model-policy.js'
import { apply as applyAudit, AUDIT_CHANNEL, createUsageFact } from '../profile/plugins/audit.js'
import { apply as applyShell } from '../profile/plugins/emate-shell/index.js'
import {
  apply as applyIdentity,
  createEnterpriseIdentityProvider,
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
  releaseUpdateLock,
} from '../lib/update.js'
import { createSkillHubClient, inspectSkillArchive, installSkillArchive } from '../lib/skill-hub.js'

const fileDigest = path => createHash('sha256').update(readFileSync(path)).digest('hex')

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

test('external connections refresh control keeps a 44px touch target', () => {
  const source = readFileSync(new URL('../profile/plugins/emate-shell/src/client/connections.module.css', import.meta.url), 'utf8')
  const iconButton = source.match(/\.iconButton\s*\{[^}]+\}/)?.[0] ?? ''
  const coarse = source.match(/@media \(pointer: coarse\)\s*\{([\s\S]*?)\n\}/)?.[1] ?? ''
  const coarseIconButton = coarse.match(/\.iconButton\s*\{[^}]+\}/)?.[0] ?? ''
  assert.match(iconButton, /width:\s*32px/)
  assert.match(iconButton, /min-width:\s*32px/)
  assert.match(iconButton, /display:\s*grid/)
  assert.match(coarse, /\.iconButton,[\s\S]*?min-height:\s*44px/)
  assert.match(coarseIconButton, /width:\s*44px/)
  assert.match(coarseIconButton, /min-width:\s*44px/)
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
  assert.equal(
    readdirSync(new URL('../profile/plugins/', import.meta.url))
      .filter(name => name.startsWith('reflection-runtime-') && name.endsWith('.js')).length,
    1,
  )
})

test('online update target parsing rejects tags and downgrade ordering is SemVer-correct', () => {
  assert.equal(normalizeUpdateTarget(), 'latest')
  assert.equal(normalizeUpdateTarget('latest'), 'latest')
  assert.equal(normalizeUpdateTarget('2.0.8-rc.1'), '2.0.8-rc.1')
  assert.throws(() => normalizeUpdateTarget('next'), /invalid update version/)
  assert.throws(() => normalizeUpdateTarget('2.0'), /invalid update version/)
  assert.equal(compareVersions('2.0.7', '2.0.7-rc.1'), 1)
  assert.equal(compareVersions('2.0.7-rc.1', '2.0.7-rc.2'), -1)
  assert.equal(compareVersions('2.0.8', '2.0.7'), 1)
  assert.equal(globalPrefixForBinPath('/opt/e-mate/lib/node_modules/@e-mate/dsh/lib/bin.js', 'darwin'), '/opt/e-mate')
  assert.equal(
    globalPrefixForBinPath('C:\\Users\\e-mate\\AppData\\Roaming\\npm\\node_modules\\@e-mate\\dsh\\lib\\bin.js', 'win32'),
    'C:\\Users\\e-mate\\AppData\\Roaming\\npm',
  )
  assert.throws(() => globalPrefixForBinPath('/repo/packages/dsh/lib/bin.js', 'darwin'), /global npm installation/u)
  const updateSource = readFileSync(new URL('../src/update.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(updateSource, /--ignore-scripts/u, 'platform package postinstall must restore executable bits')
  assert.match(
    updateSource,
    /snapshotData\(paths\)\s+changed = true\s+runNpm\(\[\s*'install', '--global'/u,
    'a partial global install must enter rollback',
  )
  assert.match(updateSource, /runNode\(\[binPath, '--version'\]/u)
  assert.match(updateSource, /'launch', \.\.\.\(previousPort === undefined/u)
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
      requested_version: '2.0.8',
      previous_version: '2.0.7',
      error: 'must not reach status output',
      finished_at: '2026-08-15T01:00:00.000Z',
    }))
    writeFileSync(join(directory, `online-update-${second}.json`), JSON.stringify({
      schema_version: 1,
      product: 'e-Mate',
      request_id: second,
      status: 'completed',
      requested_version: '2.0.9',
      previous_version: '2.0.7',
      installed_version: '2.0.9',
      error: 'must not reach status output',
      finished_at: '2026-08-15T02:00:00.000Z',
    }))
    const expected = {
      request_id: second,
      status: 'completed',
      requested_version: '2.0.9',
      previous_version: '2.0.7',
      installed_version: '2.0.9',
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

test('Skill Hub archives validate and install atomically into the Harness user root', () => {
  const markdown = `---\nname: meeting-notes\ndescription: Summarize meeting notes\nversion: 1.2.3\n---\n\nUse the available document tools.\n`
  const archive = Buffer.from(zipSync({
    'SKILL.md': strToU8(markdown),
    'references/example.md': strToU8('Example'),
  }))
  const sha256 = createHash('sha256').update(archive).digest('hex')
  const inspected = inspectSkillArchive(archive, { slug: 'meeting-notes', version: '1.2.3', sha256 })
  assert.equal(inspected.name, 'meeting-notes')
  assert.deepEqual([...inspected.files.keys()], ['SKILL.md', 'references/example.md'])

  const dshHome = mkdtempSync(join(tmpdir(), 'e-mate-skill-'))
  try {
    const receipt = installSkillArchive(archive, { dshHome, slug: 'meeting-notes', version: '1.2.3', sha256 })
    assert.equal(receipt.package_sha256, sha256)
    const installed = join(dshHome, 'skills', 'meeting-notes', 'SKILL.md')
    assert.equal(readFileSync(installed, 'utf8'), markdown)
    assert.ok(existsSync(receipt.receipt))
    assert.throws(
      () => installSkillArchive(archive, { dshHome, slug: 'meeting-notes', version: '1.2.3', sha256: '0'.repeat(64) }),
      /SHA-256 does not match/,
    )
    assert.equal(readFileSync(installed, 'utf8'), markdown)
  } finally {
    rmSync(dshHome, { recursive: true, force: true })
  }
})

test('Skill Hub archives reject traversal before extraction', () => {
  const archive = Buffer.from(zipSync({
    '../outside.txt': strToU8('no'),
    'SKILL.md': strToU8('---\nname: safe\ndescription: Safe\nversion: 1.0.0\n---\n'),
  }))
  assert.throws(() => inspectSkillArchive(archive), /traversal/)
})

test('Skill Hub archives reject mismatched local and central file identities', () => {
  const archive = Buffer.from(zipSync({
    'SKILL.md': strToU8('---\nname: safe\ndescription: Safe\nversion: 1.0.0\n---\n'),
  }))
  archive[30] = 'X'.charCodeAt(0)
  assert.throws(() => inspectSkillArchive(archive), /local and central ZIP records do not match/)
})

test('Skill Hub client preserves the old intent/download/claim/install/complete transaction', async () => {
  const archive = Buffer.from(zipSync({
    'SKILL.md': strToU8('---\nname: safe\ndescription: Safe skill\nversion: 1.0.0\n---\nUse verified tools.\n'),
  }))
  const sha256 = createHash('sha256').update(archive).digest('hex')
  const card = {
    slug: 'safe',
    title: 'Safe',
    summary: 'Safe skill',
    version: '1.0.0',
    package_sha256: sha256,
    category: 'office_productivity',
    tags: [],
  }
  const requests = []
  const request = async (url, init = {}) => {
    requests.push({ url: url.href, method: init.method ?? 'GET' })
    if (url.pathname.endsWith('/skills/safe')) return Response.json({ skill: card, versions: [card] })
    if (url.pathname.endsWith('/install-intent')) return Response.json({ install_intent: 'intent-token' })
    if (url.pathname.endsWith('/package')) {
      return new Response(archive, { headers: { 'x-skill-content-sha256': sha256 } })
    }
    if (url.pathname.endsWith('/install-intents/consume')) return Response.json({ completion_receipt: 'completion-token' })
    if (url.pathname.endsWith('/install-intents/complete')) return Response.json({ schema_version: 1, status: 'installed' })
    return Response.json({ detail: 'unexpected request' }, { status: 404 })
  }
  const dshHome = mkdtempSync(join(tmpdir(), 'e-mate-hub-client-'))
  try {
    const client = createSkillHubClient({ request, dshHome })
    const installed = await client.install('safe', '1.0.0')
    assert.equal(installed.package_sha256, sha256)
    assert.ok(existsSync(join(dshHome, 'skills', 'safe', 'SKILL.md')))
    assert.deepEqual(requests.map(item => item.method), ['GET', 'POST', 'GET', 'GET', 'POST', 'POST'])
    assert.equal(requests.every(item => item.url.startsWith('https://dl.ecoremedia.net/ecorex-agent/client/skill-hub/v1/')), true)
  } finally {
    rmSync(dshHome, { recursive: true, force: true })
  }
})

test('Skill Hub install restores the previous local Skill when server completion rejects it', async () => {
  const archive = version => Buffer.from(zipSync({
    'SKILL.md': strToU8(`---\nname: safe\ndescription: Safe skill\nversion: ${version}\n---\nVersion ${version}.\n`),
  }))
  const oldArchive = archive('1.0.0')
  const oldSha256 = createHash('sha256').update(oldArchive).digest('hex')
  const nextArchive = archive('2.0.0')
  const nextSha256 = createHash('sha256').update(nextArchive).digest('hex')
  const card = {
    slug: 'safe', title: 'Safe', summary: 'Safe skill', version: '2.0.0',
    package_sha256: nextSha256, category: 'office_productivity', tags: [],
  }
  const completionStatuses = []
  const request = async (url, init = {}) => {
    if (url.pathname.endsWith('/skills/safe')) return Response.json({ skill: card, versions: [card] })
    if (url.pathname.endsWith('/install-intent')) return Response.json({ install_intent: 'intent-token' })
    if (url.pathname.endsWith('/package')) return new Response(nextArchive, { headers: { 'x-skill-content-sha256': nextSha256 } })
    if (url.pathname.endsWith('/install-intents/consume')) return Response.json({ completion_receipt: 'completion-token' })
    if (url.pathname.endsWith('/install-intents/complete')) {
      const status = JSON.parse(init.body).status
      completionStatuses.push(status)
      return status === 'installed'
        ? Response.json({ detail: 'completion rejected' }, { status: 409 })
        : Response.json({ schema_version: 1, status: 'failed' })
    }
    return Response.json({ detail: 'unexpected request' }, { status: 404 })
  }
  const dshHome = mkdtempSync(join(tmpdir(), 'e-mate-hub-rollback-'))
  try {
    installSkillArchive(oldArchive, { dshHome, slug: 'safe', version: '1.0.0', sha256: oldSha256 })
    await assert.rejects(createSkillHubClient({ request, dshHome }).install('safe', '2.0.0'), /completion rejected/)
    assert.match(readFileSync(join(dshHome, 'skills', 'safe', 'SKILL.md'), 'utf8'), /version: 1\.0\.0/)
    const receipt = JSON.parse(readFileSync(join(dshHome, 'e-mate', 'migrations', 'skill-safe.json'), 'utf8'))
    assert.equal(receipt.version, '1.0.0')
    assert.equal(receipt.status, 'installed')
    assert.deepEqual(completionStatuses, ['installed', 'failed'])
  } finally {
    rmSync(dshHome, { recursive: true, force: true })
  }
})

test('Skill Hub rejects oversized chunked responses without trusting content-length', async () => {
  const request = async () => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(1024 * 1024 + 1))
      controller.enqueue(new Uint8Array(1024 * 1024 + 1))
      controller.close()
    },
  }))
  await assert.rejects(
    createSkillHubClient({ request, dshHome: '/unused' }).search(),
    /response is too large/,
  )
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
    const manifest = readFileSync(join(first.profile, 'package.json'), 'utf8')
    assert.equal(JSON.parse(manifest).type, 'module')
    const patch = readFileSync(join(first.profile, 'cordis.patch.yml'), 'utf8')
    installProfile(dshHome)
    assert.equal(readFileSync(join(first.profile, 'package.json'), 'utf8'), manifest)
    assert.equal(readFileSync(join(first.profile, 'cordis.patch.yml'), 'utf8'), patch)
    const patchRows = parseYaml(patch).flatMap(operation => operation.insert ?? (operation.id ? [operation] : []))
    const patchById = new Map(patchRows.map(row => [row.id, row]))
    assert.deepEqual(patchById.get('credentials'), {
      id: 'credentials',
      name: '@deepseek-ai/dsh-credentials-local',
      disabled: true,
    })
    assert.equal(patchById.get('emate-credentials-os').name, './plugins/credentials-os.js')
    assert.equal(patchById.get('emate-connections').name, './plugins/connections.js')
    assert.deepEqual(patchById.get('ui-settings-models'), {
      id: 'ui-settings-models',
      name: '@deepseek-ai/dsh-client-ui-settings-models',
      disabled: true,
    })
    assert.deepEqual(patchById.get('ui-agent-preset'), {
      id: 'ui-agent-preset',
      name: '@deepseek-ai/dsh-client-ui-agent-preset',
      disabled: true,
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
    assert.equal(patchById.get('llm-deepseek').disabled, true)
    assert.deepEqual(patchById.get('agent-default-model').config, {
      provider: 'e-mate-enterprise',
      model: 'gpt-5.6-luna',
    })
    const enterpriseLlm = patchById.get('llm-pi-ai').config.providers['e-mate-enterprise']
    assert.equal(enterpriseLlm.apiKeyEnv, 'E_MATE_MODEL_SESSION_TOKEN')
    assert.equal(enterpriseLlm.api, 'openai-responses')
    assert.equal(enterpriseLlm.baseURL, 'https://mvdcm.ecoremedia.net/e-mate/model-api/v1')
    assert.deepEqual(enterpriseLlm.models.map(model => model.id), [
      'gpt-5.6-luna', 'gpt-5.6-sol', 'deepseek',
      'doubao-seed-2-0-pro-260215',
    ])
    assert.equal(patchById.get('emate-general-workspace').name, './plugins/general-workspace.js')
    assert.equal(patchById.get('schedule').name, '@deepseek-ai/dsh-schedule')
    assert.equal(patchById.get('emate-schedule-import').name, './plugins/schedule-import.js')
    assert.equal(patchById.get('emate-legacy-migration').name, './plugins/legacy-migration.js')
    assert.equal(patchById.get('emate-model-policy').name, './plugins/model-policy.js')
    assert.equal(patchById.get('emate-identity').config.enterprise.clientId, 'e-mate-desktop')
    assert.equal(patchById.get('emate-identity').config.enterprise.organization, 'emate')
    assert.equal(patchById.get('emate-share').name, './plugins/share.js')
    assert.equal(patchById.get('emate-audit').name, './plugins/audit.js')
    assert.equal(patchById.get('emate-agent-operations').name, './plugins/agent-operations.js')
    assert.equal(patchById.has('ui-sidebar'), false)
    assert.equal(patchById.has('emate-shell'), false)
    assert.match(patch, /\.\/plugins\/health\.js/)
    assert.match(patch, /id: emate-general-workspace[\s\S]*\.\/plugins\/general-workspace\.js[\s\S]*inject: \[workspaceRegistry\]/)
    assert.match(patch, /id: emate-identity[\s\S]*\.\/plugins\/identity\/index\.js/)
    assert.match(patch, /id: emate-capabilities[\s\S]*\.\/plugins\/capabilities\.js/)
    assert.match(patch, /id: emate-connections[\s\S]*\.\/plugins\/connections\.js[\s\S]*inject: \[credentials, connection, emateCapabilities\]/)
    assert.match(patch, /id: emate-agent-operations[\s\S]*\.\/plugins\/agent-operations\.js/)
    assert.match(patch, /id: emate-skill-hub-agent[\s\S]*\.\/plugins\/skill-hub-agent\.js/)
    assert.match(patch, /id: emate-office-ocr[\s\S]*\.\/plugins\/office-ocr\.js[\s\S]*inject: \[tools, fs, subprocess, webServer, emateCapabilities\]/)
    assert.match(patch, /id: emate-browser-computer-use[\s\S]*\.\/plugins\/browser-computer-use\.js[\s\S]*inject: \[tools, subprocess, attachments, webServer, emateCapabilities\]/)
    assert.match(patch, /id: emate-memory[\s\S]*\.\/plugins\/memory\.js[\s\S]*inject: \[tools, workspaceRegistry, storageDomain\]/)
    assert.match(patch, /id: emate-dream[\s\S]*\.\/plugins\/dream\.js[\s\S]*inject: \[tools, jobs, llm, emateMemory\]/)
    assert.match(patch, /id: emate-learning[\s\S]*\.\/plugins\/learning\.js[\s\S]*inject: \[tools, jobs, llm, emateMemory\]/)
    assert.match(patch, /id: emate-model-policy[\s\S]*\.\/plugins\/model-policy\.js[\s\S]*inject: \[apiProxy, connection, storageDomain, llm, emateIdentity\]/)
    assert.match(patch, /id: emate-audit[\s\S]*\.\/plugins\/audit\.js[\s\S]*inject: \[connection, sessionPersistence, storageDomain, timer, emateModelPolicy\]/)
    assert.match(patch, /id: emate-image-generation[\s\S]*\.\/plugins\/image-generation\.js[\s\S]*inject: \[tools, jobs, attachments, emateIdentity, emateModelPolicy, emateCapabilities\][\s\S]*rootUrl: https:\/\/mvdcm\.ecoremedia\.net\/e-mate\/model-api\/v1/)
    assert.match(patch, /id: emate-legacy-migration[\s\S]*\.\/plugins\/legacy-migration\.js[\s\S]*inject: \[sessionPersistence, webServer\]/)
    assert.match(patch, /id: emate-schedule-import[\s\S]*\.\/plugins\/schedule-import\.js[\s\S]*inject: \[tools\]/)
    assert.ok(readFileSync(join(first.profile, 'plugins', 'agent-operations.js')).byteLength > 0)
    assert.ok(readFileSync(join(first.profile, 'plugins', 'capabilities.js')).byteLength > 0)
    assert.ok(readFileSync(join(first.profile, 'plugins', 'general-workspace.js')).byteLength > 0)
    const connections = readFileSync(join(first.profile, 'plugins', 'connections.js'), 'utf8')
    assert.match(connections, /\/emate\.connections/)
    assert.match(connections, /credentials\.describe/)
    assert.match(connections, /emateCapabilities/)
    assert.doesNotMatch(connections, /\b(?:fetch|WebSocket|EventSource)\b/)
    const credentials = readFileSync(join(first.profile, 'plugins', 'credentials-os.js'), 'utf8')
    assert.match(credentials, /loadTargetCredentials/)
    assert.match(credentials, /DataProtectionScope\]::CurrentUser/)
    assert.match(credentials, /find-generic-password/)
    assert.doesNotMatch(credentials, /ctx\.connection|\.credentials\.yaml/)
    assert.ok(readFileSync(join(first.profile, 'plugins', 'office-ocr.js')).byteLength > 0)
    const memory = readFileSync(join(first.profile, 'plugins', 'memory.js'), 'utf8')
    assert.match(memory, /e_mate_memory_remember/)
    assert.match(memory, /e_mate_memory_search/)
    assert.match(memory, /workspaceRegistry\.resolveByPath/)
    assert.match(memory, /storageDomain\.open/)
    assert.doesNotMatch(memory, /node:sqlite|new WebSocket|from ["']@deepseek-ai\/dsh-storage-domain["']/)
    const dream = readFileSync(join(first.profile, 'plugins', 'dream.js'), 'utf8')
    assert.match(dream, /e_mate_dream_distill/)
    const dreamChunks = [...dream.matchAll(/from ["']\.\/([^"']+\.js)["']/g)].map(match => match[1])
    assert.ok(dreamChunks.length > 0)
    for (const chunk of dreamChunks) assert.ok(existsSync(join(first.profile, 'plugins', chunk)))
    assert.match(readFileSync(join(first.profile, 'plugins', 'learning.js'), 'utf8'), /e_mate_learning_search/)
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
    assert.match(binding.credentials_module_sha256, /^[0-9a-f]{64}$/)
    assert.match(binding.launch_environment_module_sha256, /^[0-9a-f]{64}$/)
    const dumped = spawnSync(process.execPath, [
      new URL('../lib/bin.js', import.meta.url).pathname,
      '--profile', 'e-mate', '--dump-config',
    ], {
      cwd: dshHome,
      env: { ...process.env, DSH_HOME: dshHome },
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
    })
    assert.equal(dumped.status, 0, dumped.stderr)
    assert.match(dumped.stdout, /- id: credentials\n  name: '@deepseek-ai\/dsh-credentials-local'\n  disabled: true/)
    assert.match(dumped.stdout, /- id: emate-credentials-os\n  name: \.\/plugins\/credentials-os\.js/)
    assert.match(dumped.stdout, /- id: ui-trajectory\n  name: '@deepseek-ai\/dsh-client-ui-trajectory'\n  disabled: true/)
    assert.doesNotMatch(dumped.stdout, /- id: credentials\n  name: '@deepseek-ai\/dsh-credentials-local'\n(?!  disabled: true)/)
    assert.doesNotMatch(dumped.stdout, /- id: ui-trajectory\n  name: '@deepseek-ai\/dsh-client-ui-trajectory'\n(?!  disabled: true)/)
    assert.match(binding.zod_module_sha256, /^[0-9a-f]{64}$/)
    const browser = readFileSync(join(first.profile, 'plugins', 'browser-computer-use.js'), 'utf8')
    assert.match(browser, /e_mate_browser/)
    assert.match(browser, /connectOverCDP/)
    assert.match(browser, /ctx\.subprocess\.spawn/)
    assert.doesNotMatch(browser, /from ["']playwright-core["']/)
    const skillAgent = readFileSync(join(first.profile, 'plugins', 'skill-hub-agent.js'), 'utf8')
    assert.doesNotMatch(skillAgent, /from ["']@deepseek-ai\/dsh-tools["']/)
    assert.match(skillAgent, /loadTargetTools/)
    assert.match(skillAgent, /e_mate_skill_hub_search/)
    assert.match(skillAgent, /e_mate_skill_hub_install/)
    assert.match(skillAgent, /e_mate_skill_hub_publish/)
    assert.match(skillAgent, /jobs\.attachController\(["']emate-skill-hub-ui["']\)/)
    assert.match(skillAgent, /\/api\/e-mate\/skill-hub\.download/)
    assert.match(skillAgent, /Content-Disposition/)
    assert.doesNotMatch(skillAgent, /^import\b[^\n]*\bfrom ["'](?:fflate|yaml)["'];?\s*$/m)
    const shell = join(first.profile, 'node_modules', '@deepseek-ai', 'dsh-client-ui-sidebar')
    const shellManifest = JSON.parse(readFileSync(join(shell, 'package.json'), 'utf8'))
    assert.deepEqual(shellManifest.dsh.client.inject, [
      '@deepseek-ai/dsh-client-runtime',
      '@deepseek-ai/dsh-client-connection',
      '@deepseek-ai/dsh-client-ui-layout',
      '@deepseek-ai/dsh-client-ui-conversation',
      '@deepseek-ai/dsh-client-locale',
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
    assert.match(client, /e-mate-capabilities-entry/)
    assert.match(client, /data-emate-capabilities/)
    assert.match(client, /\/emate\.skillHub/)
    assert.match(client, /\/emate\.capabilities/)
    assert.match(client, /\/emate\.connections/)
    assert.match(client, /ctx\.connection\.api\.credentials\.set/)
    assert.match(client, /ctx\.connection\.api\.credentials\.unset/)
    assert.match(client, /外部连接/)
    assert.match(client, /catalog\.search/)
    assert.match(client, /skills\.publish/)
    assert.match(client, /ctx\.connection\.api\.skills\.list/)
    assert.match(client, /\/capabilities/)
    assert.match(client, /保存 ZIP/)
    assert.match(client, /emate\/legacy-artifacts/)
    assert.match(client, /conversationEvents\.register/)
    assert.match(client, /legacy-artifact\.download/)
    assert.match(client, /conversation\.chat\.turnTail/)
    assert.match(client, /e-mate-office-artifacts/)
    assert.match(client, /e-mate-activity-group/)
    assert.match(client, /data-emate-activity-header/)
    const capabilities = readFileSync(new URL('../profile/plugins/emate-shell/src/client/capabilities.tsx', import.meta.url), 'utf8')
    assert.match(capabilities, /icons\[capability\.icon_key\]/)
    assert.match(capabilities, /社区 Skill 暂时不可用；内置能力仍可正常使用。/)
    assert.doesNotMatch(capabilities, /capability\.(?:id|title)\s*===|switch\s*\(\s*capability\.(?:id|title)/)
    assert.doesNotMatch(capabilities, /\b(?:fetch|WebSocket|EventSource)\s*\(/)
    const connectionsUi = readFileSync(new URL('../profile/plugins/emate-shell/src/client/connections.tsx', import.meta.url), 'utf8')
    assert.match(connectionsUi, /本机 Keychain 或 CurrentUser DPAPI/)
    assert.match(connectionsUi, /再次点击“确认清除”/)
    assert.doesNotMatch(connectionsUi, /\b(?:fetch|WebSocket|EventSource)\s*\(/)
    const sessionRoute = readFileSync(new URL('../profile/plugins/emate-shell/src/client/session-route.tsx', import.meta.url), 'utf8')
    assert.match(sessionRoute, /state\.phase !== ['"]ready['"]/) // waits for the target list baseline
    assert.match(sessionRoute, /Object\.prototype\.hasOwnProperty\.call\(state\.byId, id\)/)
    assert.match(sessionRoute, /openSession\(id\)/)
    assert.match(sessionRoute, /clearSession\(\)/)
    assert.match(sessionRoute, /\/chat\/\$\{encodeURIComponent\(current\)\}/)
    assert.doesNotMatch(sessionRoute, /\b(?:fetch|WebSocket|EventSource|createSnapshotStore|defineStore)\b/)
    const home = readFileSync(new URL('../profile/plugins/emate-shell/src/client/home.tsx', import.meta.url), 'utf8')
    const homeCss = readFileSync(new URL('../profile/plugins/emate-shell/src/client/home.module.css', import.meta.url), 'utf8')
    assert.match(home, /\[data-chain-overlay-fallback="conversation\.composer"\] > div/)
    assert.match(homeCss, /\[data-chain-overlay-fallback='conversation\.composer'\] > div > svg:first-child \+ div/)
    assert.match(homeCss, /min-height:\s*44px/)
    assert.doesNotMatch(homeCss, /> div > div:first-of-type/)
    const chatCss = readFileSync(new URL('../profile/plugins/emate-shell/src/client/chat-chrome.module.css', import.meta.url), 'utf8')
    assert.match(chatCss, /\[data-chat-flow-kind='tool-call'\] \+ \[data-chat-flow-kind='tool-call'\]/)
    assert.match(chatCss, /\[data-chat-flow\] > \[role='status'\]/)
    assert.match(chatCss, /\[data-chat-flow-kind='assistant-step'\] \[data-align\] > \[data-variant='tile'\]/)
    assert.match(chatCss, /clamp\(112px, 18vw, 156px\)/)
    assert.doesNotMatch(chatCss, /(?:e_mate_|imagegen|office|ocr|browser|feishu|weixin|dingtalk)/i)
    const catalogLoader = capabilities.slice(capabilities.indexOf('const loadCatalog'), capabilities.indexOf('const loadInstalled'))
    assert.match(catalogLoader, /setBuiltins\(/)
    assert.match(catalogLoader, /callSkillHub\('catalog\.search'/)
    assert.ok(catalogLoader.indexOf('setBuiltins(') < catalogLoader.indexOf("callSkillHub('catalog.search'"))
    assert.match(catalogLoader, /catch \(skillHubError\) \{\s*setItems\(\[\]\)\s*setError\(message\(skillHubError\)\)/)
    const activityHeader = readFileSync(new URL('../profile/plugins/emate-shell/src/client/activity-header.tsx', import.meta.url), 'utf8')
    assert.match(activityHeader, /ConversationNodeDefinition<ActivityHeaderState>/)
    assert.match(activityHeader, /event\.type === 'turn\/start'/)
    assert.match(activityHeader, /event\.type === 'tool\/call'/)
    assert.match(activityHeader, /event\.type === 'turn\/end'/)
    assert.match(activityHeader, /data-emate-activity-collapsed/)
    assert.match(activityHeader, /data-emate-activity-tail-status/)
    assert.match(chatCss, /data-emate-activity-tail-status='failed'/)
    assert.match(chatCss, /data-emate-activity-tail-status='cancelled'/)
    assert.doesNotMatch(activityHeader, /\b(?:fetch|WebSocket|EventSource|setTimeout)\s*\(/)
    const longMessage = readFileSync(new URL('../profile/plugins/emate-shell/src/client/long-message-disclosure.tsx', import.meta.url), 'utf8')
    const longMessageCss = readFileSync(new URL('../profile/plugins/emate-shell/src/client/long-message-disclosure.module.css', import.meta.url), 'utf8')
    assert.match(longMessage, /kind: 'e-mate-message-disclosure'/)
    assert.match(longMessage, /event\.type === 'user\/message'/)
    assert.match(longMessage, /event\.type === 'assistant\/message'/)
    assert.match(longMessage, /text\.scrollHeight > 160/)
    assert.match(longMessage, /data-emate-long-text-expanded/)
    assert.match(longMessage, /createPortal\(/)
    assert.match(longMessage, /data-emate-long-disclosure-host/)
    assert.match(longMessage, /aria-controls=\{controlId\}/)
    assert.match(longMessageCss, /\[data-emate-long-text\]\[data-emate-long-text-kind='assistant-step'\]/)
    assert.match(longMessageCss, /\[data-emate-long-text\]\[data-emate-long-text-kind='user'\]/)
    assert.doesNotMatch(longMessage, /\b(?:fetch|WebSocket|EventSource|setTimeout)\s*\(/)
    const legacyArtifactCss = readFileSync(new URL('../profile/plugins/emate-shell/src/client/legacy-artifacts.module.css', import.meta.url), 'utf8')
    assert.match(legacyArtifactCss, /flex-direction:\s*column/)
    assert.match(legacyArtifactCss, /\.item \+ \.item/)
    assert.match(legacyArtifactCss, /background:\s*var\(--dsw-alias-bg-layer-1\)/)
    const officeArtifacts = readFileSync(new URL('../profile/plugins/emate-shell/src/client/office-artifacts.tsx', import.meta.url), 'utf8')
    assert.match(officeArtifacts, /ConversationTurnDataMap/)
    assert.match(officeArtifacts, /isAppendSurfaceEvent\(event\)/)
    assert.match(officeArtifacts, /owner\.turn\.data\.get\('e-mate-office-artifacts'\)/)
    assert.doesNotMatch(officeArtifacts, /\b(?:fetch|WebSocket|EventSource|setTimeout)\s*\(/)
    assert.doesNotMatch(client, /\b(?:WebSocket|EventSource)\b|\bfetch\s*\(/)
    assert.ok(readFileSync(join(shell, 'assets', 'emate-logo.png')).byteLength > 0)
    assert.ok(readFileSync(join(shell, 'assets', 'lucide-send.svg')).byteLength > 0)
  } finally {
    rmSync(dshHome, { recursive: true, force: true })
  }
})

test('public share capability stays on the target RPC seam and fails closed without a provider', async () => {
  let registration
  applyShare({
    connection: { rpc: { handle: (channel, handler, options) => {
      registration = { channel, handler, options }
      return async () => {}
    } } },
    effect: effect => effect(),
  })
  assert.equal(registration.channel, SHARE_CHANNEL)
  assert.deepEqual(registration.options, { authority: 'loopback' })
  assert.deepEqual(await registration.handler('status', {}), {
    ok: true,
    value: {
      schema_version: 1,
      ready: false,
      blocker: 'public-share-provider-not-configured',
    },
  })
  assert.equal((await registration.handler('create', {})).error.code, 'bad-request')
  assert.equal((await registration.handler('status', [])).error.code, 'bad-request')
})

test('OS credential provider preserves target layering without exposing values through describe', async () => {
  const stored = new Map()
  const backend = {
    source: 'keychain',
    get: async ref => stored.get(ref),
    has: async ref => stored.has(ref),
    set: async (ref, value) => { stored.set(ref, value) },
    unset: async ref => stored.delete(ref),
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
  const described = await credentials.describe('CONNECTOR_TOKEN')
  assert.deepEqual(described, { configured: true, source: 'keychain', writable: true })
  assert.equal(JSON.stringify(described).includes('stored-secret'), false)
  assert.deepEqual(await credentials.resolve('PROJECT_ONLY'), { value: 'project-secret', source: 'project-env' })
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
  const mac = createOsCredentialBackend('darwin', '/unused', async (file, args, input = '') => {
    macCommands.push({ file, args, input })
    if (file === '/usr/bin/expect') {
      assert.equal(args.length, 2)
      assert.match(args[1], /password data for new item:/)
      assert.match(args[1], /retype password for new item:/)
      assert.match(args[1], /set timeout 30/)
      assert.match(args[1], /spawn -noecho \/usr\/bin\/security/)
      assert.match(args[1], /set account \{CONNECTOR_TOKEN\}/)
      assert.match(args[1], /set service \{net\.ecoremedia\.e-mate\.credentials\.v1\}/)
      assert.doesNotMatch(args[1], /mac-secret|bWFjLXNlY3JldA==/)
      keychain.set('CONNECTOR_TOKEN', input.trim())
      return { status: 0, stdout: '' }
    }
    const ref = args[args.indexOf('-a') + 1]
    if (args[0] === 'find-generic-password') {
      if (!keychain.has(ref)) return { status: 44, stdout: '' }
      return { status: 0, stdout: args.includes('-w') ? `${keychain.get(ref)}\n` : '' }
    }
    if (args[0] === 'delete-generic-password') return { status: keychain.delete(ref) ? 0 : 44, stdout: '' }
    return { status: 1, stdout: '' }
  })
  await mac.set('CONNECTOR_TOKEN', 'mac-secret')
  assert.equal(await mac.get('CONNECTOR_TOKEN'), 'mac-secret')
  assert.equal(await mac.has('CONNECTOR_TOKEN'), true)
  assert.equal(await mac.unset('CONNECTOR_TOKEN'), true)
  const macSet = macCommands.find(command => command.file === '/usr/bin/expect')
  assert.equal(macSet.args[0], '-c')
  assert.equal(macSet.args.includes('mac-secret'), false)
  assert.equal(macSet.args.includes(Buffer.from('mac-secret').toString('base64')), false)
  assert.equal(macSet.input.trim(), Buffer.from('mac-secret').toString('base64'))

  const dshHome = mkdtempSync(join(tmpdir(), 'e-mate-dpapi-'))
  const powershell = async (_file, _args, input) => {
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
    actions: [{ id: 'setup', label: '设置', kind: 'primary' }],
    status: async () => ({ state: 'setup-required', detail: '首次使用需要配置。', action_ids: ['setup'] }),
    invoke: async (action, data) => ({ action, data, accepted: true }),
  })
  const listed = await handler('list', {})
  assert.equal(listed.value.schema_version, 1)
  assert.deepEqual(listed.value.items.map(item => [item.id, item.state]), [['office', 'setup-required']])
  assert.equal(listed.value.items[0].icon_key, 'office')
  const acted = await handler('action', { capability_id: 'office', action_id: 'setup', data: { source: 'user' } })
  assert.deepEqual(acted.value.result, { action: 'setup', data: { source: 'user' }, accepted: true })
  assert.equal((await handler('action', { capability_id: 'office', action_id: 'missing', data: {} })).error.code, 'bad-request')
  assert.throws(() => registry.register({
    id: 'bad-icon', title: 'Bad', summary: 'Bad icon.', icon_key: 'emoji', order: 99,
    actions: [], status: async () => ({ state: 'blocked', action_ids: [] }),
  }), /invalid e-Mate capability definition/)
  assert.throws(() => registry.register({ id: 'office' }), /invalid e-Mate capability definition/)
  dispose()
  assert.deepEqual((await handler('list', {})).value.items, [])
})

test('external connection catalog uses target credentials and keeps unavailable adapters inert', async () => {
  let handler
  const capabilities = []
  const configured = new Set([
    'EMATE_FEISHU_APP_ID',
    'EMATE_DINGTALK_CLIENT_ID',
    'EMATE_DINGTALK_CLIENT_SECRET',
  ])
  applyConnections({
    get: service => service === 'emateCapabilities'
      ? { register: definition => { capabilities.push(definition); return () => {} } }
      : undefined,
    credentials: {
      describe: async ref => configured.has(ref)
        ? { configured: true, source: 'keychain', writable: true }
        : { configured: false, writable: true },
    },
    connection: { rpc: { handle: (channel, callback, options) => {
      assert.equal(channel, CONNECTIONS_CHANNEL)
      assert.deepEqual(options, { authority: 'loopback' })
      handler = callback
      return () => {}
    } } },
    effect: effect => effect(),
  })

  assert.deepEqual(capabilities.map(item => item.id), ['feishu', 'tencent-docs', 'wechat', 'dingtalk'])
  assert.ok(capabilities.every(item => item.actions.length === 0))
  const response = await handler('catalog', {})
  assert.equal(response.ok, true)
  assert.equal(response.value.schema_version, 1)
  const byId = new Map(response.value.items.map(item => [item.id, item]))
  assert.equal(byId.get('feishu').state, 'setup-required')
  assert.equal(byId.get('dingtalk').state, 'blocked')
  assert.equal(byId.get('wechat').fields.length, 0)
  assert.equal(byId.get('tencent-docs').fields[0].configured, false)
  assert.equal(JSON.stringify(response).includes('secret-value'), false)
  assert.deepEqual(await capabilities.at(-1).status(), {
    state: 'blocked',
    detail: '凭据已保存在本机；官方 Stream 适配完成真实连接验收前不会启用。',
    action_ids: [],
  })
  assert.equal((await handler('save-config', {})).error.code, 'bad-request')
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

test('Office and OCR use Harness fs/subprocess tools and persist verified immutable artifacts', async () => {
  const temporary = mkdtempSync(join(tmpdir(), 'e-mate-office-ocr-'))
  try {
    const runtimeRoot = join(temporary, 'runtime-package')
    const payloadRoot = join(runtimeRoot, 'runtime')
    const python = join(payloadRoot, 'python-bin')
    const worker = join(payloadRoot, 'worker.py')
    const models = ['det.onnx', 'rec.onnx', 'cls.onnx'].map(name => join(payloadRoot, name))
    mkdirSync(payloadRoot, { recursive: true })
    writeFileSync(python, 'python')
    writeFileSync(worker, 'worker')
    models.forEach((path, index) => writeFileSync(path, `model-${index}`))
    const digest = path => createHash('sha256').update(readFileSync(path)).digest('hex')
    const manifest = {
      schema_version: 1,
      package: `@e-mate/dsh-runtime-${process.platform}-${process.arch}`,
      version: '2.0.7',
      os: process.platform,
      cpu: process.arch,
      python_version: '3.11.15',
      python: 'runtime/python-bin',
      python_sha256: digest(python),
      worker: 'runtime/worker.py',
      worker_sha256: digest(worker),
      site_packages: 'runtime/python',
      office: true,
      ocr: true,
      worker_lock_sha256: 'cea6914a347a2a9a80f61260bea9d66d7d2fa2ad7e42434e6ecdafc63d8f8fd5',
      source_commit: '564a6b6c1d43fb6831dd4a5cd8026e472f063311',
      payload_files: 5,
      payload_sha256: '0'.repeat(64),
      models: models.map(path => ({
        path: `runtime/${path.slice(payloadRoot.length + 1)}`,
        size: readFileSync(path).byteLength,
        sha256: digest(path),
      })),
    }
    const manifestPayload = `${JSON.stringify(manifest, null, 2)}\n`
    writeFileSync(join(runtimeRoot, 'emate-runtime.json'), manifestPayload)
    const binding = join(temporary, 'runtime-binding.json')
    writeFileSync(binding, `${JSON.stringify({
      schema_version: 1,
      product: 'e-Mate',
      version: '2.0.7',
      dsh_home: join(temporary, 'dsh-home'),
      package: manifest.package,
      runtime_root: runtimeRoot,
      manifest_sha256: createHash('sha256').update(manifestPayload).digest('hex'),
      harness_commit: HARNESS_COMMIT,
      tools_module: join(import.meta.dirname, '../../../upstream/deepseek-harness/packages/core/tools/lib/index.js'),
      tools_module_sha256: digest(join(import.meta.dirname, '../../../upstream/deepseek-harness/packages/core/tools/lib/index.js')),
    })}\n`)

    const tools = new Map()
    const routes = new Map()
    const capabilities = []
    const requests = []
    const output = text => ({ readFrom: () => ({ text, nextOffset: Buffer.byteLength(text), lossy: false }) })
    const subprocess = {
      spawn(spec) {
        const request = JSON.parse(spec.stdio.stdin.data)
        requests.push({ request, spec })
        let result
        if (request.pack_id === 'ocr') {
          result = { provider: 'rapidocr_onnxruntime', status: 'success', text: '测试文字', blocks: [{ text: '测试文字', confidence: 0.99 }], latencyMs: 12 }
        } else if (request.operation === 'probe') {
          result = { provider: 'python-office-formats-v1', modules: ['docx'] }
        } else if (request.operation === 'read') {
          result = { provider: 'python-office-formats-v1', family: request.payload.family, text: '重新打开成功', structure: { paragraph_count: 1 }, warnings: ['visual_layout_not_verified'], truncated: false }
        } else {
          const content = Buffer.from('verified-docx')
          result = {
            provider: 'python-office-formats-v1', family: request.payload.family,
            mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            extension: '.docx', size_bytes: content.byteLength, content_base64: content.toString('base64'),
            validation: { paragraph_count: 1 },
          }
        }
        const response = JSON.stringify({ schema_version: 1, pack_id: request.pack_id, status: 'success', result })
        return {
          done: Promise.resolve({ exitCode: 0, signal: null }),
          collected: { stdout: output(response), stderr: output('') },
        }
      },
    }
    const ctx = {
      tools: { register: tool => { tools.set(tool.name, tool) } },
      subprocess,
      fs: {
        resolve: async path => ({ targetKey: path, displayPath: path }),
        stat: async () => ({ type: 'file', size: 68, version: 'v1' }),
        readBytes: async () => Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'),
      },
      webServer: { register: route => { routes.set(route.path, route); return () => {} } },
      get: name => name === 'emateCapabilities' ? { register: definition => { capabilities.push(definition); return () => {} } } : undefined,
      emit: () => {},
      effect: effect => effect(),
    }
    await applyOfficeOcr(ctx, { bindingPath: binding })
    assert.deepEqual([...tools.keys()], [
      'e_mate_ocr_extract',
      'e_mate_office_read',
      'e_mate_office_create',
      'e_mate_office_edit',
    ])
    assert.deepEqual(capabilities.map(item => item.id), ['office', 'ocr'])
    assert.equal((await capabilities[0].status()).state, 'ready')

    const exec = { signal: new AbortController().signal, agent: { session: { header: { cwd: '/workspace' } } } }
    const ocr = await tools.get('e_mate_ocr_extract').execute({ path: 'scan.png' }, exec)
    assert.equal(ocr.text, '测试文字')
    const created = await tools.get('e_mate_office_create').execute({
      family: 'document', title: '验收文档', content: { sections: [{ paragraphs: ['内容'] }] },
    }, exec)
    assert.match(created.artifact_id, /^office_artifact:/)
    const presentation = tools.get('e_mate_office_create').output.presentationMeta({}, created)
    assert.deepEqual(presentation.eMateOfficeArtifact, {
      artifact_id: created.artifact_id,
      family: created.family,
      filename: created.filename,
      mime_type: created.mime_type,
      size_bytes: created.size_bytes,
      sha256: created.sha256,
      download_url: created.download_url,
    })
    assert.ok(existsSync(join(temporary, 'dsh-home', 'e-mate', 'attachments', 'office', `${created.sha256}.docx`)))
    const reopened = await tools.get('e_mate_office_read').execute({ family: 'document', artifact_id: created.artifact_id }, exec)
    assert.equal(reopened.text, '重新打开成功')
    assert.equal(requests.every(item => item.spec.argv[0] === python && item.spec.cwd === runtimeRoot), true)
    assert.equal(requests.every(item => item.spec.env.PATH === undefined), true)
    assert.equal(requests.some(item => item.request.operation === 'read' && item.spec.argv.includes('--office-read-memory-limit')), true)

    const response = {
      status: undefined, headers: undefined, body: undefined,
      writeHead(status, headers) { this.status = status; this.headers = headers },
      end(body) { this.body = body },
    }
    routes.get('/api/e-mate/office.download').handler({ method: 'GET', url: created.download_url }, response)
    assert.equal(response.status, 200)
    assert.equal(response.headers['Content-Type'], created.mime_type)
    assert.equal(response.body.toString(), 'verified-docx')
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
})

test('packaged Office and OCR Workers run through the real Harness subprocess service', async t => {
  const platformRuntime = join(import.meta.dirname, '..', '..', `dsh-runtime-${process.platform}-${process.arch}`, 'emate-runtime.json')
  if (!existsSync(platformRuntime)) {
    t.skip('platform Runtime package is not built on this host')
    return
  }
  const dshHome = mkdtempSync(join(tmpdir(), 'e-mate-subprocess-composition-'))
  const ctx = new Context()
  let fiber
  try {
    const paths = installProfile(dshHome)
    const runtime = loadRuntimeBinding(join(paths.profile, 'plugins', 'runtime-binding.json'))
    fiber = await ctx.plugin(LocalSubprocessRuntime)
    const office = await runWorker(ctx, runtime, 'office', 'probe', {}, new AbortController().signal)
    assert.equal(office.provider, 'python-office-formats-v1')
    for (const sample of [
      {
        family: 'document', extension: '.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        initial: { sections: [{ heading: 'DOCX acceptance', paragraphs: ['DOCX initial'] }], tables: [{ rows: [['phase', 'value'], ['initial', '1']] }] },
        revised: { sections: [{ heading: 'DOCX acceptance', paragraphs: ['DOCX revised'] }] },
      },
      {
        family: 'spreadsheet', extension: '.xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        initial: { sheets: [{ name: 'Acceptance', rows: [['phase', 'value'], ['initial', 1]] }] },
        revised: { sheets: [{ name: 'Acceptance', rows: [['phase', 'value'], ['revised', 2]] }] },
      },
      {
        family: 'presentation', extension: '.pptx', mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        initial: { slides: [{ title: 'PPTX initial', bullets: ['acceptance'] }] },
        revised: { slides: [{ title: 'PPTX revised', bullets: ['acceptance'] }] },
      },
      {
        family: 'pdf', extension: '.pdf', mime: 'application/pdf',
        initial: { sections: [{ heading: 'PDF acceptance', paragraphs: ['PDF initial'] }] },
        revised: { sections: [{ heading: 'PDF acceptance', paragraphs: ['PDF revised'] }] },
      },
    ]) {
      const created = await runWorker(ctx, runtime, 'office', 'create', {
        family: sample.family, title: `${sample.family} initial`, ...sample.initial,
      }, new AbortController().signal)
      assert.equal(created.extension, sample.extension)
      assert.equal(created.mime_type, sample.mime)
      assert.ok(created.size_bytes > 0)
      const reopened = await runWorker(ctx, runtime, 'office', 'read', {
        family: sample.family, content_base64: created.content_base64,
      }, new AbortController().signal)
      assert.match(reopened.text, /initial/i)
      const edited = await runWorker(ctx, runtime, 'office', 'edit', {
        family: sample.family, title: `${sample.family} revised`, content_base64: created.content_base64, ...sample.revised,
      }, new AbortController().signal)
      assert.equal(edited.validation.source_opened, true)
      const reopenedEdit = await runWorker(ctx, runtime, 'office', 'read', {
        family: sample.family, content_base64: edited.content_base64,
      }, new AbortController().signal)
      assert.match(reopenedEdit.text, /revised/i)
    }
    const ocr = await runWorker(ctx, runtime, 'ocr', 'extract', {
      content_base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    }, new AbortController().signal)
    assert.equal(ocr.provider, 'rapidocr_onnxruntime')
  } finally {
    await fiber?.dispose()
    await ctx.fiber.dispose()
    rmSync(dshHome, { recursive: true, force: true })
  }
})

test('Browser Computer Use drives packaged Chromium through Harness subprocess and attachments', async t => {
  const platformBrowser = join(import.meta.dirname, '..', '..', `dsh-browser-${process.platform}-${process.arch}`, 'emate-browser.json')
  const platformRuntime = join(import.meta.dirname, '..', '..', `dsh-runtime-${process.platform}-${process.arch}`, 'emate-runtime.json')
  if (!existsSync(platformBrowser) || !existsSync(platformRuntime)) {
    t.skip('platform Browser or Runtime package is not built on this host')
    return
  }
  const dshHome = mkdtempSync(join(tmpdir(), 'e-mate-browser-composition-'))
  const server = createServer((req, res) => {
    if (req.url === '/file.txt') {
      const content = Buffer.from('e-Mate browser download')
      res.writeHead(200, {
        'Content-Type': 'text/plain',
        'Content-Length': String(content.byteLength),
        'Content-Disposition': 'attachment; filename="browser-proof.txt"',
      })
      res.end(content)
      return
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end('<!doctype html><title>e-Mate CU</title><input id="name"><input id="secret" type="password"><button id="go" onclick="document.querySelector(\'#result\').textContent=document.querySelector(\'#name\').value">提交</button><p id="result">等待</p><a id="download" href="/file.txt" download>下载</a>')
  })
  await new Promise((resolveListen, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolveListen)
  })
  const port = server.address().port
  const context = new Context()
  const cleanups = []
  let subprocessFiber
  let attachmentFiber
  try {
    const paths = installProfile(dshHome)
    subprocessFiber = await context.plugin(LocalSubprocessRuntime)
    attachmentFiber = await context.plugin(LocalAttachmentStore, { dshHome })
    const tools = new Map()
    const routes = new Map()
    const capabilities = []
    const browserContext = {
      tools: { register: tool => { tools.set(tool.name, tool); return () => { tools.delete(tool.name) } } },
      subprocess: context.subprocess,
      attachments: context.attachments,
      webServer: { register: route => { routes.set(route.path, route); return () => { routes.delete(route.path) } } },
      get: name => name === 'emateCapabilities'
        ? { register: definition => { capabilities.push(definition); return () => {} } }
        : undefined,
      effect(effect) {
        const cleanup = effect()
        if (typeof cleanup === 'function') cleanups.push(cleanup)
        return cleanup
      },
    }
    await applyBrowser(browserContext, { bindingPath: join(paths.profile, 'plugins', 'runtime-binding.json') })
    assert.deepEqual([...tools.keys()], ['e_mate_browser'])
    assert.deepEqual(capabilities.map(item => item.id), ['browser'])
    assert.equal((await capabilities[0].status()).state, 'ready')

    const exec = { signal: new AbortController().signal, agent: { id: 'browser-test-session' } }
    const browser = tools.get('e_mate_browser')
    const navigated = await browser.execute({ action: 'navigate', url: `http://127.0.0.1:${port}/` }, exec)
    assert.equal(navigated.title, 'e-Mate CU')
    assert.match(navigated.text, /提交/u)
    await browser.execute({ action: 'fill', selector: '#name', text: '真实动作' }, exec)
    await assert.rejects(
      browser.execute({ action: 'fill', selector: '#secret', text: 'must-not-enter' }, exec),
      /does not accept passwords/,
    )
    await browser.execute({ action: 'click', selector: '#go' }, exec)
    const snapshot = await browser.execute({ action: 'snapshot' }, exec)
    assert.match(snapshot.text, /真实动作/u)
    const screenshot = await browser.execute({ action: 'screenshot' }, exec)
    assert.equal(screenshot.screenshot.mediaType, 'image/png')
    assert.ok(screenshot.screenshot.bytes > 0)
    const downloaded = await browser.execute({ action: 'download', selector: '#download' }, exec)
    assert.equal(downloaded.download.filename, 'browser-proof.txt')
    assert.equal(downloaded.download.sha256, createHash('sha256').update('e-Mate browser download').digest('hex'))

    const response = {
      status: undefined, headers: undefined, body: undefined,
      writeHead(status, headers) { this.status = status; this.headers = headers },
      end(body) { this.body = body },
    }
    routes.get('/api/e-mate/browser.download').handler({ method: 'GET', url: downloaded.download.download_url }, response)
    assert.equal(response.status, 200)
    assert.equal(response.body.toString(), 'e-Mate browser download')
    await assert.rejects(
      browser.execute({ action: 'navigate', url: 'http://169.254.169.254/latest/meta-data/' }, exec),
      /link-local or cloud-metadata/,
    )
  } finally {
    for (const cleanup of cleanups.reverse()) await cleanup()
    await attachmentFiber?.dispose()
    await subprocessFiber?.dispose()
    await context.fiber.dispose()
    await new Promise(resolveClose => server.close(resolveClose))
    rmSync(dshHome, { recursive: true, force: true })
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
    const input = await context.attachments.saveImage({ data: inputBytes, mediaType: 'image/png', name: 'input.png' })
    const requests = []
    const requestScopes = []
    let remoteCounter = 0
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
        return json({
          id: `image-response-${++remoteCounter}`,
          data: [{ b64_json: inputBytes.toString('base64') }],
          usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
        })
      },
    }
    const tools = new Map()
    const jobs = []
    const controllers = []
    const capabilities = []
    const policyModels = []
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
      },
      attachments: context.attachments,
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
    }
    await applyImageGeneration(pluginCtx, {
      bindingPath: join(paths.profile, 'plugins', 'runtime-binding.json'),
      rootUrl: 'https://model.example/e-mate/model-api/v1',
    })
    assert.deepEqual([...tools.keys()], ['imagegen'])
    assert.deepEqual(controllers, ['emate-image'])
    assert.equal(capabilities.length, 1)
    assert.deepEqual(await capabilities[0].status(), {
      state: 'ready',
      detail: 'gpt-image-2-pro',
      action_ids: [],
    })
    const agent = {
      id: 'image-session',
      session: {
        header: { id: 'image-session' },
        deriveMessages: () => [{
          id: 'message-image',
          source: { kind: 'user' },
          content: [{ type: 'image', attachment: input }],
        }],
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

    const generated = await imagegen.execute({ prompt: 'Generate one verified image.' }, execution())
    assert.equal(generated.images.length, 1)
    assert.equal(generated.images[0].model, 'gpt-image-2-pro')
    assert.deepEqual(requests.at(-1), {
      path: '/e-mate/model-api/v1/images/generations',
      body: { model: 'gpt-image-2-pro', prompt: 'Generate one verified image.' },
    })
    assert.equal((await jobs.at(-1).done).status, 'completed')
    assert.equal(imagegen.output.render({}, generated).some(block => block.type === 'image'), true)

    const edited = await imagegen.execute({
      prompt: 'Retouch only the supplied image.',
      image_url: [String(input.attachmentId)],
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

    const concurrent = await Promise.all([
      imagegen.execute({ prompt: 'Generate independent variant A.' }, execution()),
      imagegen.execute({ prompt: 'Generate independent variant B.' }, execution()),
    ])
    assert.deepEqual(concurrent.map(result => result.images.length), [1, 1])
    assert.equal(maximumSubmissions >= 2, true)
    assert.deepEqual(policyModels, ['gpt-image-2-pro', 'gpt-image-2-pro', 'gpt-image-2-pro', 'gpt-image-2-pro'])
    assert.equal(requests.every(request => !('provider' in request.body) && !('api_key' in request.body)), true)
    const firstScope = `image-${createHash('sha256').update('image-session\0image-call-1').digest('hex').slice(0, 32)}`
    assert.deepEqual(requestScopes[0], { task: firstScope, trace: firstScope, session: firstScope, client: firstScope })
    assert.equal(new Set(requestScopes.map(scope => scope.task)).size, 4)
    await assert.rejects(
      imagegen.execute({ prompt: 'Edit missing image.', image_url: `sha256:${'f'.repeat(64)}` }, execution()),
      /not present in this e-Mate session/,
    )
    await assert.rejects(
      imagegen.execute({ prompt: 'Do not accept caller-selected model.', model: 'gpt-image-2' }, execution()),
      /additional property|only prompt and optional image_url/iu,
    )
  } finally {
    for (const cleanup of cleanups.reverse()) await cleanup()
    await attachmentFiber?.dispose()
    await context.fiber.dispose()
    rmSync(temporary, { recursive: true, force: true })
  }
})

test('legacy CowAgent memory migration is copy-on-write, idempotent, and bound to one target workspace', async () => {
  const temporary = mkdtempSync(join(tmpdir(), 'e-mate-legacy-memory-'))
  const source = join(temporary, 'ECoreX')
  const dshHome = join(temporary, 'dsh-home')
  mkdirSync(join(source, 'memory', 'dreams'), { recursive: true })
  mkdirSync(join(source, 'memory', 'evolution'), { recursive: true })
  mkdirSync(join(source, 'memory', 'users', 'alice'), { recursive: true })
  const main = join(source, 'MEMORY.md')
  writeFileSync(main, 'Keep this project-scoped fact.')
  writeFileSync(join(source, 'memory', 'dreams', '2026-08-01.md'), 'A historical dream.')
  writeFileSync(join(source, 'memory', 'evolution', '2026-08-01.md'), 'A historical learning.')
  writeFileSync(join(source, 'memory', 'users', 'alice', 'MEMORY.md'), 'Do not share this user-scoped memory.')
  const before = fileDigest(main)
  const records = new Map()
  const table = {
    entries: () => records.entries(),
    put: async (id, record) => { records.set(id, record) },
  }
  const workspace = { id: 'workspace-legacy', path: realpathSync(source), status: async () => 'ok' }
  const ctx = { workspaceRegistry: { list: () => [workspace] } }
  try {
    const first = await migrateLegacyMemory(ctx, table, { dshHome, sources: [source] })
    assert.deepEqual(
      { imported: first.imported_records, reused: first.reused_records, pending: first.pending_binding },
      { imported: 3, reused: 0, pending: false },
    )
    assert.equal([...records.values()].some(record => record.content.includes('Do not share')), false)
    const second = await migrateLegacyMemory(ctx, table, { dshHome, sources: [source] })
    assert.deepEqual(
      { imported: second.imported_records, reused: second.reused_records },
      { imported: 0, reused: 3 },
    )
    assert.equal(fileDigest(main), before)
    writeFileSync(main, 'Changed after completed migration.')
    await assert.rejects(migrateLegacyMemory(ctx, table, { dshHome, sources: [source] }), /changed after its completed migration/)
    assert.equal(records.size, 3)
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
})

test('project memory is durably isolated by the real Harness workspace registry and storage domain', async () => {
  const temporary = mkdtempSync(join(tmpdir(), 'e-mate-memory-isolation-'))
  const projectA = join(temporary, 'project-a')
  const projectB = join(temporary, 'project-b')
  const unowned = join(temporary, 'unowned')
  mkdirSync(projectA)
  mkdirSync(projectB)
  mkdirSync(unowned)
  mkdirSync(join(projectA, 'memory', 'dreams'), { recursive: true })
  mkdirSync(join(projectA, 'memory', 'evolution'), { recursive: true })
  mkdirSync(join(projectA, 'memory', 'users', 'legacy-user'), { recursive: true })
  const legacyMemoryFiles = [
    [join(projectA, 'MEMORY.md'), 'Legacy project decision: preserve the verified local Runtime.'],
    [join(projectA, 'memory', 'dreams', '2026-08-01.md'), 'Legacy dream: consolidated explicit project evidence only.'],
    [join(projectA, 'memory', 'evolution', '2026-08-01.md'), 'Legacy learning: keep project memory isolated.'],
    [join(projectA, 'memory', 'users', 'legacy-user', 'MEMORY.md'), 'Private legacy user memory must not become workspace shared.'],
  ]
  for (const [path, content] of legacyMemoryFiles) writeFileSync(path, content)
  const legacyMemoryBefore = new Map(legacyMemoryFiles.map(([path]) => [path, fileDigest(path)]))
  const canonicalA = realpathSync(projectA)
  const canonicalB = realpathSync(projectB)
  const storageRoot = join(temporary, 'storages')
  const dshHome = join(temporary, 'dsh-home')
  const ctx = new Context()
  const memoryCleanups = []
  let workspaceFiber
  let backend
  let facility
  let unregisterBackend
  let unmountDomain
  try {
    const paths = installProfile(dshHome)
    await ctx.plugin(Storage)
    backend = new JsonStorageBackend(storageRoot)
    unregisterBackend = ctx.storage.backend.register('json', backend)
    facility = new DomainFacility(ctx, { backend: 'json', routes: {} })
    unmountDomain = ctx.storage.mount('domain', facility)
    ctx.provide('storageDomain', facility)
    ctx.provide('sessionPersistence', {
      list: async () => [
        { version: 0, id: 'session-a2', createdAt: 3, cwd: projectA },
        { version: 0, id: 'session-a', createdAt: 2, cwd: projectA },
        { version: 0, id: 'session-b', createdAt: 1, cwd: projectB },
      ],
      load: async () => { throw new Error('memory isolation must not load session event bodies') },
      inspect: async () => { throw new Error('memory isolation must not inspect session event bodies') },
    })
    workspaceFiber = await ctx.plugin(WorkspaceRegistry)
    assert.deepEqual(
      ctx.workspaceRegistry.list().map(workspace => [workspace.path, [...workspace.sessionIds]]).sort(),
      [[canonicalA, ['session-a2', 'session-a']], [canonicalB, ['session-b']]].sort(),
    )

    const tools = new Map()
    let memoryService
    await applyMemory({
      tools: { register: tool => { tools.set(tool.name, tool); return () => { tools.delete(tool.name) } } },
      workspaceRegistry: ctx.workspaceRegistry,
      storageDomain: facility,
      provide: (name, value) => {
        assert.equal(name, 'emateMemory')
        memoryService = value
      },
      effect(effect) {
        const cleanup = effect()
        if (typeof cleanup === 'function') memoryCleanups.push(cleanup)
        return cleanup
      },
    }, {
      bindingPath: join(paths.profile, 'plugins', 'runtime-binding.json'),
      dshHome,
      legacyMemorySources: [projectA],
    })
    assert.equal(typeof memoryService.remember, 'function')
    assert.equal(memoryService.legacyMigration.imported_records, 3)
    assert.equal(memoryService.legacyMigration.pending_binding, false)
    assert.deepEqual([...tools.keys()].sort(), ['e_mate_memory_remember', 'e_mate_memory_search'])

    const execution = (id, cwd) => ({
      signal: new AbortController().signal,
      agent: { id, session: { header: { version: 0, id, createdAt: 0, ...(cwd === undefined ? {} : { cwd }) } } },
    })
    const remember = tools.get('e_mate_memory_remember')
    const search = tools.get('e_mate_memory_search')
    assert.deepEqual(
      (await search.execute({ query: 'Legacy project decision' }, execution('session-a', projectA))).items.map(item => item.content),
      ['Legacy project decision: preserve the verified local Runtime.'],
    )
    assert.deepEqual((await search.execute({ query: 'Private legacy user memory' }, execution('session-a', projectA))).items, [])
    const rememberedA = await remember.execute({ content: 'Alpha project fact', tags: ['alpha'] }, execution('session-a', projectA))
    assert.equal(rememberedA.scope, 'workspace')
    assert.deepEqual((await search.execute({ query: 'alpha' }, execution('session-a', projectA))).items.map(item => item.content), ['Alpha project fact'])
    assert.deepEqual((await search.execute({ query: 'alpha' }, execution('session-a2', projectA))).items.map(item => item.content), ['Alpha project fact'])
    assert.deepEqual((await search.execute({ query: 'alpha' }, execution('session-b', projectB))).items, [])

    await remember.execute({ content: 'Beta project fact' }, execution('session-b', projectB))
    assert.deepEqual((await search.execute({ query: 'Alpha project fact' }, execution('session-a', projectA))).items.map(item => item.content), ['Alpha project fact'])
    await assert.rejects(
      search.execute({}, execution('session-b', projectA)),
      /e-Mate session is not bound to its owning project/,
    )

    await remember.execute({ content: 'Session C fact' }, execution('session-c'))
    assert.deepEqual((await search.execute({}, execution('session-d'))).items, [])
    assert.deepEqual((await search.execute({}, execution('session-c'))).items.map(item => item.content), ['Session C fact'])
    await remember.execute({ content: 'Unowned CWD fact' }, execution('session-e', unowned))
    assert.deepEqual((await search.execute({}, execution('session-f', unowned))).items, [])

    const llmResponses = []
    const llmCalls = []
    const jobs = []
    const controllers = []
    let statusListener
    const pluginCtx = {
      tools: { register: tool => { tools.set(tool.name, tool); return () => { tools.delete(tool.name) } } },
      jobs: {
        attachController: kind => {
          controllers.push(kind)
          return () => {}
        },
        start(spec) {
          const id = `job-${jobs.length + 1}`
          const run = spec.run()
          jobs.push({ id, spec, ...run })
          return id
        },
      },
      llm: {
        async *stream(options) {
          llmCalls.push(options)
          const text = llmResponses.shift()
          if (text === undefined) throw new Error('unexpected reflection model call')
          yield { type: 'block-start', index: 0, blockType: 'text' }
          yield { type: 'text-delta', index: 0, text }
          yield { type: 'block-end', index: 0, block: { type: 'text', text } }
          yield { type: 'finish', reason: { kind: 'stop' } }
        },
      },
      emateMemory: memoryService,
      effect(effect) {
        const cleanup = effect()
        if (typeof cleanup === 'function') memoryCleanups.push(cleanup)
        return cleanup
      },
      on(event, listener) {
        assert.equal(event, 'agent/status')
        statusListener = listener
        return () => {}
      },
      logger: { warn: () => {} },
    }
    await applyDream(pluginCtx, { bindingPath: join(paths.profile, 'plugins', 'runtime-binding.json') })
    await applyLearning(pluginCtx, { bindingPath: join(paths.profile, 'plugins', 'runtime-binding.json') })
    assert.deepEqual(controllers.sort(), ['emate-dream', 'emate-learning'])

    const messages = Array.from({ length: 6 }, (_, index) => [
      {
        id: `user-${index + 1}`,
        source: { kind: 'user' },
        content: [{ type: 'text', text: `Explicit project request ${index + 1}` }],
      },
      {
        id: `assistant-${index + 1}`,
        source: { kind: 'model' },
        content: [{ type: 'text', text: `Explicit project result ${index + 1}` }],
      },
    ]).flat()
    const agent = (id, cwd, projectedMessages = messages) => ({
      id,
      options: { provider: 'fallback-provider', model: 'fallback-model' },
      session: {
        header: { version: 0, id, createdAt: 0, ...(cwd === undefined ? {} : { cwd }) },
        deriveMessages: () => projectedMessages,
        requestHeader: () => ({ config: { provider: 'routed-provider', model: 'routed-model' } }),
      },
    })
    const agentA = agent('session-a', projectA)
    const agentB = agent('session-b', projectB)
    const reflectExec = value => ({ agent: value, signal: new AbortController().signal })

    llmResponses.push(JSON.stringify({
      distilled_memory: ['The project contains six explicit requests.'],
      dream: 'Consolidated only the supplied project evidence.',
    }))
    const dreamStarted = await tools.get('e_mate_dream_distill').execute({}, reflectExec(agentA))
    assert.equal(dreamStarted.status, 'running')
    assert.equal((await jobs.find(job => job.id === dreamStarted.job_id).done).status, 'completed')
    assert.equal(llmCalls[0].provider, 'routed-provider')
    assert.equal(llmCalls[0].model, 'routed-model')
    assert.equal(llmCalls[0].sessionId, 'session-a')
    assert.equal((await tools.get('e_mate_dream_search').execute({ query: 'Consolidated only' }, reflectExec(agentA))).items.length, 1)
    assert.deepEqual((await tools.get('e_mate_dream_search').execute({}, reflectExec(agentB))).items, [])
    const dreamAgain = await tools.get('e_mate_dream_distill').execute({}, reflectExec(agentA))
    assert.equal((await jobs.find(job => job.id === dreamAgain.job_id).done).status, 'completed')
    assert.equal(llmCalls.length, 1)

    llmResponses.push(JSON.stringify({
      decision: 'learn',
      items: [{ content: 'Keep the six explicit project requests together.', evidence_message_ids: ['user-1', 'user-6'] }],
    }))
    statusListener({ agent: agentA, status: 'idle' })
    assert.equal((await jobs.at(-1).done).status, 'completed')
    const learningA = await tools.get('e_mate_learning_search').execute({ query: 'six explicit project requests' }, reflectExec(agentA))
    assert.equal(learningA.items.length, 1)
    assert.deepEqual(learningA.items[0].evidence_message_ids, ['user-1', 'user-6'])
    assert.deepEqual((await tools.get('e_mate_learning_search').execute({}, reflectExec(agentB))).items, [])

    llmResponses.push(JSON.stringify({
      decision: 'learn',
      items: [{ content: 'Unsupported learning', evidence_message_ids: ['missing-message'] }],
    }))
    statusListener({ agent: agentB, status: 'idle' })
    assert.equal((await jobs.at(-1).done).status, 'failed')
    assert.deepEqual((await tools.get('e_mate_learning_search').execute({}, reflectExec(agentB))).items, [])

    const agentC = agent('session-c')
    llmResponses.push(JSON.stringify({ decision: 'silent', items: [] }))
    statusListener({ agent: agentC, status: 'idle' })
    assert.equal((await jobs.at(-1).done).status, 'completed')
    assert.deepEqual((await tools.get('e_mate_learning_search').execute({}, reflectExec(agentC))).items, [])

    const stored = readFileSync(join(storageRoot, 'emate_memory.json'), 'utf8')
    assert.equal(stored.includes(canonicalA), false)
    assert.equal(stored.includes(canonicalB), false)
    const migrationReceipt = JSON.parse(readFileSync(join(dshHome, 'e-mate', 'migrations', 'legacy-memory-v1.json'), 'utf8'))
    assert.equal(migrationReceipt.records.length, 3)
    assert.equal(migrationReceipt.blocked_user_scoped_files.length, 1)
    assert.equal(stored.includes('Private legacy user memory'), false)
    for (const [path, before] of legacyMemoryBefore) assert.equal(fileDigest(path), before)
    rmSync(projectA, { recursive: true })
    await assert.rejects(search.execute({}, execution('session-a', projectA)))
  } finally {
    for (const cleanup of memoryCleanups.reverse()) await cleanup()
    await workspaceFiber?.dispose()
    await facility?.closeAll()
    unmountDomain?.()
    unregisterBackend?.()
    await backend?.close()
    await ctx.fiber.dispose()
    rmSync(temporary, { recursive: true, force: true })
  }
})

test('Agent operation guidance reuses Harness shell and Job semantics', () => {
  let section
  applyAgentOperations({
    systemPrompt: { section: value => { section = value } },
  })
  assert.equal(section.name, 'emate:agent-operations')
  assert.equal(section.order, 180)
  assert.match(section.text, /existing Bash tool/)
  assert.match(section.text, /PowerShell tool/)
  assert.match(section.text, /do not wrap it in another background Job/)
  assert.match(section.text, /Download, install, and publish create their own registered Jobs/)
  assert.match(section.text, /e-mate update --json/)
  for (const operation of ['search', 'download', 'install', 'publish']) {
    assert.match(section.text, new RegExp(`e_mate_skill_hub_${operation}`))
  }
  assert.match(section.text, /Do not compose or run npm install/)
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
  const credentials = {
    resolve: async ref => values.has(ref) ? { value: values.get(ref), source: 'test' } : undefined,
    set: async (ref, value) => { values.set(ref, value) },
    unset: async ref => { values.delete(ref) },
  }
  const clock = Date.parse('2030-01-08T12:00:00.000Z')
  const accessToken = 'access.payload.signature'
  const modelToken = 'model.payload.signature'
  const refreshToken = `emate_rt_${'r'.repeat(43)}`
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
  const requests = []
  const json = value => new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
  const session = {
    schemaVersion: 1,
    sessionId: 'session-enterprise-207',
    accessToken,
    refreshToken,
    expiresAt: new Date(clock + 60 * 60_000).toISOString(),
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
      usagePublicKey: 'test-usage-public-key',
      allowedModelIds: ['gpt-5.6-luna', 'gpt-image-2-pro'],
    },
  }
  const fetchImplementation = async (input, init = {}) => {
    const url = new URL(input)
    requests.push({ path: url.pathname, authorization: new Headers(init.headers).get('authorization') })
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
          clientVersion: '2.0.7',
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
        clientVersion: '2.0.7',
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
    throw new Error(`unexpected test endpoint ${url.pathname}`)
  }
  const provider = createEnterpriseIdentityProvider({
    credentials,
    enterprise: {
      authBaseUrl: 'https://mvdcm.ecoremedia.net/e-mate/auth-api',
      modelBaseUrl: 'https://mvdcm.ecoremedia.net/e-mate/model-api',
      clientId: 'e-mate-desktop',
      organization: 'emate',
    },
    fetchImplementation,
    now: () => clock,
  })

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
  await provider.login({ identifier: 'test.user', password: 'secret-value', remember_login: true })
  assert.equal(values.get(MODEL_SESSION_REF), modelToken)
  assert.doesNotMatch(values.get('E_MATE_ENTERPRISE_SESSION'), /secret-value|registration-secret/)
  const locked = await provider.bootstrap()
  assert.equal(locked.authenticated, true)
  assert.equal(locked.workspace_unlocked, false)
  assert.equal('accessToken' in locked, false)
  assert.equal('sessionToken' in locked, false)
  const modelPolicy = await provider.modelPolicy()
  assert.equal(modelPolicy.default_chat_model_id, 'gpt-5.6-luna')
  assert.deepEqual(modelPolicy.allowed_model_ids, [
    'gpt-5.6-luna', 'gpt-image-2-pro', 'gpt-image-2',
  ])
  const usage = await provider.usage('Asia/Shanghai')
  assert.equal(usage.week.total_tokens, 12_345)
  assert.equal(usage.timezone, 'Asia/Shanghai')
  await provider.acceptAgreements()
  const unlocked = await provider.bootstrap()
  assert.equal(unlocked.workspace_unlocked, true)
  assert.equal(unlocked.agreement_receipt_id, 'acceptance-receipt-207')
  const protectedRequests = requests.filter(request => request.path.includes('/v1/consents/'))
  assert.ok(protectedRequests.every(request => request.authorization === `Bearer ${modelToken}`))
  const logout = await provider.logout({ client_request_id: 'logout-request-207' })
  assert.equal(logout.receipt_id, 'logout-receipt-207')
  assert.equal(values.size, 0)
})

test('enterprise model policy filters the target ApiProxy and enforces cached account-bound policy', async () => {
  const temporary = mkdtempSync(join(tmpdir(), 'e-mate-model-policy-'))
  const cleanups = []
  const records = new Map()
  const table = {
    entries: () => records.entries(),
    put: async (key, value) => { records.set(key, structuredClone(value)) },
  }
  const domain = { table: name => name === 'active' ? table : undefined, close: async () => {} }
  const calls = { selected: [], policy: 0 }
  let accountSubject = 'account:test-207'
  let providerAvailable = true
  let rpc
  let requestPolicy
  let streamPolicy
  let modelPolicy
  const now = Date.now()
  const policy = () => ({
    schema_version: 1,
    account_subject: accountSubject,
    revision: 7,
    allowed_model_ids: ['gpt-5.6-luna', 'gpt-image-2-pro', 'gpt-image-2'],
    default_chat_model_id: 'gpt-5.6-luna',
    default_chat_reasoning_effort: 'max',
    image_primary_model_id: 'gpt-image-2-pro',
    image_fallback_upstream_model_id: 'gpt-image-2',
    issued_at: new Date(now - 1_000).toISOString(),
    expires_at: new Date(now + 60 * 60_000).toISOString(),
    receipt_id: 'policy-receipt:test-207',
  })
  const catalog = {
    groups: [{
      id: 'enterprise',
      name: 'e-Mate Enterprise',
      models: [
        { id: 'gpt-5.6-luna', name: 'e-Mate Chat' },
        { id: 'gpt-5.6-sol', name: 'e-Mate Sol' },
      ],
    }],
    failures: [],
  }
  const apiProxy = {
    sessions: {
      models: async request => ({
        rpcId: request.rpcId,
        result: { ok: true, value: { current: { provider: 'enterprise', model: 'gpt-5.6-luna' }, routable: true, ...catalog } },
      }),
      selectModel: async request => {
        calls.selected.push(request.payload.model)
        return { rpcId: request.rpcId, result: { ok: true, value: { selected: request.payload } } }
      },
    },
    llm: {
      models: async request => ({ rpcId: request.rpcId, result: { ok: true, value: catalog } }),
    },
  }
  try {
    const paths = installProfile(join(temporary, 'dsh-home'))
    await applyModelPolicy({
      apiProxy,
      connection: { rpc: { handle: (channel, handler, options) => {
        rpc = { channel, handler, options }
        return () => {}
      } } },
      llm: {},
      storageDomain: { open: async () => domain },
      emateIdentity: {
        state: async () => ({ authenticated: true, workspace_unlocked: true, account_subject: accountSubject }),
        modelPolicy: async () => {
          calls.policy += 1
          if (!providerAvailable) throw new Error('enterprise unavailable')
          return policy()
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
        else assert.fail(`unexpected model policy event ${event}`)
        return () => {}
      },
    }, { bindingPath: join(paths.profile, 'plugins', 'runtime-binding.json') })

    assert.equal(rpc.channel, MODEL_POLICY_CHANNEL)
    assert.deepEqual(rpc.options, { authority: 'loopback' })
    const current = await rpc.handler('policy.current', {})
    assert.equal(current.ok, true)
    assert.equal(current.value.revision, 7)
    assert.equal('account_subject' in current.value, false)
    assert.match(records.get('active').policy_sha256, /^[0-9a-f]{64}$/)
    assert.equal((await rpc.handler('unknown', {})).error.code, 'bad-request')

    const models = await apiProxy.sessions.models({ rpcId: 'models-1', payload: { sessionId: 'session-1' } })
    assert.deepEqual(models.result.value.groups[0].models.map(model => model.id), ['gpt-5.6-luna'])
    assert.equal(models.result.value.routable, true)
    const settingsModels = await apiProxy.llm.models({ rpcId: 'models-2', payload: {} })
    assert.deepEqual(settingsModels.result.value.groups[0].models.map(model => model.id), ['gpt-5.6-luna'])
    const allowed = await apiProxy.sessions.selectModel({
      rpcId: 'select-1', payload: { sessionId: 'session-1', provider: 'enterprise', model: 'gpt-5.6-luna' },
    })
    assert.equal(allowed.result.ok, true)
    const blocked = await apiProxy.sessions.selectModel({
      rpcId: 'select-2', payload: { sessionId: 'session-1', provider: 'enterprise', model: 'gpt-5.6-sol' },
    })
    assert.equal(blocked.result.error.code, 'model-unavailable')
    assert.deepEqual(calls.selected, ['gpt-5.6-luna'])
    assert.deepEqual(
      await requestPolicy({}, async () => ({ provider: 'enterprise', model: 'gpt-5.6-luna' })),
      { provider: 'enterprise', model: 'gpt-5.6-luna' },
    )
    await assert.rejects(
      requestPolicy({}, async () => ({ provider: 'enterprise', model: 'gpt-5.6-sol' })),
      /not allowed/,
    )
    const streamed = []
    for await (const chunk of streamPolicy(
      { provider: 'enterprise', model: 'gpt-5.6-luna' },
      () => (async function* () { yield 'ok' })(),
    )) streamed.push(chunk)
    assert.deepEqual(streamed, ['ok'])
    await assert.rejects(async () => {
      for await (const _chunk of streamPolicy(
        { provider: 'enterprise', model: 'gpt-5.6-sol' },
        () => (async function* () { yield 'blocked' })(),
      )) {}
    }, /not allowed/)

    providerAvailable = false
    assert.equal((await modelPolicy.refresh({ force: true })).revision, 7)
    accountSubject = 'account:other-207'
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

test('audit records only real Harness usage and uploads an idempotent durable outbox', async () => {
  const temporary = mkdtempSync(join(tmpdir(), 'e-mate-audit-'))
  const tables = { bindings: new Map(), outbox: new Map() }
  const handlers = new Map()
  const cleanups = []
  const uploads = []
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
  const domain = {
    table: name => ({
      entries: () => tables[name].entries(),
      put: async (key, value) => { tables[name].set(key, structuredClone(value)) },
    }),
    close: async () => {},
  }
  try {
    const paths = installProfile(join(temporary, 'dsh-home'))
    await applyAudit({
      connection: { rpc: { handle: (channel, handler, options) => {
        rpc = { channel, handler, options }
        return () => {}
      } } },
      sessionPersistence: { list: async () => [], readFrom: async () => ({ events: [] }) },
      storageDomain: { open: async () => domain },
      emateModelPolicy: {
        auditContext: async model => {
          assert.equal(model, 'ecorex-chat')
          return {
            account_subject_sha256: 'a'.repeat(64),
            policy_revision: 3,
            policy_receipt_id: 'policy-receipt:audit-207',
            policy_sha256: 'b'.repeat(64),
          }
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
      flushIntervalMs: 30_000,
    })

    assert.equal(rpc.channel, AUDIT_CHANNEL)
    assert.deepEqual(rpc.options, { authority: 'loopback' })
    assert.equal(interval.milliseconds, 30_000)
    const request = await handlers.get('agent/request')({
      agent: { id: 'audit-session-1' }, turn: 1, step: 1,
    }, async () => ({ provider: 'enterprise', model: 'ecorex-chat' }))
    assert.deepEqual(request, { provider: 'enterprise', model: 'ecorex-chat' })
    const event = {
      type: 'assistant/message',
      seq: 8,
      time: Date.now(),
      data: {
        turn: 1,
        step: 1,
        message: {
          id: 'assistant-message-1',
          role: 'assistant',
          content: [{ type: 'text', text: 'must never enter audit payload' }],
          source: { kind: 'model', provider: 'enterprise', model: 'ecorex-chat' },
        },
        usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 2, reasoningTokens: 1 },
      },
    }
    handlers.get('session/event')({ id: 'audit-session-1' }, event)
    await handlers.get('session/flush')()
    assert.equal(tables.bindings.size, 1)
    assert.equal(tables.outbox.size, 1)
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
    uploadAvailable = true
    const delivered = await audit.flush({ force: true })
    assert.equal(delivered.delivered_now, 1)
    assert.equal(delivered.delivered, 1)
    assert.equal(tables.outbox.values().next().value.status, 'delivered')
    assert.equal(uploads.length, 2)
    assert.equal('content' in uploads[1][0].payload, false)
    const status = await rpc.handler('audit.status', {})
    assert.equal(status.value.delivered_tokens, 17)
    assert.equal((await rpc.handler('unknown', {})).error.code, 'bad-request')

    const blocked = createUsageFact('unbound-session', event, undefined)
    assert.equal(blocked.status, 'blocked')
    assert.equal(blocked.last_error_code, 'identity-policy-binding-missing-or-conflicting')
  } finally {
    for (const cleanup of cleanups.reverse()) await cleanup()
    rmSync(temporary, { recursive: true, force: true })
  }
})

test('environment check validates real platform closures and otherwise fails closed', async () => {
  const dshHome = join(tmpdir(), `e-mate-check-${process.pid}`)
  const report = await checkEnvironment({ dshHome, includeProfile: false })
  assert.equal(report.checks.find(item => item.id === 'harness')?.status, 'pass')
  const runtimeBuilt = existsSync(join(
    import.meta.dirname,
    '..',
    '..',
    `dsh-runtime-${process.platform}-${process.arch}`,
    'emate-runtime.json',
  ))
  assert.equal(report.checks.find(item => item.id === 'platform_runtime')?.status, runtimeBuilt ? 'pass' : 'fail')
  assert.equal(report.checks.find(item => item.id === 'office_worker')?.status, runtimeBuilt ? 'pass' : 'fail')
  assert.equal(report.checks.find(item => item.id === 'ocr_worker')?.status, runtimeBuilt ? 'pass' : 'fail')
  const browserBuilt = existsSync(join(
    import.meta.dirname,
    '..',
    '..',
    `dsh-browser-${process.platform}-${process.arch}`,
    'emate-browser.json',
  ))
  assert.equal(report.ok, runtimeBuilt && browserBuilt)
  assert.equal(report.checks.find(item => item.id === 'browser_runtime')?.status, browserBuilt ? 'pass' : 'fail')
  assert.equal(report.checks.find(item => item.id === 'chromium')?.status, browserBuilt ? 'pass' : 'fail')
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
  try {
    await applyGeneralWorkspace({
      workspaceRegistry: {
        create: async (path, title) => { created = { path: realpathSync(path), title } },
      },
    }, { dshHome })
    assert.deepEqual(created, {
      path: realpathSync(join(dshHome, 'e-mate', 'general')),
      title: '通用会话',
    })
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
