import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  createSigningControlBundle,
  extractSigningControlBundle,
  inspectSigningControlBundle,
} from './signing-control-bundle.mjs'

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')

async function approved(root, path, classification) {
  const bytes = await readFile(join(root, ...path.split('/')))
  return { path, classification, bytes: bytes.byteLength, sha256: sha256(bytes) }
}

async function temporary() {
  return mkdtemp(join(tmpdir(), 'emate-signing-control-'))
}

test('signing control bundle is deterministic, streaming, and exact-set extracted', async t => {
  const root = await temporary()
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, 'manifest-inputs/components'), { recursive: true })
  await writeFile(join(root, 'run.json'), '{"run":"exact"}\n')
  await writeFile(join(root, 'manifest-inputs/components/payload.bin'), Buffer.alloc(8 * 1024 * 1024, 0x5a))
  const metadata = {
    schema_version: 1,
    document_type: 'emate.local-protected-signer-control-input',
    run_id: '20260831T120000Z-aaaaaaaaaaaa-abcdef',
    source_commit: 'a'.repeat(40),
  }
  const files = [
    await approved(root, 'manifest-inputs/components/payload.bin', 'future-public-profile-byte'),
    await approved(root, 'run.json', 'redacted-local-flow-control'),
  ]
  const first = join(root, 'first.bundle')
  const second = join(root, 'second.bundle')
  const one = await createSigningControlBundle({ root, output: first, metadata, files })
  const two = await createSigningControlBundle({ root, output: second, metadata, files: [...files].reverse() })
  assert.deepEqual(one, two)
  assert.equal(sha256(await readFile(first)), sha256(await readFile(second)))
  const inspected = await inspectSigningControlBundle(first)
  assert.deepEqual(inspected, one.manifest)
  const output = join(root, 'expanded')
  const expanded = await extractSigningControlBundle(first, output)
  assert.deepEqual(expanded, one.manifest)
  assert.equal((await readFile(join(output, 'manifest-inputs/components/payload.bin'))).byteLength, 8 * 1024 * 1024)
  assert.deepEqual(JSON.parse(await readFile(join(output, 'signing-control-manifest.json'), 'utf8')), one.manifest)
})

test('signing control bundle rejects links, unsafe paths, drift, and trailing bytes', async t => {
  const root = await temporary()
  t.after(() => rm(root, { recursive: true, force: true }))
  await writeFile(join(root, 'safe.json'), '{"safe":true}\n')
  await symlink(join(root, 'safe.json'), join(root, 'linked.json'))
  await mkdir(join(root, 'outside'))
  await writeFile(join(root, 'outside', 'payload.json'), '{"outside":true}\n')
  await symlink(join(root, 'outside'), join(root, 'linked-dir'))
  const metadata = {
    schema_version: 1,
    document_type: 'emate.local-protected-signer-control-input',
    run_id: '20260831T120000Z-aaaaaaaaaaaa-abcdef',
    source_commit: 'a'.repeat(40),
  }
  const safe = await approved(root, 'safe.json', 'redacted-local-flow-control')
  await assert.rejects(createSigningControlBundle({
    root, output: join(root, 'linked.bundle'), metadata,
    files: [{ ...safe, path: 'linked.json' }],
  }), /regular file|symbolic link|canonical root/u)
  await assert.rejects(createSigningControlBundle({
    root, output: join(root, 'linked-directory.bundle'), metadata,
    files: [{ ...safe, path: 'linked-dir/payload.json' }],
  }), /ancestor|canonical root/u)
  for (const path of ['../safe.json', '/safe.json', 'nested\\safe.json', 'nested/./safe.json', 'unsafe path.json']) {
    await assert.rejects(createSigningControlBundle({
      root, output: join(root, 'unsafe.bundle'), metadata,
      files: [{ ...safe, path }],
    }), /path/u)
  }
  await assert.rejects(createSigningControlBundle({
    root, output: join(root, 'duplicate.bundle'), metadata,
    files: [
      safe,
      safe,
    ],
  }), /duplicate/u)

  await writeFile(join(root, 'safe.json'), '{"evil":true}\n')
  await assert.rejects(createSigningControlBundle({
    root, output: join(root, 'identity-drift.bundle'), metadata, files: [safe],
  }), /approved public-safe identity/u)
  await writeFile(join(root, 'safe.json'), '{"safe":true}\n')

  const bundle = join(root, 'valid.bundle')
  await createSigningControlBundle({
    root, output: bundle, metadata, files: [safe],
  })
  const original = await readFile(bundle)
  const drifted = Buffer.from(original)
  drifted[drifted.length - 2] ^= 1
  await writeFile(join(root, 'drifted.bundle'), drifted)
  await assert.rejects(extractSigningControlBundle(join(root, 'drifted.bundle'), join(root, 'drifted')), /digest/u)
  await writeFile(join(root, 'trailing.bundle'), Buffer.concat([original, Buffer.from('x')]))
  await assert.rejects(inspectSigningControlBundle(join(root, 'trailing.bundle')), /size|trailing/u)
})
