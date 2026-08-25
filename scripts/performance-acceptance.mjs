#!/usr/bin/env node

import { createHash, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { constants, createReadStream } from 'node:fs'
import {
  copyFile, lstat, mkdir, readFile, readdir, realpath, writeFile,
} from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { parseArgs } from 'node:util'
import { PERFORMANCE_MODEL_LEAF_IDS, PERFORMANCE_MODEL_ROSTER } from './desktop-admission.mjs'
import {
  BASELINE_HARNESS_COMMIT,
  CANDIDATE_HARNESS_COMMIT,
  PERFORMANCE_PATH_NAMES,
  PERFORMANCE_SCENARIOS,
  assembleProductionEvidence,
  evaluateEvidence,
  verifyProductionArtifacts,
} from './performance-parity.mjs'

const SOURCE_COMMIT = /^[0-9a-f]{40}$/u
const SHA256 = /^[0-9a-f]{64}$/u
const MAX_FILE_BYTES = 64 * 1024 * 1024
const EVIDENCE_NAME = 'e-mate-performance-evidence.json'
const MANIFEST_NAME = 'manifest.json'
const VERIFIER_NAME = 'scripts/performance-parity.mjs'
const BASELINE_SOURCE_COMMIT = '9fbc70ad56c4f263dfa0aa0085f19eded134e32d'
const BASELINE_BASE_CONTRACT = 'e-mate-desktop-profile-v6-dsh-2bc16230975f'
const CANDIDATE_BASE_CONTRACT = 'e-mate-desktop-profile-v7-dsh-b2b1650b01f0'
const BASELINE_INSTALLS = Object.freeze({
  'darwin-arm64': Object.freeze({
    sha256: 'd2cb459d2e8648213e0b38aa6e210c1a727937be77993b2493e2a7848d5d3b2e',
    bytes: 390_527_181,
    profile_generation: 'd8769641262169a3b53369030a236f573e71499c22893d279e0a0c42df20ac93',
  }),
  'darwin-x64': Object.freeze({
    sha256: 'd2cb459d2e8648213e0b38aa6e210c1a727937be77993b2493e2a7848d5d3b2e',
    bytes: 390_527_181,
    profile_generation: '6ec6b157ea2668d4670bc332457bc85fe2f895d982a85a4a6b53a12e316e70ce',
  }),
  'win32-x64': Object.freeze({
    sha256: '52b84e14cce5ad49ada282b9a41913aa751db43765c8dba44088d66148dcd186',
    bytes: 272_939_381,
    profile_generation: '963ede65e703b338e23c0728519db8dee476b0465609fa17c4c9d481442fc5b6',
  }),
})
const SOURCE_ARTIFACTS = Object.freeze([
  'baseline.native.json',
  'baseline.provider.json',
  'baseline.headers.json',
  'baseline.paint.json',
  'baseline.installed.json',
  'emate-online.native.json',
  'emate-online.provider.json',
  'emate-online.headers.json',
  'emate-online.paint.json',
  'emate-online.installed.json',
  'emate-online.enterprise.json',
  'emate-enterprise-unavailable-valid-cache.native.json',
  'emate-enterprise-unavailable-valid-cache.provider.json',
  'emate-enterprise-unavailable-valid-cache.headers.json',
  'emate-enterprise-unavailable-valid-cache.paint.json',
  'emate-enterprise-unavailable-valid-cache.installed.json',
  'emate-enterprise-unavailable-valid-cache.enterprise.json',
])
const EXPECTED_MANIFEST_ARTIFACTS = Object.freeze({
  baseline: Object.freeze({
    native_trace_artifact: 'baseline.native.json',
    provider_receipt_artifact: 'baseline.provider.json',
    request_header_artifact: 'baseline.headers.json',
    renderer_paint_artifact: 'baseline.paint.json',
    installed_runtime_artifact: 'baseline.installed.json',
  }),
  emate_online: Object.freeze({
    native_trace_artifact: 'emate-online.native.json',
    provider_receipt_artifact: 'emate-online.provider.json',
    request_header_artifact: 'emate-online.headers.json',
    renderer_paint_artifact: 'emate-online.paint.json',
    installed_runtime_artifact: 'emate-online.installed.json',
    enterprise_receipt_artifact: 'emate-online.enterprise.json',
  }),
  emate_enterprise_unavailable_valid_cache: Object.freeze({
    native_trace_artifact: 'emate-enterprise-unavailable-valid-cache.native.json',
    provider_receipt_artifact: 'emate-enterprise-unavailable-valid-cache.provider.json',
    request_header_artifact: 'emate-enterprise-unavailable-valid-cache.headers.json',
    renderer_paint_artifact: 'emate-enterprise-unavailable-valid-cache.paint.json',
    installed_runtime_artifact: 'emate-enterprise-unavailable-valid-cache.installed.json',
    enterprise_receipt_artifact: 'emate-enterprise-unavailable-valid-cache.enterprise.json',
  }),
})

const canonical = value => Array.isArray(value)
  ? `[${value.map(canonical).join(',')}]`
  : value !== null && typeof value === 'object'
    ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
    : JSON.stringify(value)
const sha256 = value => createHash('sha256').update(value).digest('hex')

async function fileSha256(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

async function canonicalDirectory(path, label) {
  const resolved = resolve(path)
  const info = await lstat(resolved)
  if (!info.isDirectory() || info.isSymbolicLink() || await realpath(resolved) !== resolved) {
    throw new Error(`${label} must be a canonical, non-symlink directory`)
  }
  return resolved
}

async function emptyNewDirectory(path, label) {
  const requested = resolve(path)
  const parent = await realpath(dirname(requested))
  const resolved = join(parent, basename(requested))
  await mkdir(resolved, { mode: 0o700 })
  return resolved
}

async function boundedRegularFile(path, label) {
  const info = await lstat(path)
  if (!info.isFile() || info.isSymbolicLink() || info.size <= 0 || info.size > MAX_FILE_BYTES) {
    throw new Error(`${label} must be a bounded regular file`)
  }
}

function exactObject(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join('\0') === [...keys].sort().join('\0')
}

export function assertAcceptanceOwnerEnvironment(environment, sourceCommit) {
  const required = {
    GITHUB_ACTIONS: 'true',
    GITHUB_EVENT_NAME: 'workflow_dispatch',
    GITHUB_REF: 'refs/heads/main',
    GITHUB_REF_PROTECTED: 'true',
    GITHUB_RUN_ATTEMPT: '1',
  }
  if (Object.entries(required).some(([key, value]) => environment[key] !== value)
    || environment.GITHUB_SHA !== sourceCommit
    || environment.GITHUB_WORKFLOW_REF !== `${environment.GITHUB_REPOSITORY}/.github/workflows/desktop-performance.yml@refs/heads/main`) {
    throw new Error('production performance collection requires the exact protected-main one-shot workflow owner')
  }
}

export function createPairSchedule(performanceRunId, routeId) {
  return Array.from({ length: 30 }, (_, index) => {
    const scenario = PERFORMANCE_SCENARIOS[Math.floor(index / 10)]
    const armOrder = index % 2 === 0 ? 'AB' : 'BA'
    return {
      pair_id: `pair_${sha256(`${performanceRunId}\0${routeId}\0${String(index + 1)}`)}`,
      scenario,
      arm_order: armOrder,
      path_order: armOrder === 'AB'
        ? [...PERFORMANCE_PATH_NAMES]
        : ['emate_online', 'emate_enterprise_unavailable_valid_cache', 'baseline'],
    }
  })
}

export function createAcceptancePlan(input) {
  const models = PERFORMANCE_MODEL_ROSTER.map((performanceModel, index) => {
    const performanceRunId = `performance_${randomUUID()}`
    return {
      leaf_id: PERFORMANCE_MODEL_LEAF_IDS[index],
      performance_run_id: performanceRunId,
      performance_model: performanceModel,
      schedule: createPairSchedule(performanceRunId, performanceModel.route_id),
      output_directory: `models/${performanceModel.route_id}`,
      expected_files: [MANIFEST_NAME, ...SOURCE_ARTIFACTS],
    }
  })
  return {
    schema_version: 1,
    mode: 'production-installed-performance-acceptance',
    source_commit: input.sourceCommit,
    harness_commit: CANDIDATE_HARNESS_COMMIT,
    baseline_harness_commit: BASELINE_HARNESS_COMMIT,
    collector_sha256: input.collectorSha256,
    candidate_artifacts_root: input.candidateArtifactsRoot,
    profile_artifacts_root: input.profileArtifactsRoot,
    scratch_root: input.scratchRoot,
    models,
  }
}

async function runCollector(executable, planPath) {
  await new Promise((resolveRun, rejectRun) => {
    const child = spawn(executable, ['--plan', planPath], {
      shell: false,
      stdio: 'ignore',
      env: Object.fromEntries([
        'APPDATA', 'ComSpec', 'DISPLAY', 'HOME', 'LANG', 'LC_ALL', 'LOCALAPPDATA', 'LOGNAME', 'PATH',
        'SHELL', 'SystemRoot', 'TEMP', 'TMP', 'TMPDIR', 'USER', 'USERPROFILE', 'WAYLAND_DISPLAY', 'XDG_RUNTIME_DIR',
      ].filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]])),
    })
    child.once('error', rejectRun)
    child.once('exit', (code, signal) => code === 0 && signal === null
      ? resolveRun()
      : rejectRun(new Error('performance acceptance probe failed; inspect its runner-owned private log')))
  })
}

export async function assertCapturedSourceLayout(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const expected = [MANIFEST_NAME, ...SOURCE_ARTIFACTS].sort()
  if (canonical(entries.map(entry => entry.name).sort()) !== canonical(expected)
    || entries.some(entry => !entry.isFile() || entry.isSymbolicLink())) {
    throw new Error('collector must emit exactly one manifest and 17 source artifacts')
  }
  await Promise.all(expected.map(name => boundedRegularFile(join(directory, name), `collector source ${name}`)))
}

function assertManifestOwned(manifest, model, collectorSha256) {
  if (manifest.performance_run_id !== model.performance_run_id
    || canonical(manifest.performance_model) !== canonical(model.performance_model)
    || manifest.harness_commit !== CANDIDATE_HARNESS_COMMIT
    || manifest.baseline_harness_commit !== BASELINE_HARNESS_COMMIT) {
    throw new Error(`${model.performance_model.route_id} manifest escaped its one-shot owner`)
  }
  const expectedTool = `e-mate-performance-probe@sha256:${collectorSha256}`
  for (const pathName of PERFORMANCE_PATH_NAMES) {
    const path = manifest.paths?.[pathName]
    if (path?.tool !== expectedTool
      || Object.entries(EXPECTED_MANIFEST_ARTIFACTS[pathName]).some(([key, value]) => path?.[key] !== value)) {
      throw new Error(`${model.performance_model.route_id} ${pathName} authority paths are not closed`)
    }
  }
}

function assertExactSchedule(evidence, model) {
  const expected = model.schedule.map(({ pair_id, scenario, arm_order }) => ({ pair_id, scenario, arm_order }))
  const sessions = new Set()
  const invocations = new Set()
  const responses = new Set()
  for (const pathName of PERFORMANCE_PATH_NAMES) {
    const samples = evidence.paths[pathName].samples
    if (samples.length !== 30
      || canonical(samples.map(({ pair_id, scenario, arm_order }) => ({ pair_id, scenario, arm_order }))) !== canonical(expected)) {
      throw new Error(`${model.performance_model.route_id} ${pathName} did not execute the exact owned schedule`)
    }
    for (const sample of samples) {
      if (sessions.has(sample.session_id_sha256)) throw new Error('each acceptance sample requires a unique native Session')
      sessions.add(sample.session_id_sha256)
      for (const attempt of sample.provider_attempts) {
        if (invocations.has(attempt.provider_invocation_id_sha256)
          || responses.has(attempt.provider_response_id_sha256)) {
          throw new Error('provider ledger attempts must be globally unique within one model leaf')
        }
        invocations.add(attempt.provider_invocation_id_sha256)
        responses.add(attempt.provider_response_id_sha256)
      }
    }
  }
}

export function assertInstalledAuthorities(evidence, plan, candidateManifest) {
  const baseline = evidence.paths.baseline.run_receipt
  const online = evidence.paths.emate_online.run_receipt
  const offline = evidence.paths.emate_enterprise_unavailable_valid_cache.run_receipt
  const target = baseline.install_receipt.target
  const predecessor = BASELINE_INSTALLS[target]
  const candidateKey = target === 'win32-x64' ? 'win32' : 'darwin'
  const candidate = candidateManifest.artifacts?.[candidateKey]
  if (predecessor === undefined
    || baseline.runtime.source_commit !== BASELINE_SOURCE_COMMIT
    || baseline.runtime.base_contract_id !== BASELINE_BASE_CONTRACT
    || baseline.runtime.profile_generation !== predecessor.profile_generation
    || baseline.runtime.desktop_artifact_sha256 !== predecessor.sha256
    || baseline.runtime.desktop_artifact_bytes !== predecessor.bytes
    || baseline.install_receipt.package_sha256 !== predecessor.sha256
    || baseline.install_receipt.package_bytes !== predecessor.bytes
    || candidateManifest.source_commit !== plan.source_commit
    || candidate === undefined
    || online.runtime.source_commit !== plan.source_commit
    || online.runtime.base_contract_id !== CANDIDATE_BASE_CONTRACT
    || online.runtime.desktop_artifact_sha256 !== candidate.sha256
    || online.runtime.desktop_artifact_bytes !== candidate.bytes
    || online.install_receipt.package_sha256 !== candidate.sha256
    || online.install_receipt.package_bytes !== candidate.bytes
    || online.install_receipt.target !== target
    || canonical(online.runtime) !== canonical(offline.runtime)
    || canonical(online.install_receipt) !== canonical(offline.install_receipt)) {
    throw new Error('installed baseline/candidate authority does not match the frozen artifacts')
  }
}

async function copyModelHandoff(scratchDirectory, handoffDirectory) {
  await mkdir(handoffDirectory, { recursive: false, mode: 0o700 })
  const sourceNames = [EVIDENCE_NAME, ...SOURCE_ARTIFACTS, ...PERFORMANCE_PATH_NAMES.map(name => `${name}.raw-samples.json`)]
  if (sourceNames.length !== 21) throw new Error('internal performance handoff file count drifted')
  for (const name of sourceNames) {
    await copyFile(join(scratchDirectory, name), join(handoffDirectory, name), constants.COPYFILE_EXCL)
  }
}

async function walkFiles(root, directory = root) {
  const files = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isSymbolicLink()) throw new Error('performance handoff cannot contain symlinks')
    if (entry.isDirectory()) files.push(...await walkFiles(root, path))
    else if (entry.isFile()) files.push(relative(root, path).split(sep).join('/'))
    else throw new Error('performance handoff contains an unsupported entry')
  }
  return files
}

export async function finalizeAcceptanceCapture(plan, handoffRoot) {
  const handoff = await emptyNewDirectory(handoffRoot, 'performance handoff')
  const candidateManifest = JSON.parse(await readFile(
    join(plan.candidate_artifacts_root, 'desktop-candidate.json'),
    'utf8',
  ))
  for (const model of plan.models) {
    const scratchDirectory = join(plan.scratch_root, model.output_directory)
    await assertCapturedSourceLayout(scratchDirectory)
    const manifestPath = join(scratchDirectory, MANIFEST_NAME)
    const outputPath = join(scratchDirectory, EVIDENCE_NAME)
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    assertManifestOwned(manifest, model, plan.collector_sha256)
    const assembled = await assembleProductionEvidence(manifestPath, outputPath)
    assertExactSchedule(assembled, model)
    assertInstalledAuthorities(assembled, plan, candidateManifest)
    const verified = await verifyProductionArtifacts(assembled, outputPath)
    const decision = evaluateEvidence(verified)
    if (decision.gate_status !== 'passed') {
      throw new Error(`${model.performance_model.route_id} production performance gate did not pass`)
    }
    await writeFile(outputPath, `${JSON.stringify({ ...verified, decision }, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
    const modelHandoff = join(handoff, 'models', model.performance_model.route_id)
    await mkdir(dirname(modelHandoff), { recursive: true, mode: 0o700 })
    await copyModelHandoff(scratchDirectory, modelHandoff)
    const copied = JSON.parse(await readFile(join(modelHandoff, EVIDENCE_NAME), 'utf8'))
    const reverified = await verifyProductionArtifacts(copied, join(modelHandoff, EVIDENCE_NAME))
    if (evaluateEvidence(reverified).gate_status !== 'passed') throw new Error('copied performance evidence did not reverify')
  }
  await mkdir(join(handoff, 'scripts'), { mode: 0o700 })
  await copyFile(
    new URL('./performance-parity.mjs', import.meta.url),
    join(handoff, VERIFIER_NAME),
    constants.COPYFILE_EXCL,
  )
  const files = (await walkFiles(handoff)).sort()
  if (files.length !== 85 || !files.includes(VERIFIER_NAME) || files.includes(MANIFEST_NAME)) {
    throw new Error('final performance handoff must contain exactly 85 files and no scratch manifest')
  }
  return handoff
}

async function main() {
  const { values } = parseArgs({
    options: {
      collector: { type: 'string' },
      'collector-sha256': { type: 'string' },
      scratch: { type: 'string' },
      handoff: { type: 'string' },
      'source-commit': { type: 'string' },
      'candidate-artifacts': { type: 'string' },
      'profile-artifacts': { type: 'string' },
    },
    strict: true,
  })
  for (const key of ['collector', 'collector-sha256', 'scratch', 'handoff', 'source-commit', 'candidate-artifacts', 'profile-artifacts']) {
    if (values[key] === undefined) throw new Error(`--${key} is required`)
  }
  if (!SOURCE_COMMIT.test(values['source-commit']) || !SHA256.test(values['collector-sha256'])) {
    throw new Error('source commit or collector digest is invalid')
  }
  assertAcceptanceOwnerEnvironment(process.env, values['source-commit'])
  if (![values.collector, values.scratch, values.handoff, values['candidate-artifacts'], values['profile-artifacts']].every(isAbsolute)) {
    throw new Error('collector and acceptance paths must be absolute')
  }
  await boundedRegularFile(values.collector, 'performance collector')
  if (await realpath(values.collector) !== values.collector
    || await fileSha256(values.collector) !== values['collector-sha256']) {
    throw new Error('performance collector is not the exact configured executable')
  }
  const candidateArtifactsRoot = await canonicalDirectory(values['candidate-artifacts'], 'candidate artifacts')
  const profileArtifactsRoot = await canonicalDirectory(values['profile-artifacts'], 'profile artifacts')
  const scratchRoot = await emptyNewDirectory(values.scratch, 'performance scratch')
  await mkdir(join(scratchRoot, 'models'), { mode: 0o700 })
  for (const roster of PERFORMANCE_MODEL_ROSTER) {
    await mkdir(join(scratchRoot, 'models', roster.route_id), { mode: 0o700 })
  }
  const plan = createAcceptancePlan({
    sourceCommit: values['source-commit'],
    collectorSha256: values['collector-sha256'],
    candidateArtifactsRoot,
    profileArtifactsRoot,
    scratchRoot,
  })
  const planPath = join(scratchRoot, 'acceptance-plan.json')
  await writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
  await runCollector(values.collector, planPath)
  await finalizeAcceptanceCapture(plan, values.handoff)
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === import.meta.filename) await main()
