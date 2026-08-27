#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { access, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'

const SCRIPT_ROOT = dirname(fileURLToPath(import.meta.url))
export const REPO_ROOT = resolve(SCRIPT_ROOT, '../..')
export const DEFAULT_MANIFEST = join(SCRIPT_ROOT, 'critical-paths.json')
const CASE_ID = /^CP-(?:0[1-9]|1[0-5])$/u
const SHA40 = /^[a-f0-9]{40}$/u
const SHA256 = /^[a-f0-9]{64}$/u
const DESKTOP_REFERENCE_COMMIT = '6074088f5b660206e404b3591fab51fb99c69add'
const SUPPORTED_LAYERS = new Set(['component', 'app-dir', 'installed'])

function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (record(value)) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function positiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0
}

function safeRelative(path) {
  const result = relative(REPO_ROOT, resolve(REPO_ROOT, path))
  if (!result || result === '..' || result.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(result)) {
    throw new Error(`smoke path escapes the repository: ${path}`)
  }
  return result
}

function validateStep(step, label) {
  if (!record(step) || typeof step.id !== 'string' || !step.id || typeof step.type !== 'string') {
    throw new Error(`${label} has an invalid step`)
  }
  if (step.type === 'command' || step.type === 'json-probe') {
    if (typeof step.command !== 'string' || !step.command || !Array.isArray(step.args)
      || !step.args.every(value => typeof value === 'string')) {
      throw new Error(`${label}.${step.id} has an invalid command`)
    }
    if (step.cwd !== undefined) safeRelative(step.cwd)
    if (step.type === 'json-probe' && !record(step.expect)) {
      throw new Error(`${label}.${step.id} must declare expected facts`)
    }
  } else if (step.type === 'renderer-health') {
    if (!['app-dir', 'installed-app'].includes(step.app_input)) {
      throw new Error(`${label}.${step.id} has an invalid app input`)
    }
    if (step.args !== undefined && (!Array.isArray(step.args) || !step.args.every(value => typeof value === 'string'))) {
      throw new Error(`${label}.${step.id} has invalid application arguments`)
    }
  } else if (step.type === 'extension') {
    if (typeof step.extension !== 'string' || !step.extension || typeof step.owner !== 'string'
      || typeof step.reason !== 'string') {
      throw new Error(`${label}.${step.id} has an invalid extension seam`)
    }
  } else {
    throw new Error(`${label}.${step.id} has an unknown type ${step.type}`)
  }
  if (step.timeout_ms !== undefined && !positiveInteger(step.timeout_ms)) {
    throw new Error(`${label}.${step.id} timeout must be a positive integer`)
  }
}

export async function loadManifest(path = DEFAULT_MANIFEST) {
  const raw = await readFile(path, 'utf8')
  const manifest = JSON.parse(raw)
  if (!record(manifest) || manifest.schema_version !== 1 || typeof manifest.id !== 'string'
    || typeof manifest.base_contract_id !== 'string' || !SHA40.test(manifest.harness_commit)
    || !record(manifest.layers) || !Array.isArray(manifest.cases)) {
    throw new Error('critical-path smoke manifest header is invalid')
  }
  if (Object.keys(manifest.layers).sort().join(',') !== [...SUPPORTED_LAYERS].sort().join(',')) {
    throw new Error('critical-path smoke manifest must define component, app-dir and installed layers')
  }
  const expectedCases = Array.from({ length: 15 }, (_, index) => `CP-${String(index + 1).padStart(2, '0')}`)
  const actualCases = manifest.cases.map(item => item?.id)
  if (canonical(actualCases) !== canonical(expectedCases)) {
    throw new Error('critical-path smoke manifest must define CP-01 through CP-15 in order')
  }
  const extensions = new Set()
  for (const item of manifest.cases) {
    if (!record(item) || !CASE_ID.test(item.id) || typeof item.title !== 'string'
      || typeof item.owner !== 'string' || !record(item.stages)) {
      throw new Error('critical-path smoke case is invalid')
    }
    for (const layer of SUPPORTED_LAYERS) {
      const steps = item.stages[layer]
      if (!Array.isArray(steps) || steps.length === 0) throw new Error(`${item.id}.${layer} has no stages`)
      const ids = new Set()
      for (const step of steps) {
        validateStep(step, `${item.id}.${layer}`)
        if (ids.has(step.id)) throw new Error(`${item.id}.${layer} repeats step ${step.id}`)
        ids.add(step.id)
        if (step.type === 'extension') {
          if (extensions.has(step.extension)) throw new Error(`duplicate extension seam ${step.extension}`)
          extensions.add(step.extension)
        }
      }
    }
  }
  return { manifest, raw, extensions }
}

export async function loadExtensions(paths, manifestId, knownExtensions) {
  const bindings = new Map()
  for (const path of paths) {
    const extension = JSON.parse(await readFile(path, 'utf8'))
    if (!record(extension) || extension.schema_version !== 1 || extension.manifest_id !== manifestId
      || !record(extension.bindings)) {
      throw new Error(`smoke extension ${basename(path)} is invalid`)
    }
    for (const [name, steps] of Object.entries(extension.bindings)) {
      if (!knownExtensions.has(name)) throw new Error(`smoke extension binds unknown seam ${name}`)
      if (bindings.has(name) || !Array.isArray(steps) || steps.length === 0) {
        throw new Error(`smoke extension binding ${name} is invalid or duplicated`)
      }
      const ids = new Set()
      for (const step of steps) {
        validateStep(step, `extension.${name}`)
        if (step.type === 'extension') throw new Error(`extension ${name} cannot contain another extension seam`)
        if (ids.has(step.id)) throw new Error(`extension ${name} repeats step ${step.id}`)
        ids.add(step.id)
      }
      bindings.set(name, steps)
    }
  }
  return bindings
}

function boundedOutput(chunks) {
  const value = Buffer.concat(chunks).toString('utf8')
  return value.length > 128 * 1024 ? value.slice(-(128 * 1024)) : value
}

function runProcess(command, args, options) {
  return new Promise((resolveProcess) => {
    const stdout = []
    const stderr = []
    const startedAt = Date.now()
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      detached: options.detached ?? false,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let timedOut = false
    child.stdout.on('data', chunk => stdout.push(chunk))
    child.stderr.on('data', chunk => stderr.push(chunk))
    const timer = setTimeout(() => {
      timedOut = true
      try { child.kill('SIGKILL') } catch {}
    }, options.timeoutMs)
    child.once('error', (error) => {
      clearTimeout(timer)
      resolveProcess({ code: null, error, stdout: boundedOutput(stdout), stderr: boundedOutput(stderr), timedOut, durationMs: Date.now() - startedAt })
    })
    child.once('exit', (code, signal) => {
      clearTimeout(timer)
      resolveProcess({ code, signal, stdout: boundedOutput(stdout), stderr: boundedOutput(stderr), timedOut, durationMs: Date.now() - startedAt, pid: child.pid })
    })
  })
}

function commandDisplay(step) {
  return [step.command === '$NODE' ? 'node' : step.command, ...step.args]
}

function lastJson(value) {
  const lines = value.trim().split(/\r?\n/u).filter(Boolean)
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const parsed = JSON.parse(lines[index])
      if (record(parsed)) return parsed
    } catch {}
  }
  throw new Error('JSON probe emitted no structured receipt')
}

function matchesExpected(actual, expected) {
  if (record(expected)) {
    return record(actual) && Object.entries(expected).every(([key, value]) => matchesExpected(actual[key], value))
  }
  if (Array.isArray(expected)) {
    return Array.isArray(actual) && actual.length === expected.length
      && expected.every((value, index) => matchesExpected(actual[index], value))
  }
  return Object.is(actual, expected)
}

async function runCommandStep(step, context) {
  const cwd = resolve(REPO_ROOT, step.cwd ?? '.')
  const command = step.command === '$NODE' ? process.execPath : step.command
  const result = await runProcess(command, step.args, {
    cwd,
    env: { ...process.env, ...(step.env ?? {}) },
    timeoutMs: step.timeout_ms ?? context.timeoutMs,
  })
  if (result.timedOut) throw Object.assign(new Error('command timed out'), { code: 'COMMAND_TIMEOUT', result })
  if (result.error !== undefined) throw Object.assign(new Error('command did not start'), { code: 'COMMAND_START_FAILED', result })
  if (result.code !== 0) throw Object.assign(new Error(`command exited with ${String(result.code)}`), { code: `COMMAND_EXIT_${String(result.code)}`, result })
  if (step.type === 'json-probe') {
    const receipt = lastJson(result.stdout)
    if (receipt.schema_version !== 1 || receipt.case_id !== context.caseId || receipt.stage_id !== step.id
      || receipt.status !== 'passed' || !record(receipt.facts) || !matchesExpected(receipt.facts, step.expect)) {
      throw Object.assign(new Error('structured probe did not prove its expected facts'), { code: 'PROBE_FACT_MISMATCH', result })
    }
    if (context.layer !== 'component' && receipt.mocked !== false) {
      throw Object.assign(new Error('app-directory and installed probes cannot use mock evidence'), { code: 'MOCK_E2E_FORBIDDEN', result })
    }
  }
  return { durationMs: result.durationMs, command: commandDisplay(step) }
}

async function fileSha256(path) {
  return sha256(await readFile(path))
}

async function resolveExecutable(appPath) {
  const selected = resolve(appPath)
  const selectedStat = await stat(selected)
  if (selectedStat.isFile()) return selected
  if (!selectedStat.isDirectory()) throw new Error('selected application is not a file or directory')
  const candidates = process.platform === 'darwin'
    ? [join(selected, 'Contents', 'MacOS', 'e-Mate'), join(selected, 'Contents', 'MacOS', 'e-mate')]
    : process.platform === 'win32'
      ? [join(selected, 'e-Mate.exe'), join(selected, 'e-mate.exe')]
      : [join(selected, 'e-mate')]
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK)
      return candidate
    } catch {}
  }
  throw new Error('selected application does not contain the e-Mate executable')
}

export async function validateInstallReceipt(path, executable, manifest) {
  const raw = await readFile(path, 'utf8')
  const value = JSON.parse(raw)
  const runtime = value.runtime
  const install = value.install_receipt
  if (!record(runtime) || !record(install) || value.schema_version !== 2
    || value.kind !== 'installed-runtime-receipt' || value.source !== 'installed-application'
    || runtime.product !== 'e-mate-desktop' || runtime.product_version !== '2.0.15'
    || !SHA40.test(runtime.source_commit) || runtime.desktop_reference_commit !== DESKTOP_REFERENCE_COMMIT
    || runtime.base_contract_id !== manifest.base_contract_id
    || typeof runtime.profile_generation !== 'string' || !runtime.profile_generation
    || !SHA256.test(runtime.composition_sha256) || !SHA256.test(runtime.client_bundle_sha256)
    || !SHA256.test(runtime.desktop_artifact_sha256) || !positiveInteger(runtime.desktop_artifact_bytes)
    || install.installation_kind !== 'installed-application'
    || !['darwin-arm64', 'darwin-x64', 'win32-x64'].includes(install.target)
    || typeof install.bundle_id !== 'string' || !install.bundle_id
    || install.package_sha256 !== runtime.desktop_artifact_sha256
    || install.package_bytes !== runtime.desktop_artifact_bytes
    || !SHA256.test(install.installed_executable_sha256)
    || !positiveInteger(install.installed_executable_bytes)
    || !Number.isFinite(Date.parse(install.installed_at)) || !Number.isFinite(Date.parse(install.launched_at))
    || Date.parse(install.launched_at) < Date.parse(install.installed_at)) {
    throw new Error('installed candidate receipt is invalid')
  }
  const executableStat = await stat(executable)
  if (executableStat.size !== install.installed_executable_bytes
    || await fileSha256(executable) !== install.installed_executable_sha256) {
    throw new Error('installed executable does not match its receipt')
  }
  return {
    sha256: sha256(raw),
    source_commit: runtime.source_commit,
    version: runtime.product_version,
    target: install.target,
  }
}

async function terminateProcess(child) {
  if (child.pid === undefined) return
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' })
    return
  }
  try { process.kill(-child.pid, 'SIGTERM') } catch { try { child.kill('SIGTERM') } catch {} }
  await new Promise(resolveWait => setTimeout(resolveWait, 250))
  try { process.kill(-child.pid, 'SIGKILL') } catch { try { child.kill('SIGKILL') } catch {} }
}

async function runRendererHealthStep(step, context) {
  const selectedApp = step.app_input === 'app-dir' ? context.appDir : context.installedApp
  if (selectedApp === undefined) throw Object.assign(new Error(`missing --${step.app_input}`), { code: 'APP_INPUT_REQUIRED' })
  const executable = await resolveExecutable(selectedApp)
  const receipt = step.requires_install_receipt
    ? context.installReceipt === undefined
      ? (() => { throw Object.assign(new Error('missing --install-receipt'), { code: 'INSTALL_RECEIPT_REQUIRED' }) })()
      : await validateInstallReceipt(context.installReceipt, executable, context.manifest)
    : undefined
  const root = await mkdtemp(join(tmpdir(), 'emate-smoke-'))
  const userData = join(root, 'user-data')
  const dshHome = join(root, 'dsh-home')
  await mkdir(userData, { recursive: true })
  const ack = join(userData, '.release-health-ack')
  const failure = join(userData, '.release-health-failure')
  const startedAt = Date.now()
  const args = [...(step.args ?? []), `--user-data-dir=${userData}`]
  const child = spawn(executable, args, {
    env: { ...process.env, DSH_HOME: dshHome, EMATE_RELEASE_HEALTH_PROBE: '1' },
    stdio: 'ignore',
    detached: true,
  })
  let launchError
  child.once('error', error => { launchError = error })
  try {
    if (child.pid === undefined) throw new Error('application did not start')
    const deadline = startedAt + (step.timeout_ms ?? context.timeoutMs)
    for (;;) {
      try {
        const value = (await readFile(ack, 'utf8')).trim()
        if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u.test(value)) throw new Error('Renderer health acknowledgement version is invalid')
        if (receipt !== undefined && value !== receipt.version) throw new Error('Renderer health acknowledgement does not match the installed receipt')
        if (receipt === undefined && step.app_input === 'app-dir' && value !== context.expectedVersion) {
          throw new Error('Renderer health acknowledgement does not match the source-owned Desktop version')
        }
        return {
          durationMs: Date.now() - startedAt,
          facts: { renderer_healthy: true, process_alive_only: false, version: value },
          ...(receipt === undefined ? {} : { install_receipt: receipt }),
        }
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error
      }
      try {
        const reason = (await readFile(failure, 'utf8')).trim()
        throw new Error(reason ? 'application reported Renderer failure' : 'application reported an empty Renderer failure')
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error
      }
      if (launchError !== undefined) throw Object.assign(new Error('application failed to launch'), { cause: launchError })
      if (child.exitCode !== null || child.signalCode !== null) throw new Error('application exited before Renderer health')
      if (Date.now() >= deadline) throw Object.assign(new Error('Renderer health acknowledgement timed out'), { code: 'RENDERER_HEALTH_TIMEOUT' })
      await new Promise(resolveWait => setTimeout(resolveWait, 100))
    }
  } finally {
    await terminateProcess(child)
    await rm(root, { recursive: true, force: true })
  }
}

function errorCode(error) {
  return typeof error?.code === 'string' ? error.code : 'STEP_FAILED'
}

function resolveCaseSteps(item, layer, bindings) {
  return item.stages[layer].flatMap((step) => {
    if (step.type !== 'extension') return [step]
    return bindings.get(step.extension) ?? [step]
  })
}

export async function runSmoke(options = {}) {
  const loaded = await loadManifest(options.manifestPath)
  const manifest = loaded.manifest
  const layer = options.layer ?? 'component'
  if (!SUPPORTED_LAYERS.has(layer)) throw new Error(`unsupported smoke layer: ${layer}`)
  const selectedIds = options.caseIds?.length > 0 ? new Set(options.caseIds) : undefined
  if (selectedIds !== undefined) {
    for (const id of selectedIds) if (!CASE_ID.test(id)) throw new Error(`invalid smoke case id: ${id}`)
  }
  const selectedCases = manifest.cases.filter(item => selectedIds === undefined || selectedIds.has(item.id))
  if (selectedCases.length !== (selectedIds?.size ?? manifest.cases.length)) throw new Error('selected smoke case is absent from the manifest')
  const bindings = await loadExtensions(options.extensionPaths ?? [], manifest.id, loaded.extensions)
  const desktopPackage = JSON.parse(await readFile(join(REPO_ROOT, 'desktop/e-mate-desktop/package.json'), 'utf8'))
  if (typeof desktopPackage.version !== 'string') throw new Error('Desktop package version is invalid')
  const startedAt = new Date()
  const startedMs = Date.now()
  const cases = []
  const remaining = []
  let failed = false

  for (const item of selectedCases) {
    const caseStarted = Date.now()
    const stages = []
    for (const step of resolveCaseSteps(item, layer, bindings)) {
      const stageStarted = Date.now()
      if (step.type === 'extension') {
        stages.push({ id: step.id, status: 'pending', duration_ms: 0, extension: step.extension, owner: step.owner })
        remaining.push({ case_id: item.id, stage_id: step.id, extension: step.extension, owner: step.owner, reason: step.reason })
        continue
      }
      try {
        const result = step.type === 'renderer-health'
          ? await runRendererHealthStep(step, {
              appDir: options.appDir,
              installedApp: options.installedApp,
              installReceipt: options.installReceipt,
              manifest,
              expectedVersion: desktopPackage.version,
              timeoutMs: options.timeoutMs ?? 180000,
            })
          : await runCommandStep(step, {
              caseId: item.id,
              layer,
              timeoutMs: options.timeoutMs ?? 30000,
            })
        stages.push({ id: step.id, type: step.type, status: 'passed', duration_ms: result.durationMs, ...(result.command === undefined ? {} : { command: result.command }), ...(result.facts === undefined ? {} : { facts: result.facts }), ...(result.install_receipt === undefined ? {} : { install_receipt: result.install_receipt }) })
      } catch (error) {
        failed = true
        stages.push({ id: step.id, type: step.type, status: 'failed', duration_ms: Date.now() - stageStarted, error_code: errorCode(error) })
        if (!options.quiet) process.stderr.write(`[FAIL] ${item.id} ${layer}.${step.id}: ${error.message}\n`)
        if (!options.continueOnFailure) break
      }
    }
    const statuses = stages.map(stage => stage.status)
    const status = statuses.includes('failed') ? 'failed' : statuses.includes('pending') ? 'partial' : 'passed'
    cases.push({ id: item.id, title: item.title, owner: item.owner, status, duration_ms: Date.now() - caseStarted, stages })
    if (!options.quiet && status !== 'failed') process.stdout.write(`[${status.toUpperCase()}] ${item.id} ${item.title}\n`)
    if (failed && !options.continueOnFailure) break
  }

  const durationMs = Date.now() - startedMs
  const budgetMs = manifest.layers[layer].budget_ms
  const overBudget = durationMs > budgetMs
  if (overBudget) failed = true
  if (options.requireComplete && remaining.length > 0) failed = true
  const status = failed ? 'failed' : remaining.length > 0 ? 'passed-with-pending' : 'passed'
  const evidence = {
    schema_version: 1,
    document_type: 'emate.critical-path-smoke-evidence',
    manifest: { id: manifest.id, sha256: sha256(loaded.raw) },
    layer,
    selected_cases: selectedCases.map(item => item.id),
    status,
    started_at: startedAt.toISOString(),
    finished_at: new Date().toISOString(),
    duration_ms: durationMs,
    budget_ms: budgetMs,
    over_budget: overBudget,
    cases,
    remaining,
  }
  if (options.evidencePath !== undefined) await writeEvidence(options.evidencePath, evidence)
  return evidence
}

async function writeEvidence(path, evidence) {
  const output = resolve(path)
  await mkdir(dirname(output), { recursive: true })
  const temporary = `${output}.${String(process.pid)}.tmp`
  await writeFile(temporary, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 })
  await rename(temporary, output)
}

function parseCli(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      layer: { type: 'string', default: 'component' },
      case: { type: 'string', multiple: true },
      manifest: { type: 'string' },
      extension: { type: 'string', multiple: true },
      'app-dir': { type: 'string' },
      'installed-app': { type: 'string' },
      'install-receipt': { type: 'string' },
      evidence: { type: 'string' },
      'timeout-ms': { type: 'string' },
      'require-complete': { type: 'boolean', default: false },
      'continue-on-failure': { type: 'boolean', default: false },
      list: { type: 'boolean', default: false },
      quiet: { type: 'boolean', default: false }
    },
    allowPositionals: false,
  })
  const timeoutMs = values['timeout-ms'] === undefined ? undefined : Number(values['timeout-ms'])
  if (timeoutMs !== undefined && !positiveInteger(timeoutMs)) throw new Error('--timeout-ms must be a positive integer')
  return {
    layer: values.layer,
    caseIds: values.case,
    manifestPath: values.manifest,
    extensionPaths: values.extension,
    appDir: values['app-dir'],
    installedApp: values['installed-app'],
    installReceipt: values['install-receipt'],
    evidencePath: values.evidence,
    timeoutMs,
    requireComplete: values['require-complete'],
    continueOnFailure: values['continue-on-failure'],
    list: values.list,
    quiet: values.quiet,
  }
}

async function main() {
  const options = parseCli(process.argv.slice(2))
  if (options.list) {
    const { manifest } = await loadManifest(options.manifestPath)
    for (const item of manifest.cases) process.stdout.write(`${item.id}\t${item.title}\n`)
    return
  }
  const evidence = await runSmoke(options)
  process.stdout.write(`${JSON.stringify({ status: evidence.status, layer: evidence.layer, duration_ms: evidence.duration_ms, pending: evidence.remaining.length })}\n`)
  if (evidence.status === 'failed') process.exitCode = 1
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    process.stderr.write(`critical-path smoke failed: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
