#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, mkdir, readFile, realpath, rmdir } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import { parseArgs } from 'node:util'

const SHA256 = /^[0-9a-f]{64}$/u
const FORBIDDEN_PRIVATE_KEYS = /(?:body|content|prompt|tool_arguments|password|secret|credential|bearer|api_?key)/iu
const CONFIG_PATHS = Object.freeze({
  darwin: '/Library/Application Support/e-Mate/acceptance/performance-probe.json',
  win32: 'C:\\ProgramData\\e-Mate\\acceptance\\performance-probe.json',
})

async function fileSha256(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

export function domainHash(domain, rawId) {
  if (typeof domain !== 'string' || domain.length === 0 || typeof rawId !== 'string' || rawId.length === 0) {
    throw new Error('opaque identifiers require non-empty hash domains and values')
  }
  return createHash('sha256').update(`e-mate-performance-v1\0${domain}\0${rawId}`).digest('hex')
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
  if (keys !== ['acceptance_identity', 'admin_usage_exporter', 'max_parallel_runs', 'runner_scope', 'schema_version'].sort().join('\0')
    || config.schema_version !== 1 || config.runner_scope !== 'dedicated-performance-runner'
    || config.max_parallel_runs !== 1
    || config.acceptance_identity?.authority !== 'os-keychain'
    || typeof config.acceptance_identity?.reference !== 'string' || config.acceptance_identity.reference.length === 0
    || config.admin_usage_exporter?.authority !== 'local-secret-broker'
    || typeof config.admin_usage_exporter?.reference !== 'string' || config.admin_usage_exporter.reference.length === 0) {
    throw new Error('runner-private config does not name the closed identity and exporter authorities')
  }
  return config
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

export function assertProbePlan(plan, installedSourceSha256) {
  assertNoPrivatePayload(plan, 'plan')
  if (plan?.schema_version !== 1 || plan.mode !== 'production-installed-performance-acceptance'
    || plan.collector_sha256 !== installedSourceSha256
    || plan.collector_provenance?.source_sha256 !== installedSourceSha256
    || plan.collector_provenance?.installed_sha256 !== installedSourceSha256
    || !Array.isArray(plan.models) || plan.models.length !== 4
    || !plan.models.every(model => Array.isArray(model.schedule) && model.schedule.length === 30
      && model.expected_files?.length === 18)) {
    throw new Error('probe plan is not owned by the exact protected-main source bytes')
  }
}

export function buildCdpPreBootstrapScript() {
  // Installed Desktop injects this with Page.addScriptToEvaluateOnNewDocument.
  // Every recorded instant therefore comes from one renderer performance.now() clock.
  return String.raw`(() => {
    const state = { sendAt: null, firstChunkAt: null, firstTextAt: null, paintAt: null };
    const nonEmptyAssistantChunk = value => {
      let parsed;
      try { parsed = JSON.parse(typeof value === 'string' ? value : ''); } catch { return false; }
      return (parsed?.type === 'assistant/chunk' || parsed?.type === 'message/chunk')
        && typeof (parsed?.delta?.text ?? parsed?.text) === 'string'
        && (parsed?.delta?.text ?? parsed?.text).length > 0;
    };
    const NativeWebSocket = globalThis.WebSocket;
    globalThis.WebSocket = class PerformanceWebSocket extends NativeWebSocket {
      constructor(...args) {
        super(...args);
        this.addEventListener('message', event => {
          if (state.sendAt !== null && state.firstChunkAt === null && nonEmptyAssistantChunk(event.data)) {
            state.firstChunkAt = performance.now();
          }
        });
      }
    };
    const observe = () => {
      const root = document.querySelector('[data-current-turn]');
      if (!root) { requestAnimationFrame(observe); return; }
      const hasText = node => {
        if (node.nodeType === Node.TEXT_NODE) return (node.nodeValue ?? '').trim().length > 0;
        const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          if ((node.nodeValue ?? '').trim().length > 0) return true;
        }
        return false;
      };
      const mark = records => {
        if (state.sendAt === null || state.firstTextAt !== null) return;
        const visible = records.some(record => record.type === 'characterData'
          ? (record.target.nodeValue ?? '').trim().length > 0
          : [...record.addedNodes].some(node => hasText(node)));
        if (!visible) return;
        state.firstTextAt = performance.now();
        requestAnimationFrame(() => requestAnimationFrame(() => { state.paintAt = performance.now(); observer.disconnect(); }));
      };
      const observer = new MutationObserver(mark);
      observer.observe(root, { childList: true, characterData: true, subtree: true });
    };
    addEventListener('click', event => {
      if (event.isTrusted && event.target instanceof Element && event.target.closest('[data-performance-send]')) {
        state.sendAt = performance.now();
      }
    }, { capture: true });
    document.readyState === 'loading' ? addEventListener('DOMContentLoaded', observe, { once: true }) : observe();
    Object.defineProperty(globalThis, '__ematePerformanceProbe', { value: state, configurable: false });
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
  const expected = input.attempts.filter(attempt => attempt.account === input.account
    && attempt.model === input.model && attempt.scope === input.scope && attempt.cursor === input.cursor)
  if (expected.length !== input.attempts.length || input.events.length !== expected.length) {
    throw new Error('usage authority contains extra or missing attempts for the dedicated scope')
  }
  const byResponse = new Map()
  for (const event of input.events) {
    if (event.account !== input.account || event.model !== input.model
      || event.scope !== input.scope || event.cursor !== input.cursor
      || byResponse.has(event.provider_response_id)) {
      throw new Error('usage authority is ambiguous for the dedicated scope')
    }
    byResponse.set(event.provider_response_id, event)
  }
  return expected.map(attempt => {
    const event = byResponse.get(attempt.provider_response_id)
    if (event === undefined || event.provider_invocation_id !== attempt.provider_invocation_id
      || event.request_id !== attempt.request_id) {
      throw new Error('usage authority cannot join the native request exactly')
    }
    return {
      request_id_sha256: domainHash('request', attempt.request_id),
      provider_invocation_id_sha256: domainHash('provider-invocation', attempt.provider_invocation_id),
      provider_response_id_sha256: domainHash('provider-response', attempt.provider_response_id),
      usage: event.usage,
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
    || !SHA256.test(offline.audit_outbox_sha256)) {
    throw new Error('offline path did not isolate only the auth and policy control plane inside valid cache windows')
  }
  return {
    lease_sha256: offline.lease_sha256,
    model_policy_sha256: offline.model_policy_sha256,
    audit_outbox_sha256: offline.audit_outbox_sha256,
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
  await loadRunnerPrivateConfig(configPath)
  const releaseLock = await acquireSingleRunLock(configPath)
  try {
    // The pinned Desktop does not yet expose a direct, read-only Session/request/tool
    // capture authority to an external Node process. Do not substitute DOM scraping,
    // time-window joins, or runner fixtures for that missing production authority.
    throw new Error('native installed-runtime capture authority is unavailable')
  } finally {
    await releaseLock()
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === import.meta.filename) {
  await main().catch(() => {
    process.stderr.write('performance acceptance probe failed; inspect the runner-owned private log\n')
    process.exitCode = 1
  })
}
