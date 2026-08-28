import { createHash } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const REPOSITORY = 'zyfjacksonchen-source/e-Mate-2.0.11'
const SHA = /^[0-9a-f]{40}$/u
const DIGEST = /^sha256:[0-9a-f]{64}$/u
const POSITIVE_ID = /^[1-9][0-9]*$/u
const TARGETS = ['darwin-arm64', 'darwin-x64', 'win32-x64']

function record(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function uniqueSuccessfulJob(jobs, name) {
  if (jobs.filter(job => job?.name === name && job.conclusion === 'success').length !== 1) {
    throw new Error(`formal RC job is not uniquely successful: ${name}`)
  }
}

function exactArtifact(artifacts, name, runId, source) {
  const matches = artifacts.filter(artifact => artifact?.name === name
    && artifact.expired === false
    && POSITIVE_ID.test(String(artifact.id))
    && Number.isSafeInteger(artifact.size_in_bytes) && artifact.size_in_bytes > 0
    && DIGEST.test(artifact.digest)
    && String(artifact.workflow_run?.id) === runId
    && artifact.workflow_run?.head_sha === source)
  if (matches.length !== 1) throw new Error(`formal RC artifact is not unique and immutable: ${name}`)
  return matches[0]
}

function stringArray(value) {
  return Array.isArray(value) && value.length > 0 && value.every(item => typeof item === 'string' && item !== '')
}

/** The one shared boundary for every post-CI release consumer. */
export function verifyReleaseCandidateEvidence({ source, runId, run, jobs, artifacts, plan, planArchiveDigest, planArchiveBytes }) {
  const expectedRunId = String(runId)
  if (!SHA.test(source) || !POSITIVE_ID.test(expectedRunId)) throw new Error('formal RC identity is invalid')
  if (!record(run) || String(run.id) !== expectedRunId || run.repository?.full_name !== REPOSITORY
    || run.path !== '.github/workflows/ci.yml' || run.event !== 'workflow_dispatch'
    || run.head_branch !== 'main' || run.head_sha !== source || run.status !== 'completed'
    || run.conclusion !== 'success' || run.run_attempt !== 1) {
    throw new Error('formal RC run must be successful attempt-1 main workflow_dispatch')
  }
  if (!record(plan) || plan.schema_version !== 2 || plan.document_type !== 'emate.ci-plan'
    || plan.ci_mode !== 'release-candidate' || plan.lane !== 'base' || plan.run_base !== true
    || plan.run_components !== true || plan.compose_profile !== true || plan.run_verification !== true
    || plan.portable_publish !== false || typeof plan.profile_bootstrap !== 'boolean'
    || !record(plan.contract) || plan.contract.valid !== true
    || typeof plan.contract.base_contract_id !== 'string' || plan.contract.base_contract_id === ''
    || !Number.isSafeInteger(plan.contract.schedule_protocol_floor)
    || !Array.isArray(plan.contract.errors) || plan.contract.errors.length !== 0
    || !stringArray(plan.components) || !stringArray(plan.publish_components)
    || JSON.stringify([...plan.components].sort()) !== JSON.stringify([...plan.publish_components].sort())
    || !Array.isArray(plan.ci_component_jobs) || plan.ci_component_jobs.length === 0
    || !record(plan.ci) || plan.ci.distribution?.macos !== true || plan.ci.distribution?.windows !== true) {
    throw new Error('formal RC ci-plan contract is invalid')
  }
  if (!record(jobs) || !Array.isArray(jobs.jobs)) throw new Error('formal RC jobs payload is invalid')
  if (!record(artifacts) || !Array.isArray(artifacts.artifacts)) throw new Error('formal RC artifacts payload is invalid')

  const requiredJobs = [
    'Release impact contract',
    'Node 24 / target contracts and unit tests',
    ...plan.ci_component_jobs.map(job => {
      if (!record(job) || typeof job.target !== 'string' || job.target === ''
        || !stringArray(job.components) || !stringArray(job.publish_components)) {
        throw new Error('formal RC component job contract is invalid')
      }
      return `Changed Profile components / ${job.target}`
    }),
    ...TARGETS.map(target => `Complete Profile generation / ${target}`),
    'Windows x64 / unsigned desktop installer',
    'macOS universal / unsigned desktop disk image',
    'CI admission',
  ]
  for (const name of new Set(requiredJobs)) uniqueSuccessfulJob(jobs.jobs, name)

  const requiredArtifacts = [
    `e-mate-ci-plan-${source}`,
    `e-mate-component-source-portable-${source}`,
    `e-mate-base-sdk-${source}`,
    `e-mate-desktop-profile-${source}`,
    `e-mate-desktop-profile-build-receipt-${source}`,
    ...plan.ci_component_jobs.map((job, index) => `e-mate-component-${index}-${job.target}-${source}`),
    ...TARGETS.map(target => `e-mate-profile-candidate-${target}-${source}`),
    `e-mate-desktop-windows-${source}`,
    `e-mate-desktop-macos-${source}`,
  ]
  const acceptedArtifacts = requiredArtifacts.map(name => exactArtifact(
    artifacts.artifacts, name, expectedRunId, source,
  ))
  if (new Set(acceptedArtifacts.map(artifact => String(artifact.id))).size !== acceptedArtifacts.length) {
    throw new Error('formal RC artifacts share an identity')
  }
  if (acceptedArtifacts[0].digest !== planArchiveDigest
    || acceptedArtifacts[0].size_in_bytes !== planArchiveBytes) {
    throw new Error('formal RC ci-plan archive bytes or digest drifted')
  }
  return {
    source_sha: source,
    run_id: expectedRunId,
    profile_bootstrap: plan.profile_bootstrap,
    required_artifacts: acceptedArtifacts.map(artifact => ({
      id: String(artifact.id), name: artifact.name, size_in_bytes: artifact.size_in_bytes, digest: artifact.digest,
    })),
  }
}

function args(argv) {
  const values = {}
  for (let index = 0; index < argv.length; index += 2) {
    if (!argv[index]?.startsWith('--') || argv[index + 1] === undefined) throw new Error('arguments must be --key value pairs')
    values[argv[index].slice(2)] = argv[index + 1]
  }
  return values
}

function json(path) {
  const file = statSync(path)
  if (!file.isFile() || file.size <= 0 || file.size > 16 * 1024 * 1024) throw new Error('release evidence JSON size is invalid')
  return JSON.parse(readFileSync(path, 'utf8'))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [command, ...argv] = process.argv.slice(2)
  if (command !== 'verify') throw new Error('release-candidate command must be verify')
  const options = args(argv)
  const planArchive = statSync(options['plan-archive'])
  if (!planArchive.isFile() || planArchive.size <= 0) throw new Error('formal RC ci-plan archive is invalid')
  process.stdout.write(`${JSON.stringify(verifyReleaseCandidateEvidence({
    source: options.source,
    runId: options['run-id'],
    run: json(options.run),
    jobs: json(options.jobs),
    artifacts: json(options.artifacts),
    plan: json(options.plan),
    planArchiveDigest: `sha256:${createHash('sha256').update(readFileSync(options['plan-archive'])).digest('hex')}`,
    planArchiveBytes: planArchive.size,
  }))}\n`)
}
