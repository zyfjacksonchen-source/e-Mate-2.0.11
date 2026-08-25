import { execFileSync } from 'node:child_process'
import { appendFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const SHA = /^[0-9a-f]{40}$/u
const POSITIVE_ID = /^[1-9][0-9]*$/u

export function parseArgs(argv) {
  const options = {}
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]
    if (!key?.startsWith('--') || argv[index + 1] === undefined) throw new Error('release coordinator arguments must be --key value pairs')
    options[key.slice(2)] = argv[index + 1]
  }
  return options
}

export function exactArtifact(artifacts, name, runId) {
  const matches = artifacts.filter(artifact => artifact.name === name && artifact.expired === false
    && String(artifact.workflow_run?.id) === String(runId)
    && typeof artifact.digest === 'string' && /^sha256:[0-9a-f]{64}$/u.test(artifact.digest)
    && Number.isSafeInteger(artifact.size_in_bytes) && artifact.size_in_bytes > 0)
  if (matches.length !== 1) throw new Error(`expected one exact artifact ${name}`)
  return matches[0]
}

function gh(args, input) {
  const value = execFileSync('gh', ['api', ...args], {
    encoding: 'utf8', input: input === undefined ? undefined : JSON.stringify(input),
    maxBuffer: 16 * 1024 * 1024,
  })
  return value.trim() === '' ? {} : JSON.parse(value)
}

function output(values) {
  if (!process.env.GITHUB_OUTPUT) return
  appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(values).map(([key, value]) => `${key}=${String(value)}\n`).join(''))
}

function repository() {
  const value = process.env.GITHUB_REPOSITORY
  if (value !== 'zyfjacksonchen-source/e-Mate-2.0.11') throw new Error('release coordinator is outside the protected repository')
  return value
}

function assertMainSource(source) {
  if (!SHA.test(source)) throw new Error('source must be one exact commit')
  const current = gh([`repos/${repository()}/git/ref/heads/main`]).object?.sha
  if (current !== source) throw new Error('protected main advanced during release coordination')
}

function runJobs(runId) {
  return gh(['--method', 'GET', `repos/${repository()}/actions/runs/${runId}/jobs`, '-f', 'per_page=100']).jobs ?? []
}

async function resolveCi(source) {
  assertMainSource(source)
  const runs = gh(['--method', 'GET', `repos/${repository()}/actions/workflows/ci.yml/runs`, '-f', 'branch=main', '-f', 'event=push', '-f', 'status=success', '-f', 'per_page=100']).workflow_runs ?? []
  const matches = runs.filter(run => run.head_sha === source && run.run_attempt === 1 && run.conclusion === 'success')
  if (matches.length !== 1) throw new Error('expected one successful attempt-1 protected-main CI run')
  const run = matches[0]
  if (!runJobs(run.id).some(job => job.name === 'CI admission' && job.conclusion === 'success')) {
    throw new Error('protected-main CI admission did not succeed')
  }
  output({ ci_run_id: run.id })
}

function workflowRuns(workflow) {
  return gh(['--method', 'GET', `repos/${repository()}/actions/workflows/${workflow}/runs`, '-f', 'branch=main', '-f', 'event=workflow_dispatch', '-f', 'per_page=30']).workflow_runs ?? []
}

async function dispatchAndWait(source, workflow, inputs) {
  assertMainSource(source)
  const previous = Math.max(0, ...workflowRuns(workflow).map(run => Number(run.id) || 0))
  gh(['--method', 'POST', `repos/${repository()}/actions/workflows/${workflow}/dispatches`, '--input', '-'], { ref: 'main', inputs })
  const deadline = Date.now() + 6 * 60 * 60 * 1000
  let run
  while (Date.now() < deadline) {
    const matches = workflowRuns(workflow).filter(candidate => candidate.id > previous
      && candidate.head_sha === source && candidate.run_attempt === 1)
    if (matches.length > 1) throw new Error(`ambiguous ${workflow} dispatch`)
    run = matches[0]
    if (run?.status === 'completed') break
    await new Promise(resolve => setTimeout(resolve, 15_000))
  }
  assertMainSource(source)
  if (run?.status !== 'completed' || run.conclusion !== 'success') throw new Error(`${workflow} did not complete successfully`)
  output({ run_id: run.id })
}

function resolveArtifact(runId, name) {
  if (!POSITIVE_ID.test(String(runId))) throw new Error('artifact run id must be positive')
  const artifacts = gh(['--method', 'GET', `repos/${repository()}/actions/runs/${runId}/artifacts`, '-f', 'per_page=100']).artifacts ?? []
  const artifact = exactArtifact(artifacts, name, runId)
  output({ artifact_id: artifact.id, artifact_digest: artifact.digest, artifact_bytes: artifact.size_in_bytes })
}

function emitState(options) {
  const required = ['source', 'version', 'mode', 'ci-run', 'profile-run', 'profile-artifact', 'desktop-run', 'desktop-artifact',
    'performance-run', 'performance-artifact', 'admission-run', 'admission-artifact', 'macos-artifact', 'windows-artifact']
  if (required.some(key => !options[key])) throw new Error('release state is incomplete')
  const state = {
    schema_version: 1,
    document_type: 'emate.release-state',
    source_sha: options.source,
    version: options.version,
    release_mode: options.mode,
    status: 'admitted-awaiting-cloudflare-plugin',
    stages: {
      ci: { status: 'accepted', run_id: options['ci-run'] },
      profile: { status: 'accepted', run_id: options['profile-run'], artifact_id: options['profile-artifact'] },
      desktop: { status: 'accepted', run_id: options['desktop-run'], artifact_id: options['desktop-artifact'] },
      performance: { status: 'accepted', run_id: options['performance-run'], artifact_id: options['performance-artifact'] },
      admission: { status: 'accepted', run_id: options['admission-run'], artifact_id: options['admission-artifact'] },
      publication: { status: 'pending-cloudflare-plugin', macos_artifact_id: options['macos-artifact'], windows_artifact_id: options['windows-artifact'] },
    },
  }
  if (!SHA.test(state.source_sha) || state.version !== process.env.EMATE_EXPECTED_VERSION || state.release_mode !== 'base'
    || Object.values(state.stages).some(stage => Object.entries(stage).some(([key, value]) => key.endsWith('_id') && !POSITIVE_ID.test(String(value))))) {
    throw new Error('release state identity is invalid')
  }
  writeFileSync(options.out, `${JSON.stringify(state, null, 2)}\n`, { flag: 'wx' })
}

async function main() {
  const [command, ...argv] = process.argv.slice(2)
  const options = parseArgs(argv)
  if (command === 'resolve-ci') return resolveCi(options.source)
  if (command === 'dispatch') {
    const inputs = JSON.parse(options.inputs)
    return dispatchAndWait(options.source, options.workflow, inputs)
  }
  if (command === 'artifact') return resolveArtifact(options['run-id'], options.name)
  if (command === 'state') return emitState(options)
  throw new Error('unknown release coordinator command')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main()
