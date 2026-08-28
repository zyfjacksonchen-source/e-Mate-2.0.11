import { execFileSync } from 'node:child_process'
import { appendFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const SHA = /^[0-9a-f]{40}$/u
const SHA256_DIGEST = /^sha256:[0-9a-f]{64}$/u
const POSITIVE_ID = /^[1-9][0-9]*$/u
const UNSIGNED = Object.freeze({
  mode: 'unsigned', signed: false, notarized: false, description: 'Unsigned and not notarized.',
})

export function publicationMetadata(macosPublicationMode) {
  if (macosPublicationMode === 'unsigned') {
    return {
      description: 'e-Mate 2.0.15 publishes unsigned macOS and Windows installers; macOS is not notarized.',
      platforms: { darwin: UNSIGNED, win32: UNSIGNED },
    }
  }
  if (macosPublicationMode === 'signed') {
    return {
      description: 'e-Mate 2.0.15 publishes a Developer ID signed and notarized macOS installer and an unsigned Windows installer.',
      platforms: {
        darwin: {
          mode: 'signed', signed: true, notarized: true,
          description: 'Developer ID signed and notarized.',
        },
        win32: UNSIGNED,
      },
    }
  }
  throw new Error('macOS publication mode must be exactly unsigned or signed')
}

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

async function resolveCi(source) {
  assertMainSource(source)
  const runs = gh(['--method', 'GET', `repos/${repository()}/actions/workflows/ci.yml/runs`, '-f', 'branch=main', '-f', 'event=workflow_dispatch', '-f', 'status=success', '-f', 'per_page=100']).workflow_runs ?? []
  const matches = runs.filter(run => run.head_sha === source && run.run_attempt === 1 && run.conclusion === 'success')
  if (matches.length !== 1) throw new Error('expected one formal RC run candidate for shared verification')
  output({ ci_run_id: matches[0].id })
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

export function emitState(options) {
  const artifact = name => ({
    run_id: options[`${name}-run`],
    artifact_id: options[`${name}-artifact`],
    artifact_digest: options[`${name}-digest`],
    artifact_bytes: Number(options[`${name}-bytes`]),
  })
  const required = ['source', 'version', 'mode', 'macos-publication-mode', 'ci-run',
    ...['profile', 'desktop', 'admission'].flatMap(name => [`${name}-run`, `${name}-artifact`, `${name}-digest`, `${name}-bytes`]),
    ...['macos', 'windows'].flatMap(name => [`${name}-run`, `${name}-artifact`, `${name}-digest`, `${name}-bytes`])]
  if (required.some(key => !options[key])) throw new Error('release state is incomplete')
  const publication = publicationMetadata(options['macos-publication-mode'])
  const state = {
    schema_version: 4,
    document_type: 'emate.release-state',
    source_sha: options.source,
    version: options.version,
    release_mode: options.mode,
    macos_publication_mode: options['macos-publication-mode'],
    publication_metadata: publication,
    status: 'admitted-awaiting-cloudflare-plugin',
    stages: {
      ci: { status: 'accepted', run_id: options['ci-run'] },
      profile: { status: 'accepted', run_id: options['profile-run'], ...artifact('profile') },
      desktop: { status: 'accepted', run_id: options['desktop-run'], ...artifact('desktop') },
      admission: { status: 'accepted', run_id: options['admission-run'], ...artifact('admission') },
      publication: { status: 'pending-cloudflare-plugin', macos: artifact('macos'), windows: artifact('windows') },
    },
  }
  const identities = [state.stages.profile, state.stages.desktop, state.stages.admission,
    state.stages.publication.macos, state.stages.publication.windows]
  if (!SHA.test(state.source_sha) || state.version !== process.env.EMATE_EXPECTED_VERSION || state.release_mode !== 'base'
    || !POSITIVE_ID.test(state.stages.ci.run_id)
    || identities.some(value => !POSITIVE_ID.test(value.run_id ?? state.stages.ci.run_id)
      || !POSITIVE_ID.test(value.artifact_id) || !SHA256_DIGEST.test(value.artifact_digest)
      || !Number.isSafeInteger(value.artifact_bytes) || value.artifact_bytes <= 0)
    || [state.stages.profile, state.stages.desktop, state.stages.admission]
      .some(value => !POSITIVE_ID.test(value.run_id))
    || state.stages.publication.windows.run_id !== state.stages.ci.run_id
    || (state.macos_publication_mode === 'unsigned') !== (state.stages.publication.macos.run_id === state.stages.ci.run_id)) {
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
