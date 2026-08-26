#!/usr/bin/env node

import { createHash, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { constants as fsConstants, createReadStream } from 'node:fs'
import { cp, lstat, mkdir, mkdtemp, open, readFile, readdir, realpath, rm, rmdir, writeFile } from 'node:fs/promises'
import { arch, homedir, hostname } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { parseArgs } from 'node:util'
import {
  assembleProfileGeneration,
  loadProfileGeneration,
} from '../desktop/e-mate-desktop/src/profile-generation.ts'
import {
  loadProfileBaseContract,
  parseProfileBaseContract,
  verifyProfileRelease,
} from '../desktop/e-mate-desktop/src/profile-release.ts'

const SHA256 = /^[0-9a-f]{64}$/u
const OPAQUE_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u
const FORBIDDEN_PRIVATE_KEYS = /(?:body|content|prompt|tool_arguments|password|secret|credential|bearer|api_?key)/iu
const CONFIG_PATHS = Object.freeze({
  darwin: join(homedir(), 'Library/Application Support/e-Mate/acceptance/performance-probe.json'),
  win32: 'C:\\ProgramData\\e-Mate\\acceptance\\performance-probe.json',
})
const DATASET_CONTRACT = Object.freeze({
  version: 1,
  cases: Object.freeze([
    Object.freeze({ id: 'short-text-v1', scenario: 'short-text', history_turns: 0, read_only_tool_calls: 0 }),
    Object.freeze({ id: 'history-20-v1', scenario: 'history-20', history_turns: 20, read_only_tool_calls: 0 }),
    Object.freeze({ id: 'read-only-tool-v1', scenario: 'read-only-tool', history_turns: 0, read_only_tool_calls: 1 }),
  ]),
})
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
})
const BASELINE_SOURCE_COMMIT = '9fbc70ad56c4f263dfa0aa0085f19eded134e32d'
const BASELINE_BASE_CONTRACT = 'e-mate-desktop-profile-v6-dsh-2bc16230975f'
const BASELINE_BASE_CONTRACT_BYTES = 1_598
const BASELINE_BASE_CONTRACT_SHA256 = '964a26f282345a46cd919e0dd3fe1caf9270d4cf732b2c2ab81b1dc168a6a990'
const BASELINE_HARNESS_COMMIT = '2bc16230975f6cf02aa1b283b1f86de44007b059'
const CANDIDATE_BASE_CONTRACT = 'e-mate-desktop-profile-v7-dsh-b2b1650b01f0'
const MACOS_BUNDLE_ID = 'net.ecoremedia.e-mate'
const PROFILE_STATE_KEYS = Object.freeze(['active', 'last_known_good', 'schema_version'])
const LOOPBACK_ORIGIN = 'http://127.0.0.1:3080'
const BROKER_ACTIONS = new Set(['usage-snapshot', 'auth-available', 'auth-unavailable', 'status'])
const MAX_BROKER_BYTES = 1024 * 1024
const MAX_PRIVATE_LOG_BYTES = 64 * 1024
const PATHS = Object.freeze(['baseline', 'emate_online', 'emate_enterprise_unavailable_valid_cache'])
const PROMPTS = Object.freeze({
  seed: index => `Context warmup ${String(index)}. Reply with exactly OK.`,
  'short-text': 'Reply with exactly OK.',
  'history-20': 'Reply with exactly OK.',
  'read-only-tool': 'First reply checking. Then call get_goal exactly once. Finally reply done.',
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

export function domainHash(runId, domain, rawId) {
  if (typeof runId !== 'string' || runId.length < 16 || typeof domain !== 'string' || domain.length === 0
    || typeof rawId !== 'string' || rawId.length === 0) {
    throw new Error('opaque identifiers require one run scope, hash domain, and value')
  }
  return createHash('sha256').update(`e-mate-performance-v1\0${runId}\0${domain}\0${rawId}`).digest('hex')
}

export function assertNoPrivatePayload(value, path = 'root') {
  if (value === null || typeof value !== 'object') return
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_PRIVATE_KEYS.test(key)) throw new Error(`${path}.${key} is not allowed in performance evidence`)
    assertNoPrivatePayload(child, `${path}.${key}`)
  }
}

export async function loadRunnerPrivateConfig(path = CONFIG_PATHS[process.platform]) {
  if (path === undefined || !isAbsolute(path)) throw new Error('runner-private config must use its protected absolute path')
  const resolved = resolve(path)
  const info = await lstat(resolved)
  if (process.platform === 'win32') throw new Error('runner-private config requires an approved Windows ACL verifier')
  if (!info.isFile() || info.isSymbolicLink() || await realpath(resolved) !== resolved
    || (process.platform !== 'win32' && (info.mode & 0o077) !== 0)) {
    throw new Error('runner-private config must be canonical, regular, and owner-only')
  }
  let config
  try {
    config = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readFile(resolved)))
  } catch {
    throw new Error('runner-private config must be valid UTF-8 JSON')
  }
  assertNoPrivatePayload(config, 'config')
  const keys = Object.keys(config).sort().join('\0')
  if (keys !== ['acceptance_identity', 'admin_usage_exporter', 'installation_root', 'max_parallel_runs', 'offline_control', 'runner_scope', 'schema_version'].sort().join('\0')
    || config.schema_version !== 1 || config.runner_scope !== 'dedicated-performance-runner'
    || config.max_parallel_runs !== 1
    || config.acceptance_identity?.authority !== 'os-keychain'
    || !OPAQUE_REFERENCE.test(config.acceptance_identity?.reference ?? '')
    || config.admin_usage_exporter?.authority !== 'local-secret-broker'
    || !OPAQUE_REFERENCE.test(config.admin_usage_exporter?.reference ?? '')
    || !isAbsolute(config.installation_root ?? '')
    || config.offline_control?.authority !== 'local-firewall-broker'
    || !OPAQUE_REFERENCE.test(config.offline_control?.reference ?? '')) {
    throw new Error('runner-private config does not name the closed identity and exporter authorities')
  }
  const installationRoot = resolve(config.installation_root)
  const installationInfo = await lstat(installationRoot)
  if (!installationInfo.isDirectory() || installationInfo.isSymbolicLink()
    || await realpath(installationRoot) !== installationRoot
    || (process.platform !== 'win32' && (installationInfo.mode & 0o077) !== 0)) {
    throw new Error('performance installation root must be canonical and owner-only')
  }
  await Promise.all([
    resolveRunnerBroker(path, config.admin_usage_exporter.reference),
    resolveRunnerBroker(path, config.offline_control.reference),
  ])
  return config
}

export async function resolveRunnerBroker(configPath, reference) {
  if (!isAbsolute(configPath) || !OPAQUE_REFERENCE.test(reference ?? '')) {
    throw new Error('runner broker requires the protected config path and one opaque reference')
  }
  const configInfo = await lstat(configPath)
  const path = resolve(dirname(configPath), 'brokers', reference)
  const info = await lstat(path)
  if (!info.isFile() || info.isSymbolicLink() || await realpath(path) !== path
    || info.uid !== configInfo.uid || (info.mode & 0o777) !== 0o700) {
    throw new Error('runner broker must be one canonical owner-matched 0700 executable')
  }
  return path
}

async function resolveAcceptancePreload(configPath, path) {
  if (typeof path !== 'string' || !isAbsolute(path)) throw new Error('offline-control status returned no absolute preload path')
  const [configInfo, info] = await Promise.all([lstat(configPath), lstat(path)])
  const resolved = resolve(path)
  if (!info.isFile() || info.isSymbolicLink() || await realpath(resolved) !== resolved
    || info.uid !== configInfo.uid || (info.mode & 0o077) !== 0) {
    throw new Error('acceptance-only NODE_OPTIONS preload must be canonical, owner-matched, and private')
  }
  return resolved
}

export async function runRunnerBroker(configPath, reference, action, input, options = {}) {
  if (!BROKER_ACTIONS.has(action)) throw new Error('runner broker action is outside the closed acceptance protocol')
  assertNoPrivatePayload(input, 'broker.input')
  const encoded = `${JSON.stringify(input)}\n`
  if (Buffer.byteLength(encoded) > MAX_BROKER_BYTES) throw new Error('runner broker input exceeds its closed bound')
  const executable = await resolveRunnerBroker(configPath, reference)
  return await new Promise((resolveBroker, rejectBroker) => {
    const child = spawn(executable, [action], {
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: Object.fromEntries(['HOME', 'LANG', 'LC_ALL', 'PATH']
        .filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]])),
    })
    const stdout = []
    let stdoutBytes = 0
    let settled = false
    const finish = (error, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error === undefined) resolveBroker(value)
      else rejectBroker(error)
    }
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      finish(new Error('runner broker exceeded its 60 second deadline'))
    }, options.timeout_ms ?? 60_000)
    child.stdout.on('data', chunk => {
      stdoutBytes += chunk.byteLength
      if (stdoutBytes > MAX_BROKER_BYTES) {
        child.kill('SIGKILL')
        finish(new Error('runner broker output exceeds its closed bound'))
      } else stdout.push(chunk)
    })
    child.once('error', error => finish(error))
    child.once('exit', (code, signal) => {
      if (code !== 0 || signal !== null) return finish(new Error('runner broker failed closed'))
      try {
        const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(stdout)))
        assertNoPrivatePayload(value, 'broker.output')
        finish(undefined, value)
      } catch {
        finish(new Error('runner broker returned invalid bounded UTF-8 JSON'))
      }
    })
    child.stdin.end(encoded)
  })
}

export async function acquireSingleRunLock(configPath = CONFIG_PATHS[process.platform]) {
  if (configPath === undefined || !isAbsolute(configPath)) throw new Error('single-run lock requires the protected config path')
  const path = `${configPath}.lock`
  try {
    await mkdir(path, { mode: 0o700 })
  } catch {
    throw new Error('another performance acceptance probe owns this runner')
  }
  let released = false
  return async () => {
    if (released) return
    released = true
    await rmdir(path)
  }
}

export async function releaseRuntimeLane(lane, releaseLock) {
  let cleanupFailure
  try { await lane?.cleanup() } catch (cause) { cleanupFailure = cause }
  try {
    await releaseLock()
  } catch (cause) {
    if (cleanupFailure !== undefined) {
      throw new AggregateError([cleanupFailure, cause], 'performance runtime and owner lock cleanup failed')
    }
    throw cause
  }
  if (cleanupFailure !== undefined) throw cleanupFailure
}

export async function writePrivateFailureLog(configPath, error) {
  if (configPath === undefined || !isAbsolute(configPath)) {
    throw new Error('private performance log requires the protected config path')
  }
  const configInfo = await lstat(configPath)
  const path = resolve(dirname(configPath), 'performance-probe.private.log')
  const flags = fsConstants.O_CREAT | fsConstants.O_TRUNC | fsConstants.O_WRONLY | (fsConstants.O_NOFOLLOW ?? 0)
  const handle = await open(path, flags, 0o600)
  try {
    const info = await handle.stat()
    if (!info.isFile() || info.uid !== configInfo.uid) {
      throw new Error('private performance log must be owner-matched and regular')
    }
    await handle.chmod(0o600)
    const detail = error instanceof Error ? error.stack ?? error.message : String(error)
    const entry = Buffer.from(`${new Date().toISOString()} ${detail}\n`, 'utf8')
    await handle.writeFile(entry.subarray(0, MAX_PRIVATE_LOG_BYTES))
  } finally {
    await handle.close()
  }
  return path
}

export function assertProbePlan(plan, installedSourceSha256, environment = process.env) {
  assertNoPrivatePayload(plan, 'plan')
  if (plan?.schema_version !== 1 || plan.mode !== 'production-installed-performance-acceptance'
    || plan.collector_sha256 !== installedSourceSha256
    || plan.workflow_owner?.repository !== 'zyfjacksonchen-source/e-Mate-2.0.11'
    || plan.workflow_owner?.workflow_ref !== `${plan.workflow_owner.repository}/.github/workflows/desktop-performance.yml@refs/heads/main`
    || !/^[1-9][0-9]*$/u.test(plan.workflow_owner?.run_id ?? '')
    || plan.workflow_owner?.run_attempt !== 1
    || plan.workflow_owner?.source_commit !== plan.source_commit
    || environment.GITHUB_RUN_ID !== plan.workflow_owner.run_id
    || environment.GITHUB_RUN_ATTEMPT !== '1'
    || environment.GITHUB_SHA !== plan.source_commit
    || !Array.isArray(plan.models) || plan.models.length !== 4
    || !plan.models.every(model => Array.isArray(model.schedule) && model.schedule.length === 30
      && model.expected_files?.length === 18)) {
    throw new Error('probe plan is not owned by the exact protected-main source bytes')
  }
}

export function parseMuxAssistantTextDelta(value, target) {
  if (typeof value !== 'string') throw new Error('binary frame on string-only /api/events.mux')
  let full
  try {
    full = JSON.parse(value)
  } catch {
    throw new Error('malformed JSON on /api/events.mux')
  }
  const payload = full?.payload
  if (full?.type !== 'server-request' || typeof full.rpcId !== 'string' || full.rpcId.length === 0
    || typeof payload?.type !== 'string' || full.method !== payload.type) {
    throw new Error('invalid ServerRequest envelope on /api/events.mux')
  }
  if (payload.type !== 'session/event' || payload.sessionId !== target.sessionId) return false
  const event = payload.event
  if (event?.type !== 'assistant/chunk') return false
  if (!Number.isSafeInteger(event.data?.turn) || !Number.isSafeInteger(event.data?.step)
    || event.data?.chunk?.type !== 'text-delta' || typeof event.data.chunk.text !== 'string') {
    throw new Error('invalid assistant/chunk event on /api/events.mux')
  }
  return event.data.turn === target.turn && event.data.step === target.step && event.data.chunk.text.length > 0
}

export function buildCdpPreBootstrapScript() {
  // Installed Desktop injects this with Page.addScriptToEvaluateOnNewDocument.
  // Every recorded instant therefore comes from one renderer performance.now() clock.
  const muxParser = parseMuxAssistantTextDelta.toString()
  return String.raw`(() => {
    const parseMuxAssistantTextDelta = ${muxParser};
    const state = {
      phase: 'idle', sampleKey: null, sessionId: null, turn: null, step: null, error: null,
      sendAt: null, firstChunkAt: null, firstTextAt: null, paintAt: null,
      observer: null, send: null, sendListener: null,
    };
    const fail = message => { state.error ??= message; };
    const reset = () => {
      state.observer?.disconnect();
      if (state.send !== null && state.sendListener !== null) {
        state.send.removeEventListener('click', state.sendListener, { capture: true });
      }
      Object.assign(state, {
        phase: 'idle', sampleKey: null, sessionId: null, turn: null, step: null, error: null,
        sendAt: null, firstChunkAt: null, firstTextAt: null, paintAt: null,
        observer: null, send: null, sendListener: null,
      });
    };
    const exactDom = () => {
      const scrolls = [...document.querySelectorAll('[data-conversation-scroll]')];
      const composers = [...document.querySelectorAll('[data-composer-seat] [data-composer-card]')];
      if (scrolls.length !== 1 || composers.length !== 1 || !scrolls[0].contains(composers[0])) {
        throw new Error('installed conversation DOM contract drifted');
      }
      const textareas = [...composers[0].querySelectorAll('textarea:enabled')];
      const sends = [...composers[0].querySelectorAll(':scope > div:last-child > div:last-child > button[aria-label]')];
      const visible = element => element.isConnected && getComputedStyle(element).display !== 'none'
        && getComputedStyle(element).visibility !== 'hidden' && element.getClientRects().length === 1;
      if (textareas.length !== 1 || sends.length !== 1 || !visible(textareas[0]) || !visible(sends[0])) {
        throw new Error('installed composer controls contract drifted');
      }
      return { scroll: scrolls[0], composer: composers[0], textarea: textareas[0], send: sends[0] };
    };
    const NativeWebSocket = globalThis.WebSocket;
    globalThis.WebSocket = class PerformanceWebSocket extends NativeWebSocket {
      constructor(...args) {
        super(...args);
        let mux = false;
        try { mux = new URL(String(args[0]), location.href).pathname === '/api/events.mux'; } catch {}
        if (!mux) return;
        this.addEventListener('message', event => {
          if (state.phase !== 'running' || state.sendAt === null || state.firstChunkAt !== null) return;
          try {
            if (parseMuxAssistantTextDelta(event.data, state)) state.firstChunkAt = performance.now();
          } catch (error) {
            fail(error instanceof Error ? error.message : 'invalid /api/events.mux frame');
          }
        });
      }
    };
    const beginSample = input => {
      if (state.phase !== 'idle') throw new Error('previous performance sample was not reset');
      if (typeof input?.sampleKey !== 'string' || input.sampleKey.length === 0
        || typeof input?.sessionId !== 'string' || input.sessionId.length === 0
        || !Number.isSafeInteger(input.turn) || !Number.isSafeInteger(input.step)) {
        throw new Error('performance sample requires exact sample, Session, turn, and step identities');
      }
      const { scroll, composer, textarea, send } = exactDom();
      if (textarea.value.length === 0 || send.disabled) throw new Error('performance sample composer is not ready to submit');
      Object.assign(state, {
        phase: 'running', sampleKey: input.sampleKey, sessionId: input.sessionId,
        turn: input.turn, step: input.step, send,
      });
      const hasText = node => {
        if (node.nodeType === Node.TEXT_NODE) return (node.nodeValue ?? '').trim().length > 0;
        const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          if ((node.nodeValue ?? '').trim().length > 0) return true;
        }
        return false;
      };
      const inStreamingAnswer = node => {
        const element = node instanceof Element ? node : node.parentElement;
        const stream = element?.closest('[data-chat-flow-kind="assistant-step"] [data-streaming="true"]');
        return stream !== null && stream !== undefined && !composer.contains(node);
      };
      const mark = records => {
        if (state.firstChunkAt === null || state.firstTextAt !== null) return;
        const visible = records.some(record => record.type === 'characterData'
          ? inStreamingAnswer(record.target) && (record.target.nodeValue ?? '').trim().length > 0
          : [...record.addedNodes].some(node => inStreamingAnswer(node) && hasText(node))
            || record.type === 'attributes' && inStreamingAnswer(record.target) && hasText(record.target));
        if (!visible) return;
        state.firstTextAt = performance.now();
        requestAnimationFrame(() => requestAnimationFrame(() => {
          state.paintAt = performance.now();
          state.observer?.disconnect();
        }));
      };
      const observer = new MutationObserver(mark);
      observer.observe(scroll, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['data-streaming'] });
      const sendListener = event => {
        if (!event.isTrusted || event.currentTarget !== send || textarea.value.length === 0 || state.sendAt !== null) return;
        state.sendAt = performance.now();
      };
      send.addEventListener('click', sendListener, { capture: true });
      Object.assign(state, { observer, sendListener });
    };
    const finishSample = sampleKey => {
      if (state.phase !== 'running' || sampleKey !== state.sampleKey) throw new Error('performance sample ownership drifted');
      if (state.error !== null) throw new Error(state.error);
      const values = [state.sendAt, state.firstChunkAt, state.firstTextAt, state.paintAt];
      if (values.some(value => !Number.isFinite(value))
        || state.firstChunkAt < state.sendAt || state.firstTextAt < state.firstChunkAt || state.paintAt < state.firstTextAt) {
        throw new Error('performance sample renderer milestones are incomplete or out of order');
      }
      const result = {
        submit_to_first_visible_text_ms: state.firstTextAt - state.sendAt,
        first_chunk_to_paint_ms: state.paintAt - state.firstChunkAt,
      };
      reset();
      return result;
    };
    const api = Object.freeze({
      selfTest: (requireDom = true) => ({
        transport: globalThis.WebSocket !== NativeWebSocket ? 'mux-string-server-request-v1' : null,
        dom: requireDom ? exactDom() && 'conversation-scroll/composer-seat/send-structural-v1' : 'deferred-until-owned-session',
      }),
      beginSample,
      finishSample,
      reset,
    });
    Object.defineProperty(globalThis, '__ematePerformanceProbe', { value: api, configurable: false });
  })();`
}

export function assertExactRequestCardinality(scenario, requests, toolCalls) {
  const expectedRequests = scenario === 'read-only-tool' ? 2 : 1
  const expectedTools = scenario === 'read-only-tool' ? 1 : 0
  if (!['short-text', 'history-20', 'read-only-tool'].includes(scenario)
    || requests.length !== expectedRequests || toolCalls.length !== expectedTools
    || new Set(requests).size !== requests.length || new Set(toolCalls).size !== toolCalls.length) {
    throw new Error('native Session request and Tool cardinality does not match the fixed acceptance dataset')
  }
}

export function strictJoinUsageAttempts(input) {
  if (input.account_exclusive !== true || input.max_parallel !== 1) {
    throw new Error('Usage binding requires one exclusive acceptance account and max_parallel=1')
  }
  const beforeIds = new Set()
  for (const event of input.before_events ?? []) {
    const identity = `${event.kind}:${event.eventId}`
    if (!['REQUEST', 'USAGE'].includes(event.kind) || typeof event.eventId !== 'string'
      || event.eventId.length === 0 || beforeIds.has(identity)) {
      throw new Error('usage authority before-cursor snapshot is ambiguous')
    }
    beforeIds.add(identity)
  }
  const afterIds = new Set()
  const delta = []
  for (const event of input.events) {
    const identity = `${event.kind}:${event.eventId}`
    if (!['REQUEST', 'USAGE'].includes(event.kind) || typeof event.eventId !== 'string'
      || event.eventId.length === 0 || afterIds.has(identity)) {
      throw new Error('usage authority after-cursor snapshot is ambiguous')
    }
    afterIds.add(identity)
    if (!beforeIds.has(identity)) delta.push(event)
  }
  if ([...beforeIds].some(eventId => !afterIds.has(eventId))) {
    throw new Error('usage authority cursor history changed during the sample')
  }
  if (delta.some(event => typeof event.taskId !== 'string' || event.taskId.length === 0)) {
    throw new Error('usage authority contains an event without one task identity')
  }
  const relevant = delta.filter(event => !event.taskId.startsWith('auditreceipt_')
    && !event.taskId.startsWith('harness:'))
  if (relevant.length !== input.expected_attempts * 2
    || new Set(relevant.map(event => event.userId)).size !== 1
    || relevant.some(event => typeof event.userId !== 'string' || event.userId.length === 0
      || event.modelId !== input.model || event.providerId !== input.provider
      || typeof event.traceId !== 'string' || event.traceId.length === 0
      || !Number.isFinite(Date.parse(event.occurredAt)))) {
    throw new Error('usage authority contains extra or missing events for the dedicated account')
  }
  const group = new Map()
  for (const event of relevant) {
    const key = [event.taskId, event.traceId, event.modelId, event.providerId].join('\0')
    const rows = group.get(key) ?? { requests: [], usage: [] }
    rows[event.kind === 'REQUEST' ? 'requests' : 'usage'].push(event)
    group.set(key, rows)
  }
  const pairs = []
  for (const rows of group.values()) {
    if (rows.requests.length !== 1 || rows.usage.length !== 1
      || rows.requests.some(event => event.outcome !== 'ACCOUNTED')) {
      throw new Error('usage authority has pending, rejected, or unpaired attempts')
    }
    pairs.push({ request: rows.requests[0], usage: rows.usage[0] })
  }
  pairs.sort((left, right) => Date.parse(left.request.occurredAt) - Date.parse(right.request.occurredAt)
    || left.request.eventId.localeCompare(right.request.eventId))
  if (pairs.length !== input.expected_attempts) throw new Error('usage authority attempt cardinality drifted')
  return pairs.map(({ request, usage }, index) => {
    if (request.taskId !== usage.taskId || request.traceId !== usage.traceId
      || request.modelId !== usage.modelId || request.providerId !== usage.providerId) {
      throw new Error('usage authority cannot pair REQUEST and USAGE exactly')
    }
    return {
      ordinal: index + 1,
      provider_invocation_id_sha256: domainHash(input.performance_run_id, 'provider-invocation', request.eventId),
      provider_response_id_sha256: domainHash(input.performance_run_id, 'provider-response', usage.eventId),
      usage,
    }
  })
}

export function assertOfflineValidCacheBoundary(online, offline) {
  const stable = ['lease_sha256', 'model_policy_sha256']
  const times = [offline.finished_at, offline.lease_expires_at, offline.policy_expires_at].map(Date.parse)
  if (online.endpoint !== 'available' || offline.endpoint !== 'unavailable'
    || offline.inference_gateway !== 'available'
    || stable.some(key => !SHA256.test(online[key]) || online[key] !== offline[key])
    || online.lease_refreshed_at !== offline.lease_refreshed_at
    || online.policy_refreshed_at !== offline.policy_refreshed_at
    || times.some(value => !Number.isFinite(value))
    || times[0] >= times[1] || times[0] >= times[2]
    || !SHA256.test(online.audit_status_sha256)
    || !SHA256.test(offline.audit_status_sha256)) {
    throw new Error('offline path did not isolate only the auth and policy control plane inside valid cache windows')
  }
  return {
    endpoint: offline.endpoint,
    inference_gateway: offline.inference_gateway,
    lease_sha256: offline.lease_sha256,
    model_policy_sha256: offline.model_policy_sha256,
    audit_status_sha256: offline.audit_status_sha256,
    lease_refreshed_at: offline.lease_refreshed_at,
    policy_refreshed_at: offline.policy_refreshed_at,
    lease_expires_at: offline.lease_expires_at,
    policy_expires_at: offline.policy_expires_at,
    finished_at: offline.finished_at,
  }
}

export function nativeAuditStatusSha256(value) {
  const keys = [
    'blocked', 'delivered', 'delivered_tokens', 'pending', 'pending_tokens',
    'schema_version', 'task_events_delivered', 'task_events_pending',
  ]
  if (value === null || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join('\0') !== keys.sort().join('\0')
    || value.schema_version !== 1
    || keys.filter(key => key !== 'schema_version')
      .some(key => !Number.isSafeInteger(value[key]) || value[key] < 0)) {
    throw new Error('native audit.status returned an invalid closed status')
  }
  return sha256(canonical(value))
}

function one(rows, label) {
  if (rows.length !== 1) throw new Error(`${label} must have exact cardinality one`)
  return rows[0]
}

function eventTime(event, label) {
  if (!Number.isSafeInteger(event?.seq) || !Number.isFinite(event?.time)) {
    throw new Error(`${label} must use native Session seq and time`)
  }
  return event.time
}

export function deriveAuthoritySample(input) {
  const events = input.events
  if (!Number.isSafeInteger(input.path_execution_ordinal) || input.path_execution_ordinal < 1
    || input.path_execution_ordinal > 30 || !Array.isArray(events) || events.length === 0
    || events.some((event, index) => eventTime(event, 'Session event') < 0
      || (index > 0 && event.seq <= events[index - 1].seq))) {
    throw new Error('native Session history must be complete and strictly ordered')
  }
  const expectedAttempts = input.scenario === 'read-only-tool' ? 2 : 1
  assertExactRequestCardinality(
    input.scenario,
    input.request_attempts.map(attempt => attempt.request_id),
    events.filter(event => event.type === 'tool/call').map(event => event.data?.callId),
  )
  if (input.request_attempts.length !== expectedAttempts
    || input.request_attempts.some((attempt, index) => attempt.ordinal !== index + 1
      || attempt.turn !== input.turn || !Number.isSafeInteger(attempt.step) || attempt.step <= 0
      || attempt.effective_header === null || typeof attempt.effective_header !== 'object'
      || Array.isArray(attempt.effective_header))) {
    throw new Error('request attempts must carry the exact folded native header in request order')
  }

  const user = one(events.filter(event => event.type === 'user/message'
    && event.data?.id === input.message_id), 'owned user/message')
  const inbox = one(events.filter(event => event.type === 'agent/inbox/spliced'
    && event.data?.inserted?.some(message => message?.id === input.message_id)), 'owned inbox splice')
  const turnStart = one(events.filter(event => event.type === 'turn/start'
    && event.data?.turn === input.turn), 'owned turn/start')
  const chunks = events.filter(event => event.type === 'assistant/chunk'
    && event.data?.turn === input.turn && event.data?.step === input.step
    && event.data?.chunk?.type === 'text-delta' && typeof event.data.chunk.text === 'string'
    && event.data.chunk.text.length > 0)
  if (chunks.length === 0) throw new Error('owned Session has no non-empty assistant text delta')
  const firstChunk = chunks[0]
  const assistant = one(events.filter(event => event.type === 'assistant/message'
    && event.data?.turn === input.turn && event.data?.step === input.step), 'owned assistant/message')
  const outputTokens = assistant.data?.usage?.outputTokens
  const decodeMs = eventTime(assistant, 'assistant/message') - eventTime(firstChunk, 'assistant/chunk')
  if (!Number.isSafeInteger(outputTokens) || outputTokens <= 0 || decodeMs <= 0
    || eventTime(firstChunk, 'assistant/chunk') < eventTime(user, 'user/message')
    || eventTime(turnStart, 'turn/start') < eventTime(inbox, 'agent/inbox/spliced')) {
    throw new Error('native Session timing or usage order is invalid')
  }

  const toolCalls = events.filter(event => event.type === 'tool/call')
  const toolResults = events.filter(event => event.type === 'tool/result')
  let toolTiming = {}
  if (input.scenario === 'read-only-tool') {
    const call = one(toolCalls, 'read-only Tool call')
    const result = one(toolResults.filter(event => event.data?.callId === call.data?.callId), 'read-only Tool result')
    const nextStep = one(events.filter(event => event.type === 'step/start'
      && event.data?.turn === input.turn && event.data?.step > result.data?.step), 'post-Tool request step')
    const delta = eventTime(nextStep, 'post-Tool step/start') - eventTime(result, 'tool/result')
    if (result.data?.isError !== false || delta < 0) throw new Error('read-only Tool did not complete before the next request')
    toolTiming = { tool_result_to_next_request_ms: delta }
  } else if (toolCalls.length !== 0 || toolResults.length !== 0) {
    throw new Error('non-Tool dataset unexpectedly executed a Tool')
  }
  if (input.job_execution_count !== 0 || input.deliverable_count !== 0) {
    throw new Error('fixed acceptance sample unexpectedly produced a Job or Deliverable')
  }

  const joined = strictJoinUsageAttempts({
    model: input.model,
    provider: input.provider,
    performance_run_id: input.performance_run_id,
    account_exclusive: input.account_exclusive,
    max_parallel: input.max_parallel,
    expected_attempts: expectedAttempts,
    before_events: input.usage_before_events,
    events: input.usage_after_events,
  })
  const requests = input.request_attempts.map(attempt => {
    const encoded = canonical(attempt.effective_header)
    const tools = attempt.effective_header.tools
    if (tools !== undefined && !Array.isArray(tools)) throw new Error('folded request header tools must be an array')
    return {
      ordinal: attempt.ordinal,
      request_id_sha256: domainHash(
        input.performance_run_id, 'native-request',
        `${input.session_id}\0${String(attempt.turn)}\0${String(attempt.step)}`,
      ),
      request_header_sha256: sha256(encoded),
      request_header_bytes: Buffer.byteLength(encoded),
      request_tool_count: tools?.length ?? 0,
      ...(input.path_name === 'baseline' ? {} : { diagnostic: attempt.diagnostic ?? null }),
    }
  })
  const providerAttempts = joined.map(attempt => {
    const inputTokens = Number(attempt.usage?.inputTokens)
    const providerOutputTokens = Number(attempt.usage?.outputTokens)
    if (!Number.isSafeInteger(inputTokens) || inputTokens < 0
      || !Number.isSafeInteger(providerOutputTokens) || providerOutputTokens <= 0) {
      throw new Error('managed Usage event has invalid token counts')
    }
    return {
      ordinal: attempt.ordinal,
      request_id_sha256: requests[attempt.ordinal - 1].request_id_sha256,
      provider_invocation_id_sha256: attempt.provider_invocation_id_sha256,
      provider_response_id_sha256: attempt.provider_response_id_sha256,
      provider_usage_sha256: sha256(canonical(attempt.usage)),
      input_tokens: inputTokens,
      output_tokens: providerOutputTokens,
    }
  })
  const paint = input.paint
  if (![paint?.submit_to_first_visible_text_ms, paint?.first_chunk_to_paint_ms]
    .every(value => Number.isFinite(value) && value >= 0)) {
    throw new Error('renderer paint sample is incomplete')
  }
  return {
    native: {
      pair_id: input.pair_id,
      scenario: input.scenario,
      arm_order: input.arm_order,
      path_execution_ordinal: input.path_execution_ordinal,
      session_id_sha256: domainHash(input.performance_run_id, 'session', input.session_id),
      turn: input.turn,
      step: input.step,
      user_message_to_first_text_delta_ms: eventTime(firstChunk, 'assistant/chunk') - eventTime(user, 'user/message'),
      output_tokens_per_second: outputTokens * 1_000 / decodeMs,
      queue_wait_ms: eventTime(turnStart, 'turn/start') - eventTime(inbox, 'agent/inbox/spliced'),
      duplicate_model_request_count: 0,
      duplicate_tool_execution_count: 0,
      duplicate_job_execution_count: 0,
      duplicate_deliverable_count: 0,
      ...toolTiming,
    },
    headers: { pair_id: input.pair_id, requests },
    provider: { pair_id: input.pair_id, provider_attempts: providerAttempts },
    paint: { pair_id: input.pair_id, ...paint },
  }
}

function command(executable, args, options = {}) {
  return new Promise((resolveCommand, rejectCommand) => {
    const child = spawn(executable, args, {
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      ...options,
    })
    const stdout = []
    const stderr = []
    child.stdout?.on('data', chunk => stdout.push(chunk))
    child.stderr?.on('data', chunk => stderr.push(chunk))
    child.once('error', rejectCommand)
    child.once('exit', (code, signal) => code === 0 && signal === null
      ? resolveCommand(Buffer.concat(stdout).toString('utf8'))
      : rejectCommand(new Error(`${basename(executable)} failed (${String(code ?? signal)}): ${Buffer.concat(stderr).toString('utf8').trim()}`)))
  })
}

async function regularFileIdentity(path, label) {
  const resolved = resolve(path)
  const info = await lstat(resolved)
  if (!info.isFile() || info.isSymbolicLink() || await realpath(resolved) !== resolved || info.size <= 0) {
    throw new Error(`${label} must be a canonical regular file`)
  }
  return { path: resolved, bytes: info.size, sha256: await fileSha256(resolved) }
}

async function readClosedJson(path, label) {
  const identity = await regularFileIdentity(path, label)
  if (identity.bytes > 1024 * 1024) throw new Error(`${label} exceeds its closed size bound`)
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readFile(identity.path)))
  } catch {
    throw new Error(`${label} must be valid UTF-8 JSON`)
  }
}

function exactKeys(value, expected) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join('\0') === [...expected].sort().join('\0')
}

async function assertClosedTree(root, label) {
  const canonicalRoot = resolve(root)
  const rootInfo = await lstat(canonicalRoot)
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink() || await realpath(canonicalRoot) !== canonicalRoot) {
    throw new Error(`${label} must be one canonical real directory`)
  }
  const walk = async directory => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      const info = await lstat(path)
      const child = relative(canonicalRoot, path)
      if (child === '' || child.startsWith(`..${sep}`) || child === '..' || isAbsolute(child)
        || info.isSymbolicLink()) throw new Error(`${label} contains a symlink or escaping path`)
      if (info.isDirectory()) await walk(path)
      else if (!info.isFile()) throw new Error(`${label} contains a special filesystem entry`)
    }
  }
  await walk(canonicalRoot)
  return canonicalRoot
}

async function strictProfileState(path, expectedGeneration, label) {
  const value = await readClosedJson(path, label)
  if (!exactKeys(value, PROFILE_STATE_KEYS) || value.schema_version !== 1
    || value.active !== expectedGeneration || value.last_known_good !== expectedGeneration
    || value.active === 'bundled') {
    throw new Error(`${label} is not armed to the exact accepted Profile generation`)
  }
  return value
}

async function profileInventoryIds(path, label) {
  const value = await readClosedJson(path, label)
  if (!exactKeys(value, ['schema_version', 'components']) || value.schema_version !== 1
    || !Array.isArray(value.components) || value.components.length === 0) {
    throw new Error(`${label} is invalid`)
  }
  const ids = value.components
    .filter(item => item?.desktop !== 'blocked')
    .map(item => item?.id)
    .sort()
  if (ids.some(id => typeof id !== 'string' || id.length === 0) || new Set(ids).size !== ids.length) {
    throw new Error(`${label} has an invalid component identity`)
  }
  return ids
}

/** Load only the exact pre-floor v6 contract as an in-memory legacy floor-0 view. */
export async function loadFrozenBaselineBaseContract(path) {
  const identity = await regularFileIdentity(path, 'frozen 2.0.12 Desktop Base contract')
  const value = await readClosedJson(identity.path, 'frozen 2.0.12 Desktop Base contract')
  if (identity.bytes !== BASELINE_BASE_CONTRACT_BYTES || identity.sha256 !== BASELINE_BASE_CONTRACT_SHA256
    || !exactKeys(value, [
      'schema_version', 'id', 'desktop_api', 'profile_format', 'desktop_reference',
      'harness_version', 'harness_commit', 'runtime_imports', 'profile_signing_keys',
    ]) || value.id !== BASELINE_BASE_CONTRACT || value.harness_version !== '0.1.0-rc.7'
    || value.harness_commit !== BASELINE_HARNESS_COMMIT
    || value.desktop_reference?.commit !== '6074088f5b660206e404b3591fab51fb99c69add') {
    throw new Error('frozen 2.0.12 Desktop Base contract identity drifted')
  }
  const validated = parseProfileBaseContract({ ...value, schedule_protocol_floor: 1 })
  if (validated === undefined) throw new Error('frozen 2.0.12 Desktop Base contract is invalid')
  return { ...validated, schedule_protocol_floor: 0 }
}

function darwinProfileTarget(target) {
  return { platform: 'darwin', arch: target === 'darwin-arm64' ? 'arm64' : 'x64' }
}

function containedPath(root, path, label) {
  const resolved = resolve(root, ...path.split('/'))
  const child = relative(root, resolved)
  if (child === '..' || child.startsWith(`..${sep}`) || isAbsolute(child)) {
    throw new Error(`${label} escaped its downloaded bundle`)
  }
  return resolved
}

async function writeExactProfileState(directory, generation) {
  await mkdir(directory, { recursive: true, mode: 0o700 })
  await writeFile(join(directory, 'state.json'), `${JSON.stringify({
    schema_version: 1,
    active: generation,
    last_known_good: generation,
  }, null, 2)}\n`, { mode: 0o600, flag: 'wx' })
}

/** Copy only a natively verified generation and its referenced component closure. */
export async function installVerifiedProfileTemplate(options) {
  const source = resolve(options.source)
  const destination = resolve(options.destination)
  await strictProfileState(join(source, 'state.json'), options.generation, 'preinstalled Profile state')
  const sourceStore = await assertClosedTree(join(source, 'store'), 'preinstalled Profile store')
  const verified = await (options.load ?? loadProfileGeneration)({
    root: sourceStore,
    id: options.generation,
    base: options.base,
    expected_component_ids: options.expected_component_ids,
    target: options.target,
  })
  if (verified.id !== options.generation) throw new Error('preinstalled Profile generation identity drifted')
  await mkdir(join(destination, 'store/generations'), { recursive: true, mode: 0o700 })
  await mkdir(join(destination, 'store/components'), { recursive: true, mode: 0o700 })
  const generationSource = join(sourceStore, 'generations', options.generation)
  const generationEntries = await readdir(generationSource)
  if (generationEntries.length !== 1 || generationEntries[0] !== 'release.json') {
    throw new Error('preinstalled Profile generation directory is not exact')
  }
  await cp(generationSource, join(destination, 'store/generations', options.generation), {
    recursive: true, force: false, errorOnExist: true,
  })
  for (const reference of verified.release.payload.components) {
    await cp(
      join(sourceStore, 'components', reference.manifest_sha256),
      join(destination, 'store/components', reference.manifest_sha256),
      { recursive: true, force: false, errorOnExist: true },
    )
  }
  await writeExactProfileState(destination, options.generation)
  await assertClosedTree(destination, 'isolated Profile template')
  await (options.load ?? loadProfileGeneration)({
    root: join(destination, 'store'),
    id: options.generation,
    base: options.base,
    expected_component_ids: options.expected_component_ids,
    target: options.target,
  })
  return { root: destination, generation: options.generation, base: options.base,
    expected_component_ids: options.expected_component_ids, target: options.target }
}

async function publicationObjects(publicationRoot, plan) {
  const objects = new Map()
  for (const item of plan.immutable_objects ?? []) {
    if (typeof item?.url !== 'string' || typeof item?.path !== 'string'
      || !Number.isSafeInteger(item.bytes) || item.bytes <= 0 || !SHA256.test(item.sha256 ?? '')
      || objects.has(item.url)) throw new Error('Profile publication object contract is invalid')
    const path = containedPath(publicationRoot, item.path, 'Profile publication object')
    const identity = await regularFileIdentity(path, 'Profile publication object')
    if (identity.bytes !== item.bytes || identity.sha256 !== item.sha256) {
      throw new Error('Profile publication object bytes drifted')
    }
    objects.set(item.url, identity.path)
  }
  return objects
}

async function prepareCandidateProfileTemplate(plan, target, destination) {
  const publicationRoot = await assertClosedTree(
    resolve(plan.profile_authority.publication_root),
    'downloaded Profile publication bundle',
  )
  const publication = await readClosedJson(join(publicationRoot, 'publication-plan.json'), 'Profile publication plan')
  const basePath = resolve('desktop/e-mate-desktop/base-contract.json')
  await regularFileIdentity(basePath, 'candidate Desktop Base contract')
  const base = loadProfileBaseContract(basePath)
  const expectedIds = await profileInventoryIds(
    resolve('packages/dsh/profile/component-inventory.json'),
    'candidate Profile component inventory',
  )
  const authority = plan.profile_authority.receipt.targets.find(item => item.target === target)
  const activation = publication.activations?.find(item => item?.target === target)
  if (publication.document_type !== 'emate.profile-native-cloudflare-publication-plan'
    || publication.status !== 'prepared' || publication.source_commit !== plan.source_commit
    || publication.main_commit !== plan.source_commit || publication.base_contract_id !== base.id
    || base.id !== CANDIDATE_BASE_CONTRACT || activation?.generation !== authority?.profile_generation
    || activation?.sequence !== 1 || activation?.object?.role !== 'desired-state-active'
    || canonical(activation?.changed_components) !== canonical(expectedIds)
    || !exactKeys(activation?.object, ['bytes', 'cache_control', 'content_type', 'key', 'path', 'role', 'sha256', 'url'])) {
    throw new Error('candidate Profile publication does not match its accepted authority')
  }
  const activePath = containedPath(publicationRoot, activation.object.path, 'candidate active Profile release')
  const activeIdentity = await regularFileIdentity(activePath, 'candidate active Profile release')
  if (activeIdentity.bytes !== activation.object.bytes || activeIdentity.sha256 !== activation.object.sha256) {
    throw new Error('candidate active Profile release bytes drifted')
  }
  let envelope
  try { envelope = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readFile(activePath))) } catch {
    throw new Error('candidate active Profile release is invalid')
  }
  const release = verifyProfileRelease(envelope, base)
  if (release === undefined || release.payload.source_commit !== plan.source_commit) {
    throw new Error('candidate active Profile release signature is invalid')
  }
  const objects = await publicationObjects(publicationRoot, publication)
  const request = async (url, init) => {
    if (init.method !== 'GET' || init.redirect !== 'error' || init.cache !== 'no-store') {
      throw new Error('offline Profile materialization received an unexpected request')
    }
    const path = objects.get(url)
    if (path === undefined) throw new Error('offline Profile publication is missing one referenced object')
    const bytes = await readFile(path)
    return new Response(bytes, { status: 200, headers: { 'content-length': String(bytes.byteLength) } })
  }
  await mkdir(join(destination, 'store'), { recursive: true, mode: 0o700 })
  const verified = await assembleProfileGeneration({
    root: join(destination, 'store'), release, base,
    expected_component_ids: expectedIds,
    target: darwinProfileTarget(target), request,
  })
  if (verified.id !== authority.profile_generation) throw new Error('materialized candidate Profile generation drifted')
  await writeExactProfileState(destination, verified.id)
  await assertClosedTree(destination, 'candidate isolated Profile template')
  return { root: destination, generation: verified.id, base,
    expected_component_ids: expectedIds, target: darwinProfileTarget(target) }
}

export async function verifyRuntimeProfileBinding(selected, userData, home, load = loadProfileGeneration) {
  const profileRoot = join(userData, 'profile-generations')
  await strictProfileState(join(profileRoot, 'state.json'), selected.profile.generation, 'running Profile state')
  await assertClosedTree(profileRoot, 'running Profile generation store')
  await load({
    root: join(profileRoot, 'store'), id: selected.profile.generation,
    base: selected.profile.base, expected_component_ids: selected.profile.expected_component_ids,
    target: selected.profile.target,
  })
  const receipt = await readClosedJson(join(home, 'profiles/e-mate/.e-mate-install.json'), 'running DSH Profile receipt')
  if (!exactKeys(receipt, [
    'schema_version', 'version', 'harness_commit', 'dsh_home', 'source_root',
    'profile_generation', 'managed_package_layout',
  ]) || receipt.schema_version !== 2 || receipt.dsh_home !== resolve(home)
    || receipt.profile_generation !== selected.profile.generation
    || receipt.harness_commit !== selected.profile.base.harness_commit
    || typeof receipt.source_root !== 'string' || !isAbsolute(receipt.source_root)) {
    throw new Error('running DSH Profile receipt does not match the accepted generation')
  }
}

function targetForDarwin(machineArch = arch()) {
  if (machineArch === 'arm64') return 'darwin-arm64'
  if (machineArch === 'x64') return 'darwin-x64'
  throw new Error(`unsupported macOS performance architecture ${machineArch}`)
}

async function verifyDarwinApp(appPath, target, run = command) {
  const resolved = resolve(appPath)
  const info = await lstat(resolved)
  if (!info.isDirectory() || info.isSymbolicLink() || await realpath(resolved) !== resolved) {
    throw new Error('performance application must be one canonical app bundle')
  }
  const executable = await regularFileIdentity(join(resolved, 'Contents/MacOS/e-Mate'), 'installed e-Mate executable')
  const plist = join(resolved, 'Contents/Info.plist')
  await run('/usr/bin/plutil', ['-lint', plist])
  const bundleId = (await run('/usr/bin/plutil', ['-extract', 'CFBundleIdentifier', 'raw', '-o', '-', plist])).trim()
  if (bundleId !== MACOS_BUNDLE_ID) throw new Error('installed e-Mate has the wrong application bundle identifier')
  await run('/usr/bin/lipo', [executable.path, '-verify_arch', target === 'darwin-arm64' ? 'arm64' : 'x86_64'])
  await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', resolved])
  return { app_path: resolved, executable, bundle_id: bundleId }
}

function assertInstalledReceipt(receipt, expected, application, target) {
  if (receipt?.kind !== 'installed-runtime-receipt'
    || receipt.runtime?.product !== 'e-mate-desktop'
    || receipt.runtime?.product_version !== expected.version
    || receipt.runtime?.source_commit !== expected.source_commit
    || receipt.runtime?.base_contract_id !== expected.base_contract_id
    || receipt.runtime?.profile_generation !== expected.profile_generation
    || receipt.runtime?.desktop_artifact_sha256 !== expected.sha256
    || receipt.runtime?.desktop_artifact_bytes !== expected.bytes
    || receipt.install_receipt?.installation_kind !== 'installed-application'
    || receipt.install_receipt?.target !== target
    || receipt.install_receipt?.bundle_id !== application.bundle_id
    || receipt.install_receipt?.package_sha256 !== expected.sha256
    || receipt.install_receipt?.package_bytes !== expected.bytes
    || receipt.install_receipt?.installed_executable_sha256 !== application.executable.sha256
    || receipt.install_receipt?.installed_executable_bytes !== application.executable.bytes) {
    throw new Error('installed runtime receipt does not match the exact application bytes')
  }
  return receipt
}

async function detachDarwinVolume(mountPoint, run) {
  let failure
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await run('/usr/bin/hdiutil', ['detach', mountPoint])
      return
    } catch (cause) {
      failure = cause
      await delay(250)
    }
  }
  try {
    await run('/usr/bin/hdiutil', ['detach', mountPoint, '-force'])
  } catch (cause) {
    throw new AggregateError([failure, cause], 'failed to detach candidate DMG')
  }
}

export async function prepareDarwinRuntimeLane(plan, config, options = {}) {
  const platform = options.platform ?? process.platform
  const machineArch = options.arch ?? arch()
  const run = options.run ?? command
  if (platform !== 'darwin') throw new Error('the checked-in performance workflow currently owns only a macOS runtime lane')
  const target = targetForDarwin(machineArch)
  const predecessor = BASELINE_INSTALLS[target]
  const profile = plan.profile_authority?.receipt?.targets?.find(item => item.target === target)
  if (predecessor === undefined || profile === undefined
    || ![profile.profile_generation, profile.composition_sha256, profile.client_bundle_sha256].every(value => SHA256.test(value ?? ''))) {
    throw new Error('performance plan has no exact Profile authority for this macOS target')
  }
  const root = await realpath(resolve(config.installation_root))
  const work = await mkdtemp(join(root, 'run-'))
  const mountPoint = join(work, 'mount')
  const candidateRoot = join(work, 'candidate')
  await Promise.all([mkdir(mountPoint, { mode: 0o700 }), mkdir(candidateRoot, { mode: 0o700 })])
  let mounted = false
  try {
    const baselineApp = await verifyDarwinApp(join(root, 'baseline/e-Mate.app'), target, run)
    const baselineReceipt = assertInstalledReceipt(
      await readClosedJson(join(root, 'baseline/installed-runtime.json'), 'frozen 2.0.12 installed receipt'),
      {
        version: '2.0.12', source_commit: BASELINE_SOURCE_COMMIT, base_contract_id: BASELINE_BASE_CONTRACT,
        profile_generation: predecessor.profile_generation, sha256: predecessor.sha256, bytes: predecessor.bytes,
      },
      baselineApp,
      target,
    )
    const profileTemplates = options.prepareProfiles === undefined
      ? await (async () => {
          const baselineBasePath = join(root, 'baseline/base-contract.json')
          const baselineBase = await loadFrozenBaselineBaseContract(baselineBasePath)
          const baselineIds = await profileInventoryIds(
            join(root, 'baseline/component-inventory.json'),
            'frozen 2.0.12 Profile component inventory',
          )
          return {
            baseline: await installVerifiedProfileTemplate({
              source: join(root, 'baseline/profile-generations'),
              destination: join(work, 'profile-templates/baseline/profile-generations'),
              generation: predecessor.profile_generation,
              base: baselineBase,
              expected_component_ids: baselineIds,
              target: darwinProfileTarget(target),
            }),
            candidate: await prepareCandidateProfileTemplate(
              plan,
              target,
              join(work, 'profile-templates/candidate/profile-generations'),
            ),
          }
        })()
      : await options.prepareProfiles({ root, work, target, predecessor, plan })
    if (profileTemplates?.baseline?.generation !== predecessor.profile_generation
      || profileTemplates?.candidate?.generation !== profile.profile_generation) {
      throw new Error('installed Profile templates do not match the frozen runtime receipts')
    }

    const candidateManifest = await readClosedJson(
      join(plan.candidate_artifacts_root, 'desktop-candidate.json'),
      'Desktop candidate manifest',
    )
    const artifact = candidateManifest?.artifacts?.darwin
    if (candidateManifest?.source_commit !== plan.source_commit
      || typeof candidateManifest.version !== 'string' || !/^\d+\.\d+\.\d+$/u.test(candidateManifest.version)
      || artifact?.build_source_commit !== plan.source_commit || !SHA256.test(artifact?.sha256 ?? '')
      || !Number.isSafeInteger(artifact?.bytes) || artifact.bytes <= 0) {
      throw new Error('Desktop candidate manifest does not match the protected plan')
    }
    const dmg = await regularFileIdentity(
      join(plan.candidate_artifacts_root, `e-Mate-${candidateManifest.version}-mac-universal.dmg`),
      'candidate DMG',
    )
    if (dmg.sha256 !== artifact.sha256 || dmg.bytes !== artifact.bytes) {
      throw new Error('candidate DMG bytes do not match desktop-candidate.json')
    }
    await run('/usr/bin/hdiutil', ['verify', dmg.path])
    await run('/usr/bin/hdiutil', ['attach', dmg.path, '-mountpoint', mountPoint, '-nobrowse', '-readonly'])
    mounted = true
    const apps = (await readdir(mountPoint, { withFileTypes: true }))
      .filter(entry => entry.isDirectory() && entry.name.endsWith('.app'))
    if (apps.length !== 1) throw new Error('candidate DMG must contain exactly one application bundle')
    const candidateAppPath = join(candidateRoot, 'e-Mate.app')
    await run('/usr/bin/ditto', [join(mountPoint, apps[0].name), candidateAppPath])
    await detachDarwinVolume(mountPoint, run)
    mounted = false
    const candidateApp = await verifyDarwinApp(candidateAppPath, target, run)
    const installedAt = new Date().toISOString()
    const runtime = {
      product: 'e-mate-desktop', product_version: candidateManifest.version,
      source_commit: plan.source_commit,
      desktop_reference_commit: '6074088f5b660206e404b3591fab51fb99c69add',
      base_contract_id: CANDIDATE_BASE_CONTRACT,
      profile_generation: profile.profile_generation,
      composition_sha256: profile.composition_sha256,
      client_bundle_sha256: profile.client_bundle_sha256,
      desktop_artifact_sha256: artifact.sha256,
      desktop_artifact_bytes: artifact.bytes,
    }
    const candidateReceipt = {
      kind: 'installed-runtime-receipt', runtime,
      install_receipt: {
        installation_kind: 'installed-application', target, bundle_id: candidateApp.bundle_id,
        package_sha256: artifact.sha256, package_bytes: artifact.bytes,
        installed_executable_sha256: candidateApp.executable.sha256,
        installed_executable_bytes: candidateApp.executable.bytes,
        installed_at: installedAt,
      },
    }
    return {
      target,
      work,
      launch_sequence: 0,
      baseline: { ...baselineApp, receipt: baselineReceipt, profile: profileTemplates.baseline },
      candidate: { ...candidateApp, receipt: candidateReceipt, profile: profileTemplates.candidate },
      cleanup: async () => { await rm(work, { recursive: true, force: true }) },
    }
  } catch (cause) {
    const failures = [cause]
    if (mounted) {
      try { await detachDarwinVolume(mountPoint, run) } catch (cleanupCause) { failures.push(cleanupCause) }
    }
    try { await rm(work, { recursive: true, force: true }) } catch (cleanupCause) { failures.push(cleanupCause) }
    throw failures.length === 1 ? cause : new AggregateError(failures, 'macOS runtime lane failed and cleanup was incomplete')
  }
}

async function waitForLoopback(child) {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    if (child.exitCode !== null || child.signalCode !== null) throw new Error('installed e-Mate exited before loopback became ready')
    try {
      const response = await fetch(`${LOOPBACK_ORIGIN}/api/host.describe`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'client-request', rpcId: 'performance-preflight', method: 'host.describe', payload: {} }),
      })
      if (response.ok) return
    } catch {}
    await delay(100)
  }
  throw new Error('installed e-Mate loopback did not become ready in 30 seconds')
}

async function waitForDevToolsPort(child, userData) {
  const path = join(userData, 'DevToolsActivePort')
  for (let attempt = 0; attempt < 300; attempt += 1) {
    if (child.exitCode !== null || child.signalCode !== null) throw new Error('installed e-Mate exited before CDP became ready')
    try {
      const lines = (await readFile(path, 'utf8')).trim().split('\n')
      const port = Number(lines[0])
      if (Number.isSafeInteger(port) && port > 0 && port <= 65_535) return port
    } catch {}
    await delay(100)
  }
  throw new Error('installed e-Mate did not expose its loopback CDP port in 30 seconds')
}

async function openCdpSession(port) {
  const response = await fetch(`http://127.0.0.1:${String(port)}/json/list`)
  if (!response.ok) throw new Error(`CDP target discovery failed over HTTP ${String(response.status)}`)
  const targets = await response.json()
  const pages = targets.filter(target => target.type === 'page'
    && typeof target.webSocketDebuggerUrl === 'string' && target.url?.startsWith(LOOPBACK_ORIGIN))
  if (pages.length !== 1) throw new Error('installed e-Mate must expose exactly one loopback renderer target')
  const socket = new WebSocket(pages[0].webSocketDebuggerUrl)
  await new Promise((resolveOpen, rejectOpen) => {
    socket.addEventListener('open', resolveOpen, { once: true })
    socket.addEventListener('error', () => rejectOpen(new Error('CDP WebSocket failed to open')), { once: true })
  })
  let nextId = 0
  const pending = new Map()
  socket.addEventListener('message', event => {
    let message
    try { message = JSON.parse(String(event.data)) } catch { return }
    if (!Number.isSafeInteger(message.id)) return
    const entry = pending.get(message.id)
    if (entry === undefined) return
    pending.delete(message.id)
    if (message.error === undefined) entry.resolve(message.result)
    else entry.reject(new Error(`CDP ${entry.method} failed: ${message.error.message}`))
  })
  const call = (method, params = {}) => new Promise((resolveCall, rejectCall) => {
    const id = ++nextId
    pending.set(id, { method, resolve: resolveCall, reject: rejectCall })
    socket.send(JSON.stringify({ id, method, params }))
  })
  return { socket, call }
}

async function bootstrapCdp(port) {
  const cdp = await openCdpSession(port)
  try {
    await cdp.call('Page.enable')
    await cdp.call('Runtime.enable')
    await cdp.call('Page.addScriptToEvaluateOnNewDocument', { source: buildCdpPreBootstrapScript() })
    await cdp.call('Page.reload', { ignoreCache: true })
    for (let attempt = 0; attempt < 300; attempt += 1) {
      const result = await cdp.call('Runtime.evaluate', {
        expression: `(() => {
          if (document.readyState !== 'complete' || globalThis.__ematePerformanceProbe === undefined) return null;
          try { return globalThis.__ematePerformanceProbe.selfTest(false); }
          catch (error) { return { error: error instanceof Error ? error.message : String(error) }; }
        })()`,
        returnByValue: true,
      })
      const value = result?.result?.value
      if (value?.error !== undefined) throw new Error(`installed renderer bootstrap failed: ${value.error}`)
      if (value?.transport === 'mux-string-server-request-v1'
        && value?.dom === 'deferred-until-owned-session') return cdp
      await delay(100)
    }
    throw new Error('installed renderer did not satisfy the CDP bootstrap self-test in 30 seconds')
  } catch (cause) {
    cdp.socket.close()
    throw cause
  }
}

export async function launchDarwinRuntime(lane, arm) {
  const selected = arm === 'baseline' ? lane.baseline : arm === 'candidate' ? lane.candidate : undefined
  if (selected === undefined) throw new Error('unknown installed runtime arm')
  lane.launch_sequence += 1
  const home = join(lane.work, `${arm}-dsh-home`)
  const userData = join(lane.work, `${arm}-user-data-${String(lane.launch_sequence)}`)
  await Promise.all([mkdir(home, { mode: 0o700, recursive: true }), mkdir(userData, { mode: 0o700 })])
  await cp(selected.profile.root, join(userData, 'profile-generations'), {
    recursive: true, force: false, errorOnExist: true,
  })
  await strictProfileState(
    join(userData, 'profile-generations/state.json'),
    selected.profile.generation,
    'isolated pre-launch Profile state',
  )
  const allowed = Object.fromEntries([
    'HOME', 'LANG', 'LC_ALL', 'LOGNAME', 'PATH', 'SHELL', 'TMPDIR', 'USER',
  ].filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]]))
  const child = spawn(selected.executable.path, [
    `--user-data-dir=${userData}`, '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0',
  ], {
    shell: false,
    stdio: 'ignore',
    env: {
      ...allowed,
      DSH_HOME: home,
      ...(lane.node_options_preload === undefined ? {} : { NODE_OPTIONS: `--require=${lane.node_options_preload}` }),
    },
  })
  let cdp
  try {
    await waitForLoopback(child)
    await verifyRuntimeProfileBinding(selected, userData, home)
    cdp = await bootstrapCdp(await waitForDevToolsPort(child, userData))
  } catch (cause) {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
    await Promise.race([
      new Promise(resolveExit => child.once('exit', resolveExit)),
      delay(5_000).then(() => { if (child.exitCode === null) child.kill('SIGKILL') }),
    ])
    await rm(userData, { recursive: true, force: true })
    throw cause
  }
  return {
    child, home, user_data: userData, cdp,
    stop: async () => {
      cdp.socket.close()
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
      await Promise.race([
        new Promise(resolveExit => child.once('exit', resolveExit)),
        delay(5_000).then(() => { if (child.exitCode === null) child.kill('SIGKILL') }),
      ])
      await rm(userData, { recursive: true, force: true })
    },
  }
}

async function rpc(method, payload) {
  const response = await fetch(`${LOOPBACK_ORIGIN}/api/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: `performance-${method}-${randomUUID()}`, method, payload }),
  })
  if (!response.ok) throw new Error(`${method} failed over HTTP ${String(response.status)}`)
  const body = await response.json()
  if (body?.result?.ok !== true) throw new Error(`${method} failed: ${body?.result?.error?.code ?? 'invalid-response'}`)
  return body.result.value
}

async function connectionRpc(channel, endpoint, payload) {
  const rpcId = `performance-${endpoint}-${randomUUID()}`
  const response = await fetch(`${LOOPBACK_ORIGIN}${channel}/${endpoint}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId, method: endpoint, payload }),
  })
  if (!response.ok) throw new Error(`${endpoint} failed over HTTP ${String(response.status)}`)
  const body = await response.json()
  if (body?.rpcId !== rpcId || body?.result?.ok !== true) {
    throw new Error(`${endpoint} failed: ${body?.result?.error?.code ?? 'invalid-response'}`)
  }
  return body.result.value
}

async function completeHistory(sessionId) {
  const pages = []
  let beforeSeq
  for (let page = 0; page < 100; page += 1) {
    const value = await rpc('session.history', {
      sessionId, maxMessages: 200, ...(beforeSeq === undefined ? {} : { beforeSeq }),
    })
    if (!Array.isArray(value?.events) || typeof value.hasMore !== 'boolean') {
      throw new Error('session.history returned an invalid page')
    }
    const events = value.events.map(entry => entry?.event)
    if (events.some(event => !Number.isSafeInteger(event?.seq) || !Number.isFinite(event?.time))) {
      throw new Error('session.history page lost native seq/time')
    }
    pages.unshift(events)
    if (!value.hasMore) break
    const first = events[0]?.seq
    if (!Number.isSafeInteger(first) || first <= 0) throw new Error('session.history pagination did not advance')
    beforeSeq = first
    if (page === 99) throw new Error('session.history exceeded its closed pagination bound')
  }
  const events = pages.flat()
  if (events.some((event, index) => event.seq !== index)) throw new Error('session.history is not one contiguous native log')
  return events
}

async function waitForTurnEnd(sessionId, turn) {
  for (let attempt = 0; attempt < 3_000; attempt += 1) {
    const events = await completeHistory(sessionId)
    const terminal = events.find(event => event.type === 'turn/end' && event.data?.turn === turn)
    if (terminal !== undefined) {
      if (terminal.data?.reason?.kind !== 'completed') throw new Error('acceptance turn did not complete')
      return events
    }
    await delay(100)
  }
  throw new Error('acceptance turn did not complete in five minutes')
}

async function selectModel(sessionId, performanceModel) {
  const selected = await rpc('session.selectModel', {
    sessionId,
    provider: performanceModel.provider,
    model: performanceModel.model,
    reasoningEffort: performanceModel.reasoning_effort,
  })
  if (selected?.selected?.provider !== performanceModel.provider
    || selected.selected.model !== performanceModel.model
    || selected.selected.reasoningEffort !== performanceModel.reasoning_effort) {
    throw new Error('installed Session did not select the exact performance model leaf')
  }
}

async function seedHistory(sessionId) {
  for (let turn = 1; turn <= 20; turn += 1) {
    await rpc('session.prompt', {
      sessionId, mode: 'queue', content: [{ type: 'text', text: PROMPTS.seed(turn) }],
    })
    await waitForTurnEnd(sessionId, turn)
  }
}

async function uniqueBlankSession() {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const value = await rpc('session.list', {})
    if (!Array.isArray(value?.items)) throw new Error('session.list returned no native Session rows')
    const blank = value.items.filter(item => item?.blank === true)
    if (blank.length > 1) throw new Error('acceptance runtime exposed more than one reusable blank Session')
    if (blank.length === 1 && typeof blank[0].sessionId === 'string') return blank[0].sessionId
    await delay(100)
  }
  throw new Error('acceptance runtime did not expose one native blank Session in 30 seconds')
}

async function activateOwnedSession(cdp, sessionId, blank) {
  const pathname = blank ? '/' : `/chat/${encodeURIComponent(sessionId)}`
  await cdp.call('Page.reload', { ignoreCache: true })
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const result = await cdp.call('Runtime.evaluate', {
      expression: `(() => { if (document.readyState !== 'complete' || globalThis.__ematePerformanceProbe === undefined) return null;
        const pathname = ${JSON.stringify(pathname)};
        if (location.pathname !== pathname) {
          history.pushState(null, '', pathname);
          dispatchEvent(new PopStateEvent('popstate'));
          return null;
        }
        try { return globalThis.__ematePerformanceProbe.selfTest(true); }
        catch (error) { return null; } })()`,
      returnByValue: true,
    })
    const value = result?.result?.value
    if (value?.transport === 'mux-string-server-request-v1'
      && value?.dom === 'conversation-scroll/composer-seat/send-structural-v1') return
    await delay(100)
  }
  throw new Error('owned Session did not become the exact visible composer in 30 seconds')
}

async function prepareTrustedClick(cdp, input) {
  const result = await cdp.call('Runtime.evaluate', {
    expression: `(() => {
      const textarea = document.querySelector('[data-composer-seat] [data-composer-card] textarea:enabled');
      const card = textarea?.closest('[data-composer-card]');
      const buttons = card === null || card === undefined ? [] : [...card.querySelectorAll(':scope > div:last-child > div:last-child > button[aria-label]')];
      if (!(textarea instanceof HTMLTextAreaElement) || buttons.length !== 1) return { error: 'exact composer is unavailable' };
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      if (setter === undefined) return { error: 'native textarea setter is unavailable' };
      setter.call(textarea, ${JSON.stringify(input.prompt)});
      textarea.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: null }));
      globalThis.__ematePerformanceProbe.beginSample(${JSON.stringify({
        sampleKey: input.sample_key, sessionId: input.session_id, turn: input.turn, step: input.step,
      })});
      const rect = buttons[0].getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0 || buttons[0].disabled) return { error: 'exact send control is unavailable' };
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    })()`,
    returnByValue: true,
  })
  const value = result?.result?.value
  if (!Number.isFinite(value?.x) || !Number.isFinite(value?.y)) {
    throw new Error(value?.error ?? 'renderer did not prepare the trusted acceptance submit')
  }
  await cdp.call('Input.dispatchMouseEvent', { type: 'mousePressed', x: value.x, y: value.y, button: 'left', clickCount: 1 })
  await cdp.call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: value.x, y: value.y, button: 'left', clickCount: 1 })
}

async function finishPaint(cdp, sampleKey) {
  for (let attempt = 0; attempt < 3_000; attempt += 1) {
    const result = await cdp.call('Runtime.evaluate', {
      expression: `(() => { try { return { value: globalThis.__ematePerformanceProbe.finishSample(${JSON.stringify(sampleKey)}) }; }
        catch (error) { const message = error instanceof Error ? error.message : String(error); return message.includes('incomplete') ? null : { error: message }; } })()`,
      returnByValue: true,
    })
    const value = result?.result?.value
    if (value?.error !== undefined) throw new Error(`renderer paint capture failed: ${value.error}`)
    if (value?.value !== undefined) return value.value
    await delay(100)
  }
  throw new Error('renderer paint capture did not complete in five minutes')
}

function requestAttempts(events, turn, candidate) {
  const starts = events.map((event, index) => ({ event, index }))
    .filter(({ event }) => event.type === 'step/start' && event.data?.turn === turn)
  return starts.map(({ event, index }, attemptIndex) => {
    const end = starts[attemptIndex + 1]?.index ?? events.length
    const own = events.slice(index, end).find(candidateEvent => candidateEvent.type === 'request/header')?.data?.header
    const prior = events.slice(0, index).findLast(candidateEvent => candidateEvent.type === 'request/header')?.data?.header
    const header = own ?? prior
    if (header === undefined) throw new Error('native request has no effective request/header')
    return {
      ordinal: attemptIndex + 1, turn, step: event.data.step,
      request_id: `${String(turn)}:${String(event.data.step)}`,
      effective_header: header,
      ...(candidate ? { diagnostic: null } : {}),
    }
  })
}

function brokerEvents(value) {
  if (value === null || typeof value !== 'object' || !Array.isArray(value.events)) {
    throw new Error('usage-snapshot broker returned no complete events array')
  }
  return value.events
}

function enterpriseReceipt(value, endpoint, auditStatus) {
  const receipt = value?.receipt
  if (receipt?.endpoint !== endpoint || receipt.inference_gateway !== 'available') {
    throw new Error('offline-control status did not prove the requested endpoint boundary')
  }
  if ('audit_outbox_sha256' in receipt || 'audit_status_sha256' in receipt) {
    throw new Error('offline-control broker cannot claim the native DSH audit authority')
  }
  return { ...receipt, audit_status_sha256: nativeAuditStatusSha256(auditStatus) }
}

async function writeJson(path, value) {
  assertNoPrivatePayload(value)
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
}

function artifactBinding(model, pathName) {
  return {
    schema_version: 2,
    performance_run_id: model.performance_run_id,
    path_name: pathName,
    sample_ids_sha256: sha256(canonical(model.schedule.map(row => row.pair_id))),
  }
}

async function collectPath(input) {
  const { model, pathName, runtime, lane, config, configPath } = input
  const candidate = pathName !== 'baseline'
  const prefix = pathName.replaceAll('_', '-')
  const accumulator = input.accumulator ?? {
    native: [], headers: [], provider: [], paint: [], sessionIds: new Set(),
    startedAt: new Date().toISOString(), browserProduct: undefined, historySeedSessionId: undefined,
  }
  const { native, headers, provider, paint } = accumulator
  const startedAt = accumulator.startedAt
  const browser = await runtime.cdp.call('Browser.getVersion')
  accumulator.browserProduct ??= browser?.product
  for (const row of input.rows ?? model.schedule) {
    const index = model.schedule.indexOf(row)
    if (index < 0) throw new Error('collector row is outside the owned schedule')
    let sessionId
    if (row.scenario === 'history-20') {
      if (accumulator.historySeedSessionId === undefined) {
        const seed = await rpc('session.create', {})
        if (typeof seed?.sessionId !== 'string' || seed.sessionId.length === 0) throw new Error('session.create returned no history seed Session id')
        await rpc('session.rename', { sessionId: seed.sessionId, title: 'Performance acceptance history seed' })
        await selectModel(seed.sessionId, model.performance_model)
        await seedHistory(seed.sessionId)
        accumulator.historySeedSessionId = seed.sessionId
      }
      const fork = await rpc('session.fork', { sessionId: accumulator.historySeedSessionId })
      sessionId = fork?.sessionId
    } else {
      sessionId = await uniqueBlankSession()
      await rpc('session.rename', { sessionId, title: 'Performance acceptance' })
    }
    if (typeof sessionId !== 'string' || sessionId.length === 0) throw new Error('native Session creation returned no Session id')
    if (accumulator.sessionIds.has(sessionId)) throw new Error('native Session identity was reused across acceptance samples')
    accumulator.sessionIds.add(sessionId)
    await selectModel(sessionId, model.performance_model)
    await activateOwnedSession(runtime.cdp, sessionId, row.scenario !== 'history-20')
    const before = brokerEvents(await runRunnerBroker(configPath, config.admin_usage_exporter.reference, 'usage-snapshot', {
      account: config.acceptance_identity.reference,
      model: model.performance_model.model,
      provider: model.performance_model.provider,
    }))
    const turn = row.scenario === 'history-20' ? 21 : 1
    const sampleKey = `${model.performance_run_id}:${pathName}:${row.pair_id}`
    await prepareTrustedClick(runtime.cdp, {
      prompt: PROMPTS[row.scenario], sample_key: sampleKey, session_id: sessionId, turn, step: 1,
    })
    const [events, rendererPaint] = await Promise.all([
      waitForTurnEnd(sessionId, turn),
      finishPaint(runtime.cdp, sampleKey),
    ])
    const after = brokerEvents(await runRunnerBroker(configPath, config.admin_usage_exporter.reference, 'usage-snapshot', {
      account: config.acceptance_identity.reference,
      model: model.performance_model.model,
      provider: model.performance_model.provider,
    }))
    const message = events.filter(event => event.type === 'user/message' && event.data?.source?.kind === 'user').at(-1)
    if (typeof message?.data?.id !== 'string') throw new Error('native acceptance user/message has no stable id')
    const attempts = requestAttempts(events, turn, candidate)
    const sample = deriveAuthoritySample({
      performance_run_id: model.performance_run_id,
      path_name: pathName,
      path_execution_ordinal: index + 1,
      pair_id: row.pair_id,
      scenario: row.scenario,
      arm_order: row.arm_order,
      session_id: sessionId,
      message_id: message.data.id,
      turn,
      step: 1,
      events,
      request_attempts: attempts,
      usage_before_events: before,
      usage_after_events: after,
      account: config.acceptance_identity.reference,
      account_exclusive: true,
      max_parallel: 1,
      model: model.performance_model.model,
      provider: model.performance_model.provider,
      job_execution_count: 0,
      deliverable_count: 0,
      paint: rendererPaint,
    })
    native.push(sample.native)
    headers.push(sample.headers)
    provider.push(sample.provider)
    paint.push(sample.paint)
  }
  if (input.finalize === false) return accumulator
  if (native.length !== 30 || headers.length !== 30 || provider.length !== 30 || paint.length !== 30
    || accumulator.sessionIds.size !== 30) {
    throw new Error('path finalization requires exactly 30 collected samples')
  }
  const finishedAt = new Date().toISOString()
  const binding = artifactBinding(model, pathName)
  const directory = join(input.plan.scratch_root, model.output_directory)
  await Promise.all([
    writeJson(join(directory, `${prefix}.native.json`), { ...binding, kind: 'native-session-trace', source: 'dsh-session-events', samples: native }),
    writeJson(join(directory, `${prefix}.headers.json`), { ...binding, kind: 'request-headers', source: 'dsh-request-header-waterfall', samples: headers }),
    writeJson(join(directory, `${prefix}.provider.json`), {
      ...binding, kind: 'provider-invocation-receipt', source: 'managed-provider-receipts',
      provider: model.performance_model.provider, model: model.performance_model.model,
      reasoning_level: model.performance_model.reasoning_effort, samples: provider,
    }),
    writeJson(join(directory, `${prefix}.paint.json`), { ...binding, kind: 'renderer-paint-trace', source: 'desktop-renderer-paint', samples: paint }),
  ])
  const selected = candidate ? lane.candidate : lane.baseline
  const installed = structuredClone(selected.receipt)
  installed.install_receipt.launched_at = startedAt
  await writeJson(join(directory, `${prefix}.installed.json`), {
    ...binding, kind: 'installed-runtime-receipt', source: 'installed-application',
    runtime: installed.runtime, install_receipt: installed.install_receipt,
  })
  let receipt
  if (candidate) {
    const auditStatus = await connectionRpc('/emate.audit', 'audit.status', {})
    receipt = enterpriseReceipt(await runRunnerBroker(
      configPath, config.offline_control.reference, 'status', {},
    ), pathName === 'emate_online' ? 'available' : 'unavailable', auditStatus)
    await writeJson(join(directory, `${prefix}.enterprise.json`), {
      ...binding, kind: 'enterprise-runtime-receipt', source: 'e-mate-enterprise-state', receipt,
    })
  }
  return {
    tool: `e-mate-performance-probe@sha256:${input.plan.collector_sha256}`,
    dataset_sha256: sha256(canonical({
      contract: DATASET_CONTRACT,
      prompts: Object.fromEntries(['short-text', 'history-20', 'read-only-tool']
        .map(key => [key, sha256(PROMPTS[key])])),
    })),
    acceptance_identity_sha256: domainHash(model.performance_run_id, 'acceptance-identity', config.acceptance_identity.reference),
    started_at: startedAt,
    finished_at: finishedAt,
    environment: {
      machine_id_sha256: domainHash(model.performance_run_id, 'machine', hostname()),
      os: 'macOS', arch: lane.target.slice('darwin-'.length), node: process.versions.node,
      browser: accumulator.browserProduct ?? 'unknown', network_profile: 'fixed',
    },
    native_trace_artifact: `${prefix}.native.json`,
    provider_receipt_artifact: `${prefix}.provider.json`,
    request_header_artifact: `${prefix}.headers.json`,
    renderer_paint_artifact: `${prefix}.paint.json`,
    installed_runtime_artifact: `${prefix}.installed.json`,
    ...(candidate ? {
      enterprise_state: pathName === 'emate_online'
        ? { endpoint: 'available', lease: 'valid-cached', model_policy: 'valid-cached', audit: 'async-outbox' }
        : { endpoint: 'unavailable', lease: 'valid-cached', model_policy: 'valid-cached', audit: 'async-outbox' },
      enterprise_receipt_artifact: `${prefix}.enterprise.json`,
      enterprise_receipt: receipt,
    } : {}),
  }
}

export function ownedExecutionSchedule(model) {
  if (!Array.isArray(model?.schedule) || model.schedule.length !== 30) {
    throw new Error('model leaf must own exactly 30 scheduled rows')
  }
  return model.schedule.flatMap((row, index) => {
    const expected = row.arm_order === 'AB'
      ? PATHS
      : ['emate_online', 'emate_enterprise_unavailable_valid_cache', 'baseline']
    if (!Array.isArray(row.path_order) || canonical(row.path_order) !== canonical(expected)) {
      throw new Error('model leaf path order drifted from its AB/BA arm')
    }
    return row.path_order.map(path_name => ({ row, path_name, path_execution_ordinal: index + 1 }))
  })
}

async function collectPlan(plan, config, configPath, lane) {
  for (const model of plan.models) {
    const accumulators = {}
    for (const execution of ownedExecutionSchedule(model)) {
        const row = execution.row
        const pathName = execution.path_name
        const action = pathName === 'emate_enterprise_unavailable_valid_cache' ? 'auth-unavailable' : 'auth-available'
        await runRunnerBroker(configPath, config.offline_control.reference, action, {})
        const runtime = await launchDarwinRuntime(lane, pathName === 'baseline' ? 'baseline' : 'candidate')
        try {
          accumulators[pathName] = await collectPath({
            plan, model, pathName, runtime, lane, config, configPath,
            rows: [row], accumulator: accumulators[pathName], finalize: false,
          })
        } finally {
          await runtime.stop()
        }
    }
    const paths = {}
    for (const pathName of PATHS) {
      const action = pathName === 'emate_enterprise_unavailable_valid_cache' ? 'auth-unavailable' : 'auth-available'
      await runRunnerBroker(configPath, config.offline_control.reference, action, {})
      const runtime = await launchDarwinRuntime(lane, pathName === 'baseline' ? 'baseline' : 'candidate')
      try {
        paths[pathName] = await collectPath({
          plan, model, pathName, runtime, lane, config, configPath,
          rows: [], accumulator: accumulators[pathName], finalize: true,
        })
      } finally {
        await runtime.stop()
      }
    }
    await runRunnerBroker(configPath, config.offline_control.reference, 'auth-available', {})
    if (Object.keys(paths).length !== 3) throw new Error('acceptance model leaf did not collect all three paths')
    assertOfflineValidCacheBoundary(paths.emate_online.enterprise_receipt, paths.emate_enterprise_unavailable_valid_cache.enterprise_receipt)
    for (const path of Object.values(paths)) delete path.enterprise_receipt
    await writeJson(join(plan.scratch_root, model.output_directory, 'manifest.json'), {
      schema_version: 2,
      comparison_kind: 'installed-2.0.12-vs-2.0.13',
      performance_run_id: model.performance_run_id,
      evidence_kind: 'production-real-provider',
      harness_commit: plan.harness_commit,
      baseline_harness_commit: plan.baseline_harness_commit,
      performance_model: model.performance_model,
      paths,
    })
  }
}

async function main() {
  const { values } = parseArgs({ options: { plan: { type: 'string' } }, strict: true })
  if (values.plan === undefined || !isAbsolute(values.plan)) throw new Error('--plan must be an absolute path')
  const [plan, sourceSha256] = await Promise.all([
    readFile(values.plan, 'utf8').then(JSON.parse),
    fileSha256(import.meta.filename),
  ])
  assertProbePlan(plan, sourceSha256)
  const configPath = CONFIG_PATHS[process.platform]
  const config = await loadRunnerPrivateConfig(configPath)
  const releaseLock = await acquireSingleRunLock(configPath)
  let lane
  try {
    lane = await prepareDarwinRuntimeLane(plan, config)
    const offlineStatus = await runRunnerBroker(configPath, config.offline_control.reference, 'status', {})
    lane.node_options_preload = await resolveAcceptancePreload(configPath, offlineStatus?.preload_path)
    await collectPlan(plan, config, configPath, lane)
  } finally {
    await releaseRuntimeLane(lane, releaseLock)
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === import.meta.filename) {
  await main().catch(async error => {
    await writePrivateFailureLog(CONFIG_PATHS[process.platform], error).catch(() => {})
    process.stderr.write('performance acceptance probe failed; inspect the runner-owned private log\n')
    process.exitCode = 1
  })
}
