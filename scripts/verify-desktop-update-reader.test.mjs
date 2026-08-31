import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { attestBundledUpdateReader } from './verify-desktop-update-reader.mjs'

test('actual bundled Reader contract must accept the final signed feed and return the planned comparison', async () => {
  const root = await mkdtemp(join(tmpdir(), 'emate-reader-attestation-'))
  try {
    const reader = join(root, 'update-checker.js')
    const manifest = join(root, 'desktop-release-signed.json')
    const base = join(root, 'base-contract.json')
    await writeFile(reader, `
      export const DESKTOP_VERSION_ENDPOINT = 'https://pub-ada3f610c0234a76838f4e19fe2bb25e.r2.dev/desktop/signed/latest.json'
      export const validateAdmittedDesktopReleaseManifest = (value, keys) => value.schema_version === 2 && keys.length === 1
      export async function checkForStableUpdate(options) {
        const value = await (await options.request(DESKTOP_VERSION_ENDPOINT, { method: 'GET', redirect: 'error' })).json()
        return { status: value.version === options.currentVersion ? 'up-to-date' : 'update-available',
          currentVersion: options.currentVersion, latestVersion: value.version }
      }
    `)
    await writeFile(manifest, `${JSON.stringify({ schema_version: 2, version: '2.0.16', source_commit: 'a'.repeat(40) })}\n`)
    await writeFile(base, `${JSON.stringify({ schedule_protocol_floor: 1, profile_signing_keys: [{ id: 'key' }] })}\n`)
    const input = {
      readerPath: reader, manifestPath: manifest, baseContractPath: base,
      sourceMode: 'public-predecessor', currentVersion: '2.0.15', expectedStatus: 'update-available',
      installerUrl: 'https://pub-ada3f610c0234a76838f4e19fe2bb25e.r2.dev/desktop/releases/v2.0.15/a/e-Mate-2.0.15-mac-universal.dmg',
      installerBytes: 1, installerSha256: 'b'.repeat(64),
    }
    const receipt = await attestBundledUpdateReader(input)
    assert.equal(receipt.status, 'passed')
    assert.equal(receipt.outcome.status, 'update-available')
    await assert.rejects(attestBundledUpdateReader({ ...input, expectedStatus: 'up-to-date' }), /expected up-to-date/u)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
