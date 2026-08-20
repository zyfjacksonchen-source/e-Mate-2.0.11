import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  materializeProfileComponent,
  parseProfileComponentManifest,
  verifyMaterializedProfileComponent,
} from '../src/profile-component.ts'
import type { ProfileBaseContract, ProfileReleaseComponent } from '../src/profile-release.ts'

const base: ProfileBaseContract = {
  schema_version: 1,
  id: 'e-mate-desktop-profile-v2-dsh-2bc16230975f',
  desktop_api: 1,
  profile_format: 1,
  harness_version: '0.1.0-rc.7',
  harness_commit: '2bc16230975f6cf02aa1b283b1f86de44007b059',
  runtime_imports: {},
  profile_signing_keys: [],
}
const sourceCommit = 'a'.repeat(40)
const packageValue = {
  name: '@e-mate/dsh-plugin-memory-evolve',
  version: '2.0.11',
  license: 'MIT',
  main: 'index.js',
  files: ['index.js'],
  dsh: { bundle: { patch: './cordis.patch.yml' } },
  eMate: {
    component: {
      schema_version: 1,
      id: '@e-mate/dsh-plugin-memory-evolve',
      kind: 'profile',
      base_imports: [],
      authority_contract: { effects: ['persistent-state'], guards: ['native-user-question'] },
      base_contracts: [base.id],
    },
  },
}
const payloadFiles = new Map<string, Buffer>([
  ['index.js', Buffer.from('export default class Memory {}\n')],
  ['package.json', Buffer.from(`${JSON.stringify(packageValue, null, 2)}\n`)],
])

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function fixture(options: {
  extraFiles?: ReadonlyMap<string, Buffer>
  target?: ProfileReleaseComponent['target']
} = {}): { reference: ProfileReleaseComponent, objects: Map<string, Buffer> } {
  const target = options.target ?? null
  const kind = target === null ? 'profile' : 'platform-profile'
  const packageJson = {
    ...packageValue,
    eMate: { component: { ...packageValue.eMate.component, kind } },
  }
  const payload = new Map(payloadFiles)
  payload.set('package.json', Buffer.from(`${JSON.stringify(packageJson, null, 2)}\n`))
  for (const [path, bytes] of options.extraFiles ?? []) payload.set(path, bytes)
  const files = [...payload].map(([path, bytes]) => ({
    path,
    bytes: bytes.byteLength,
    sha256: sha256(bytes),
    mode: '0644' as const,
  })).sort((left, right) => left.path.localeCompare(right.path))
  const manifest = Buffer.from(`${JSON.stringify({
    schema_version: 1,
    id: packageValue.name,
    slug: 'dsh-plugin-memory-evolve',
    version: packageValue.version,
    kind,
    target,
    source_commit: sourceCommit,
    base_contracts: [base.id],
    base_imports: [],
    authority_contract: packageValue.eMate.component.authority_contract,
    harness_contract: { version: base.harness_version, commit: base.harness_commit },
    package_entry: packageValue.main,
    dsh: packageValue.dsh,
    total_bytes: files.reduce((sum, file) => sum + file.bytes, 0),
    files,
  }, null, 2)}\n`)
  const targetPath = target === null ? '' : `/${target.platform}-${target.arch}`
  const manifestUrl = `https://pub-ada3f610c0234a76838f4e19fe2bb25e.r2.dev/desktop/profile/components/dsh-plugin-memory-evolve/v2.0.11/${sourceCommit}${targetPath}/manifest.json`
  return {
    reference: {
      id: packageValue.name,
      version: packageValue.version,
      kind,
      target,
      profile_path: 'node_modules/@e-mate/dsh-plugin-memory-evolve',
      manifest_url: manifestUrl,
      manifest_bytes: manifest.byteLength,
      manifest_sha256: sha256(manifest),
      manifest_source_commit: sourceCommit,
    },
    objects: new Map([
      [manifestUrl, manifest],
      ...[...payload].map(([path, bytes]) => [`${new URL('.', manifestUrl).href}files/${path}`, bytes] as const),
    ]),
  }
}

const temporary: string[] = []
afterEach(async () => {
  await Promise.all(temporary.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe('Profile component materialization', () => {
  it('accepts only the signed component authority vocabulary', () => {
    const { reference, objects } = fixture()
    const manifestBytes = objects.get(reference.manifest_url)!
    expect(parseProfileComponentManifest(manifestBytes, reference, base)?.authority_contract).toEqual({
      effects: ['persistent-state'],
      guards: ['native-user-question'],
    })
    const manifest = JSON.parse(manifestBytes.toString())
    manifest.authority_contract.effects = ['filesystem-root']
    expect(parseProfileComponentManifest(Buffer.from(JSON.stringify(manifest)), reference, base)).toBeUndefined()
  })

  it('rejects native binaries and wheels in portable components and outside a platform closure', async () => {
    const elf = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00])
    const portableRoot = await mkdtemp(join(tmpdir(), 'e-mate-portable-native-'))
    temporary.push(portableRoot)
    const portable = fixture({ extraFiles: new Map([['hidden/native.so', elf]]) })
    await expect(materializeProfileComponent({
      destination: join(portableRoot, 'component'),
      reference: portable.reference,
      base,
      request: async url => {
        const bytes = portable.objects.get(url)
        return bytes === undefined ? new Response(null, { status: 404 }) : new Response(Uint8Array.from(bytes).buffer)
      },
    })).rejects.toThrow('portable component contains a native binary')

    const portableWheelRoot = await mkdtemp(join(tmpdir(), 'e-mate-portable-wheel-'))
    temporary.push(portableWheelRoot)
    const portableWheel = fixture({ extraFiles: new Map([['runtime/wheels/native.whl', Buffer.from('PK\u0003\u0004')]]) })
    await expect(materializeProfileComponent({
      destination: join(portableWheelRoot, 'component'),
      reference: portableWheel.reference,
      base,
      request: async url => {
        const bytes = portableWheel.objects.get(url)
        return bytes === undefined ? new Response(null, { status: 404 }) : new Response(Uint8Array.from(bytes).buffer)
      },
    })).rejects.toThrow('portable component contains a platform wheel')

    const pe = Buffer.alloc(68)
    pe.write('MZ', 0, 'ascii')
    pe.writeUInt32LE(64, 0x3c)
    pe.set([0x50, 0x45, 0x00, 0x00], 64)
    const target = {
      platform: 'win32' as const,
      arch: 'x64' as const,
      runtime_abi: 'cpython-3.12',
      minimum_os: '10.0',
      signing: { scheme: 'unsigned' as const, identity: 'none' },
      native_paths: ['runtime/vendor-native/win32-x64'],
    }
    const platformRoot = await mkdtemp(join(tmpdir(), 'e-mate-platform-native-'))
    temporary.push(platformRoot)
    const platform = fixture({
      target,
      extraFiles: new Map([
        ['runtime/vendor-native/win32-x64/runtime.dll', pe],
        ['hidden/escaped.dll', pe],
      ]),
    })
    await expect(materializeProfileComponent({
      destination: join(platformRoot, 'component'),
      reference: platform.reference,
      base,
      platform: 'win32',
      arch: 'x64',
      request: async url => {
        const bytes = platform.objects.get(url)
        return bytes === undefined ? new Response(null, { status: 404 }) : new Response(Uint8Array.from(bytes).buffer)
      },
    })).rejects.toThrow('component native binary escaped its declared closure')
  })

  it('rejects a platform manifest selected for another runtime target', () => {
    const { reference, objects } = fixture()
    const manifest = JSON.parse(objects.get(reference.manifest_url)!.toString())
    const target = {
      platform: 'win32' as const,
      arch: 'x64' as const,
      runtime_abi: 'none',
      minimum_os: '10.0',
      signing: { scheme: 'unsigned' as const, identity: 'none' },
      native_paths: [],
    }
    const bytes = Buffer.from(`${JSON.stringify({ ...manifest, kind: 'platform-profile', target })}\n`)
    const platformReference: ProfileReleaseComponent = {
      ...reference,
      kind: 'platform-profile',
      target,
    }
    expect(parseProfileComponentManifest(bytes, platformReference, base)?.target).toEqual(target)
    expect(parseProfileComponentManifest(bytes, {
      ...platformReference,
      target: { ...target, platform: 'darwin', arch: 'arm64', minimum_os: '13.0', signing: { scheme: 'adhoc', identity: 'adhoc' } },
    }, base)).toBeUndefined()
  })

  it.runIf(process.platform === 'darwin' && ['arm64', 'x64'].includes(process.arch))(
    'verifies the target native closure and ad-hoc signature before committing it',
    async () => {
      const root = await mkdtemp(join(tmpdir(), 'e-mate-platform-component-'))
      temporary.push(root)
      const id = '@e-mate/dsh-plugin-computer-use'
      const targetName = `darwin-${process.arch}`
      const nativePath = 'native/macos/bin/dsh-computer-use-helper'
      const nativeBytes = await readFile(new URL(`../../../packages/dsh-plugin-computer-use/${nativePath}`, import.meta.url))
      const indexBytes = Buffer.from('export default class ComputerUse {}\n')
      const dsh = { bundle: { patch: './cordis.patch.yml' } }
      const target = {
        platform: 'darwin' as const,
        arch: process.arch as 'arm64' | 'x64',
        runtime_abi: 'macos-computer-use-helper-v1',
        minimum_os: '14.0',
        signing: { scheme: 'adhoc' as const, identity: 'adhoc' },
        native_paths: ['native/macos'],
      }
      const packageBytes = Buffer.from(`${JSON.stringify({
        name: id,
        version: '2.0.11',
        license: 'MIT',
        main: 'index.mjs',
        dsh,
        eMate: { component: { schema_version: 1, id, kind: 'platform-profile', base_imports: [], authority_contract: { effects: [], guards: [] }, base_contracts: [base.id] } },
      }, null, 2)}\n`)
      const payload = new Map<string, { bytes: Buffer, mode: '0644' | '0755' }>([
        ['index.mjs', { bytes: indexBytes, mode: '0644' }],
        [nativePath, { bytes: nativeBytes, mode: '0755' }],
        ['package.json', { bytes: packageBytes, mode: '0644' }],
      ])
      const files = [...payload].map(([path, file]) => ({
        path,
        bytes: file.bytes.byteLength,
        sha256: sha256(file.bytes),
        mode: file.mode,
      })).sort((left, right) => left.path.localeCompare(right.path))
      const manifestBytes = Buffer.from(`${JSON.stringify({
        schema_version: 1,
        id,
        slug: 'dsh-plugin-computer-use',
        version: '2.0.11',
        kind: 'platform-profile',
        target,
        source_commit: sourceCommit,
        base_contracts: [base.id],
        base_imports: [],
        authority_contract: { effects: [], guards: [] },
        harness_contract: { version: base.harness_version, commit: base.harness_commit },
        package_entry: 'index.mjs',
        dsh,
        total_bytes: files.reduce((sum, file) => sum + file.bytes, 0),
        files,
      }, null, 2)}\n`)
      const manifestUrl = `https://pub-ada3f610c0234a76838f4e19fe2bb25e.r2.dev/desktop/profile/components/dsh-plugin-computer-use/v2.0.11/${sourceCommit}/${targetName}/manifest.json`
      const reference: ProfileReleaseComponent = {
        id,
        version: '2.0.11',
        kind: 'platform-profile',
        target,
        profile_path: `node_modules/${id}`,
        manifest_url: manifestUrl,
        manifest_bytes: manifestBytes.byteLength,
        manifest_sha256: sha256(manifestBytes),
        manifest_source_commit: sourceCommit,
      }
      const objects = new Map<string, Buffer>([
        [manifestUrl, manifestBytes],
        ...[...payload].map(([path, file]) => [`${new URL('.', manifestUrl).href}files/${path}`, file.bytes] as const),
      ])
      const installed = await materializeProfileComponent({
        destination: join(root, 'component'),
        reference,
        base,
        platform: 'darwin',
        arch: process.arch,
        request: async url => {
          const bytes = objects.get(url)
          return bytes === undefined ? new Response(null, { status: 404 }) : new Response(Uint8Array.from(bytes).buffer)
        },
      })
      expect(installed.target).toEqual(target)
    },
  )

  it('persists the exact manifest and re-verifies the complete cached file set', async () => {
    const root = await mkdtemp(join(tmpdir(), 'e-mate-component-'))
    temporary.push(root)
    const destination = join(root, 'component')
    const { reference, objects } = fixture()
    const request = async (url: string): Promise<Response> => {
      const bytes = objects.get(url)
      return bytes === undefined
        ? new Response(null, { status: 404 })
        : new Response(Uint8Array.from(bytes).buffer, { status: 200, headers: { 'content-length': String(bytes.byteLength) } })
    }

    const installed = await materializeProfileComponent({ destination, reference, base, request })
    await expect(verifyMaterializedProfileComponent({ directory: destination, reference, base }))
      .resolves.toEqual(installed)
    expect(await readFile(join(destination, '.e-mate-component-manifest.json'))).toHaveLength(reference.manifest_bytes)

    await writeFile(join(destination, 'index.js'), 'tampered\n')
    await expect(verifyMaterializedProfileComponent({ directory: destination, reference, base }))
      .rejects.toThrow('file identity mismatch: index.js')
  })

  it('rejects files that were not signed into the component manifest', async () => {
    const root = await mkdtemp(join(tmpdir(), 'e-mate-component-'))
    temporary.push(root)
    const destination = join(root, 'component')
    const { reference, objects } = fixture()
    await materializeProfileComponent({
      destination,
      reference,
      base,
      request: async (url) => {
        const bytes = objects.get(url)
        return bytes === undefined
          ? new Response(null, { status: 404 })
          : new Response(Uint8Array.from(bytes).buffer, { status: 200 })
      },
    })
    await writeFile(join(destination, 'injected.js'), 'export default 1\n')

    await expect(verifyMaterializedProfileComponent({ directory: destination, reference, base }))
      .rejects.toThrow('file set is not exact')
  })
})
