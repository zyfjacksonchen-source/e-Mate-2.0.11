#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'

const ENDPOINT = 'https://pub-ada3f610c0234a76838f4e19fe2bb25e.r2.dev/desktop/signed/latest.json'
const SHA256 = /^[0-9a-f]{64}$/u
const SEMVER = /^\d+\.\d+\.\d+$/u

const digest = bytes => createHash('sha256').update(bytes).digest('hex')

export async function attestBundledUpdateReader({
  readerPath, manifestPath, baseContractPath, sourceMode, currentVersion, expectedStatus,
  installerUrl, installerBytes, installerSha256,
}) {
  if (!['candidate', 'public-predecessor'].includes(sourceMode)
    || !SEMVER.test(currentVersion ?? '') || !['up-to-date', 'update-available'].includes(expectedStatus)
    || !Number.isSafeInteger(installerBytes) || installerBytes <= 0 || !SHA256.test(installerSha256 ?? '')) {
    throw new Error('bundled Reader attestation inputs are invalid')
  }
  const installer = new URL(installerUrl)
  if (installer.protocol !== 'https:' || installer.origin !== new URL(ENDPOINT).origin
    || installer.username !== '' || installer.password !== '' || installer.search !== '' || installer.hash !== '') {
    throw new Error('bundled Reader installer must be an exact canonical R2 URL')
  }
  const [readerBytes, manifestBytes, baseBytes] = await Promise.all([
    readFile(readerPath), readFile(manifestPath), readFile(baseContractPath),
  ])
  if (readerBytes.byteLength <= 0 || readerBytes.byteLength > 1024 * 1024
    || manifestBytes.byteLength <= 0 || manifestBytes.byteLength > 16 * 1024
    || baseBytes.byteLength <= 0 || baseBytes.byteLength > 1024 * 1024) {
    throw new Error('bundled Reader attestation input size is invalid')
  }
  let manifest
  let base
  try {
    manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(manifestBytes))
    base = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(baseBytes))
  } catch {
    throw new Error('bundled Reader attestation JSON is invalid')
  }
  const module = await import(`data:text/javascript;base64,${readerBytes.toString('base64')}`)
  if (module.DESKTOP_VERSION_ENDPOINT !== ENDPOINT
    || typeof module.validateAdmittedDesktopReleaseManifest !== 'function'
    || typeof module.checkForStableUpdate !== 'function') {
    throw new Error('bundled Reader does not expose the required schema-2 update contract')
  }
  const trustedKeys = base?.profile_signing_keys
  if (!Array.isArray(trustedKeys) || trustedKeys.length === 0
    || !Number.isSafeInteger(base.schedule_protocol_floor) || base.schedule_protocol_floor <= 0
    || module.validateAdmittedDesktopReleaseManifest(manifest, trustedKeys) !== true) {
    throw new Error('bundled Reader rejected the final signed schema-2 manifest')
  }
  const outcome = await module.checkForStableUpdate({
    currentVersion,
    currentScheduleProtocolFloor: base.schedule_protocol_floor,
    trustedManifestKeys: trustedKeys,
    platform: 'darwin',
    request: async (url, init) => {
      if (url !== ENDPOINT || init?.method !== 'GET' || init.redirect !== 'error') {
        throw new Error('bundled Reader requested an unexpected update endpoint')
      }
      return new Response(manifestBytes, { status: 200, headers: { 'Content-Type': 'application/json' } })
    },
  })
  if (outcome.status !== expectedStatus || outcome.currentVersion !== currentVersion
    || outcome.latestVersion !== manifest.version) {
    throw new Error(`bundled Reader outcome is ${outcome.status}; expected ${expectedStatus}`)
  }
  return {
    schema_version: 1,
    document_type: 'emate.desktop-update-reader-attestation',
    status: 'passed',
    endpoint: ENDPOINT,
    reader: {
      source_mode: sourceMode,
      current_version: currentVersion,
      installer: { url: installer.href, bytes: installerBytes, sha256: installerSha256 },
      module: { bytes: readerBytes.byteLength, sha256: digest(readerBytes) },
    },
    manifest: {
      schema_version: manifest.schema_version,
      version: manifest.version,
      source_commit: manifest.source_commit,
      bytes: manifestBytes.byteLength,
      sha256: digest(manifestBytes),
      signing_context: 'e-mate-desktop-release-manifest-v2\0',
    },
    outcome: {
      status: outcome.status,
      current_version: outcome.currentVersion,
      latest_version: outcome.latestVersion,
    },
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values } = parseArgs({
    options: {
      reader: { type: 'string' }, manifest: { type: 'string' }, 'base-contract': { type: 'string' },
      'source-mode': { type: 'string' }, 'current-version': { type: 'string' },
      'expected-status': { type: 'string' }, 'installer-url': { type: 'string' },
      'installer-bytes': { type: 'string' }, 'installer-sha256': { type: 'string' }, output: { type: 'string' },
    },
    strict: true,
  })
  if (Object.values(values).some(value => value === undefined)) {
    throw new Error('bundled Reader attestation requires every named input')
  }
  const result = await attestBundledUpdateReader({
    readerPath: values.reader,
    manifestPath: values.manifest,
    baseContractPath: values['base-contract'],
    sourceMode: values['source-mode'],
    currentVersion: values['current-version'],
    expectedStatus: values['expected-status'],
    installerUrl: values['installer-url'],
    installerBytes: Number(values['installer-bytes']),
    installerSha256: values['installer-sha256'],
  })
  await writeFile(values.output, `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
}
