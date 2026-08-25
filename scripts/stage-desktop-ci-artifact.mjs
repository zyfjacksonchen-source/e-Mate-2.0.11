#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { copyFile, lstat, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SHA40 = /^[0-9a-f]{40}$/u
const SHA256 = /^[0-9a-f]{64}$/u
const RUN_ID = /^[1-9][0-9]*$/u
const PLATFORMS = {
  darwin: { suffix: 'mac-universal.dmg', format: 'udif' },
  win32: { suffix: 'win-x64-Setup.exe', format: 'pe' },
}

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function exactKeys(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every(key => key in value)
}

async function regularFile(path) {
  const metadata = await lstat(path)
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size <= 0) throw new Error(`desktop CI artifact is not a non-empty regular file: ${basename(path)}`)
  const bytes = await readFile(path)
  return { bytes: bytes.byteLength, sha256: digest(bytes), content: bytes }
}

function verifyFormat(bytes, format) {
  if (format === 'pe') {
    const peOffset = bytes.byteLength >= 64 ? bytes.readUInt32LE(0x3c) : -1
    if (bytes.subarray(0, 2).toString('ascii') !== 'MZ' || peOffset < 0 || peOffset + 4 > bytes.byteLength
      || bytes.subarray(peOffset, peOffset + 4).toString('hex') !== '50450000') throw new Error('Windows installer is not PE')
    return
  }
  if (bytes.byteLength < 512 || bytes.subarray(bytes.byteLength - 512, bytes.byteLength - 508).toString('ascii') !== 'koly') {
    throw new Error('macOS installer is not UDIF')
  }
}

function identity({ platform, sourceCommit, ciRunId, baseContract }) {
  if (!(platform in PLATFORMS) || !SHA40.test(sourceCommit) || !RUN_ID.test(ciRunId)
    || baseContract === null || typeof baseContract !== 'object' || Array.isArray(baseContract)
    || typeof baseContract.id !== 'string' || !SHA40.test(baseContract.harness_commit ?? '')) {
    throw new Error('desktop CI artifact identity is invalid')
  }
  return { platform, sourceCommit, ciRunId, baseContract }
}

async function json(path) {
  const file = await regularFile(path)
  if (file.bytes > 64 * 1024) throw new Error(`desktop CI JSON receipt is too large: ${basename(path)}`)
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(file.content))
}

async function fileDescriptor(path) {
  const file = await regularFile(path)
  return { name: basename(path), bytes: file.bytes, sha256: file.sha256 }
}

export async function stageDesktopCiArtifact(options) {
  const context = identity(options)
  const source = resolve(options.source)
  const output = resolve(options.output)
  const sourceMetadata = await lstat(source)
  if (!sourceMetadata.isDirectory() || sourceMetadata.isSymbolicLink()) throw new Error('desktop CI artifact source is not a directory')
  if (dirname(output) === output || output === source) throw new Error('desktop CI artifact output is unsafe')
  const version = options.version
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/u.test(version)) throw new Error('desktop version is invalid')
  const expected = `e-Mate-${version}-${PLATFORMS[context.platform].suffix}`
  const installer = await regularFile(join(source, expected))
  verifyFormat(installer.content, PLATFORMS[context.platform].format)
  const sourceNames = await readdir(source)
  const hasBlockmap = sourceNames.includes(`${expected}.blockmap`)
  if (hasBlockmap) await regularFile(join(source, `${expected}.blockmap`))
  await rm(output, { recursive: true, force: true })
  await mkdir(output, { recursive: true })
  await copyFile(join(source, expected), join(output, expected))
  if (hasBlockmap) await copyFile(join(source, `${expected}.blockmap`), join(output, `${expected}.blockmap`))
  const runtime = {
    schema_version: 1,
    document_type: 'emate.desktop-runtime-verification',
    platform: context.platform,
    source_commit: context.sourceCommit,
    ci_run_id: context.ciRunId,
    base_contract_id: context.baseContract.id,
    harness_commit: context.baseContract.harness_commit,
    installer: {
      name: expected, bytes: installer.bytes, sha256: installer.sha256,
      format: PLATFORMS[context.platform].format,
    },
  }
  const runtimePath = join(output, 'desktop-runtime-verification.json')
  await writeFile(runtimePath, `${JSON.stringify(runtime, null, 2)}\n`, { mode: 0o644 })
  const files = await Promise.all([
    fileDescriptor(join(output, expected)),
    fileDescriptor(runtimePath),
    ...(hasBlockmap ? [fileDescriptor(join(output, `${expected}.blockmap`))] : []),
  ])
  files.sort((left, right) => left.name.localeCompare(right.name))
  const receipt = {
    schema_version: 1,
    document_type: 'emate.desktop-ci-artifact',
    platform: context.platform,
    source_commit: context.sourceCommit,
    ci_run_id: context.ciRunId,
    base_contract_id: context.baseContract.id,
    files,
  }
  await writeFile(join(output, 'desktop-artifact-receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o644 })
  return verifyDesktopCiArtifact({ ...options, directory: output })
}

export async function verifyDesktopCiArtifact(options) {
  const context = identity(options)
  const directory = resolve(options.directory)
  const receipt = await json(join(directory, 'desktop-artifact-receipt.json'))
  if (!exactKeys(receipt, ['schema_version', 'document_type', 'platform', 'source_commit', 'ci_run_id', 'base_contract_id', 'files'])
    || receipt.schema_version !== 1 || receipt.document_type !== 'emate.desktop-ci-artifact'
    || receipt.platform !== context.platform || receipt.source_commit !== context.sourceCommit
    || receipt.ci_run_id !== context.ciRunId || receipt.base_contract_id !== context.baseContract.id
    || !Array.isArray(receipt.files) || ![2, 3].includes(receipt.files.length)) {
    throw new Error('desktop CI artifact receipt is invalid')
  }
  const installerDescriptors = receipt.files.filter(file => typeof file?.name === 'string'
    && file.name !== 'desktop-runtime-verification.json')
  if (installerDescriptors.length < 1 || installerDescriptors.length > 2
    || !installerDescriptors.some(file => file.name.endsWith(PLATFORMS[context.platform].suffix))
    || installerDescriptors.some(file => !file.name.endsWith(PLATFORMS[context.platform].suffix)
      && !file.name.endsWith(`${PLATFORMS[context.platform].suffix}.blockmap`))) {
    throw new Error('desktop CI artifact platform file set is invalid')
  }
  const expectedNames = receipt.files.map(file => file?.name).sort()
  const actualNames = (await readdir(directory)).sort()
  if (JSON.stringify(actualNames) !== JSON.stringify([...expectedNames, 'desktop-artifact-receipt.json'].sort())) {
    throw new Error('desktop CI artifact contains an unexpected file')
  }
  for (const descriptor of receipt.files) {
    if (!exactKeys(descriptor, ['name', 'bytes', 'sha256']) || basename(descriptor.name ?? '') !== descriptor.name
      || !Number.isSafeInteger(descriptor.bytes) || descriptor.bytes <= 0 || !SHA256.test(descriptor.sha256 ?? '')) {
      throw new Error('desktop CI artifact file receipt is invalid')
    }
    const actual = await regularFile(join(directory, descriptor.name))
    if (actual.bytes !== descriptor.bytes || actual.sha256 !== descriptor.sha256) throw new Error(`desktop CI artifact file drifted: ${descriptor.name}`)
  }
  const runtime = await json(join(directory, 'desktop-runtime-verification.json'))
  if (!exactKeys(runtime, ['schema_version', 'document_type', 'platform', 'source_commit', 'ci_run_id', 'base_contract_id', 'harness_commit', 'installer'])
    || runtime.schema_version !== 1 || runtime.document_type !== 'emate.desktop-runtime-verification'
    || runtime.platform !== context.platform || runtime.source_commit !== context.sourceCommit
    || runtime.ci_run_id !== context.ciRunId || runtime.base_contract_id !== context.baseContract.id
    || runtime.harness_commit !== context.baseContract.harness_commit
    || !exactKeys(runtime.installer, ['name', 'bytes', 'sha256', 'format'])
    || basename(runtime.installer.name ?? '') !== runtime.installer.name
    || !Number.isSafeInteger(runtime.installer.bytes) || runtime.installer.bytes <= 0
    || !SHA256.test(runtime.installer.sha256 ?? '')
    || !receipt.files.some(file => file.name === runtime.installer.name)
    || runtime.installer.format !== PLATFORMS[context.platform].format) {
    throw new Error('desktop runtime verification receipt is invalid')
  }
  const installer = await regularFile(join(directory, runtime.installer.name))
  if (installer.bytes !== runtime.installer.bytes || installer.sha256 !== runtime.installer.sha256) throw new Error('desktop runtime installer receipt drifted')
  verifyFormat(installer.content, runtime.installer.format)
  return { receipt, runtime }
}

function argument(name) {
  const index = process.argv.indexOf(name)
  const value = index < 0 ? undefined : process.argv[index + 1]
  if (value === undefined || value === '') throw new Error(`missing ${name}`)
  return value
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const command = process.argv[2]
    const baseContract = await json(argument('--base-contract'))
    const common = {
      platform: argument('--platform'), sourceCommit: argument('--source-commit'), ciRunId: argument('--ci-run-id'), baseContract,
    }
    const result = command === 'stage'
      ? await stageDesktopCiArtifact({ ...common, source: argument('--source'), output: argument('--out'), version: argument('--version') })
      : command === 'verify'
        ? await verifyDesktopCiArtifact({ ...common, directory: argument('--directory') })
        : undefined
    if (result === undefined) throw new Error('desktop CI artifact command must be stage or verify')
    process.stdout.write(`${JSON.stringify({ platform: result.receipt.platform, files: result.receipt.files.length })}\n`)
  } catch (cause) {
    process.stderr.write(`desktop-ci-artifact: ${cause instanceof Error ? cause.message : String(cause)}\n`)
    process.exitCode = 1
  }
}
