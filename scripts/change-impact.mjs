#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { appendFileSync, readFileSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  parseProfileReleaseEnvelope,
  sameProfileReleaseTarget,
  selectProfileRelease,
} from '../desktop/e-mate-desktop/src/profile-release.ts'
import { HARNESS_COMMIT } from './harness-provenance.mjs'

export const BASE_CONTRACT_PATH = 'desktop/e-mate-desktop/base-contract.json'
export const BASE_CONTRACT_ID = `e-mate-desktop-profile-v9-dsh-${HARNESS_COMMIT.slice(0, 12)}`
export const ACCEPTED_PREDECESSOR = '6a7f4b9d59a1d8970345638946fb6564e2f5f93e'
export const PRODUCT_UI_REFERENCE = Object.freeze({
  repository: 'zyfjacksonchen-source/ECoreX',
  path: 'upstream/e-mate-2.0.5',
  commit: '564a6b6c1d43fb6831dd4a5cd8026e472f063311',
})
const SHELL_COMPONENT_ROOT = 'packages/dsh/profile/plugins/emate-shell'
const COMPONENT_INVENTORY_PATH = 'packages/dsh/profile/component-inventory.json'
const PROFILE_CURRENT_SNAPSHOT_PATH = 'artifacts/release/profile-current-snapshot.json'
const MAX_CURRENT_PROFILE_BYTES = 1024 * 1024
const STABLE_VERSION = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/u
const PACKAGE_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u
const BASE_RUNTIME_PACKAGE = /^(?:@deepseek-ai\/[a-z0-9][a-z0-9._-]*|@e-mate\/desktop\/vision-toolkit|react(?:-dom)?)$/u
const SHA40 = /^[0-9a-f]{40}$/u
const PLATFORM_TARGETS = ['darwin-arm64', 'darwin-x64', 'win32-x64']
const TARGET_RUNNERS = new Map([
  ['darwin-arm64', 'macos-15'],
  ['darwin-x64', 'macos-15-intel'],
  ['win32-x64', 'windows-2025'],
])
const COMPONENT_AUTHORITY_EFFECTS = new Set([
  'browser-control',
  'browser-read',
  'credentials-read',
  'credentials-write',
  'desktop-restart',
  'filesystem-read',
  'filesystem-write',
  'host-plugin-install',
  'network-loopback',
  'network-remote',
  'os-accessibility',
  'os-input-control',
  'os-screen-recording',
  'persistent-state',
  'skill-lifecycle',
  'subprocess',
])
const COMPONENT_AUTHORITY_GUARDS = new Set([
  'atomic-receipt',
  'authenticated-identity',
  'enterprise-policy',
  'explicit-user-action',
  'fixed-catalog',
  'fixed-endpoint',
  'native-approval',
  'native-user-question',
  'os-tcc',
  'plugin-settings-grant',
  'read-only',
  'sandbox-policy',
  'session-scope',
  'workspace-scope',
])

export function harnessVersionsFromComponentLock(lock) {
  return new Set([...lock.matchAll(
    /@deepseek-ai\/dsh(?:-[a-z0-9._-]+)?@(?:npm:)?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/gu,
  )].map(match => match[1]))
}

const BASE_PATHS = [
  '.github/workflows/desktop-release.yml',
  '.github/workflows/ci.yml',
  '.github/workflows/profile-release.yml',
  '.github/workflows/release.yml',
  '.gitmodules',
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'desktop/package.json',
  'desktop/yarn.lock',
  'desktop/.yarnrc.yml',
  BASE_CONTRACT_PATH,
]

const BASE_PREFIXES = [
  'desktop/e-mate-desktop/',
  'packages/dsh/',
  'scripts/',
  'upstream/',
]

const VERIFICATION_PATHS = new Set([
  '.gitignore',
  'AGENTS.md',
  'docs/target-contract.md',
  'scripts/change-impact.test.mjs',
  'scripts/component-release.test.mjs',
  'scripts/profile-release.test.mjs',
  'scripts/publish-profile-r2.test.mjs',
])
const IMPACT_DIMENSIONS = [
  'shared_runtime',
  'profile',
  'macos_runtime',
  'macos_packaging',
  'windows_runtime',
  'windows_packaging',
  'enterprise',
  'release_verifier',
]
const PACKAGING_SHARED_PATHS = new Set([
  'desktop/package.json',
  'desktop/yarn.lock',
  'desktop/.yarnrc.yml',
  'desktop/e-mate-desktop/package.json',
])
const RELEASE_VERIFIER_PREFIXES = [
  '.github/workflows/',
  'artifacts/',
  'scripts/',
]

function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function acceptedProfileIsCompatible(root, base) {
  try {
    const snapshot = JSON.parse(readFileSync(join(root, PROFILE_CURRENT_SNAPSHOT_PATH), 'utf8'))
    if (!record(snapshot.targets)) return false
    for (const name of PLATFORM_TARGETS) {
      const entry = snapshot.targets[name]
      if (!record(entry) || entry.status !== 'present' || typeof entry.content_base64 !== 'string') return false
      const bytes = Buffer.from(entry.content_base64, 'base64')
      if (bytes.byteLength === 0 || bytes.byteLength > MAX_CURRENT_PROFILE_BYTES
        || bytes.toString('base64') !== entry.content_base64) return false
      const release = parseProfileReleaseEnvelope(bytes, base, MAX_CURRENT_PROFILE_BYTES)
      const [platform, arch] = name.split('-')
      if (release === undefined || !sameProfileReleaseTarget(release.payload.target, { platform, arch })
        || selectProfileRelease(release.payload, base, 0) === 'base-required') return false
    }
    return true
  } catch {
    return false
  }
}

function parsePlatformTargets(value) {
  if (!Array.isArray(value) || value.length !== PLATFORM_TARGETS.length) {
    throw new Error('platform component targets are incomplete')
  }
  const targets = value.map(target => {
    if (!record(target) || !exactKeys(target, [
      'platform', 'arch', 'runtime_abi', 'minimum_os', 'signing', 'native_paths',
    ]) || !['darwin', 'win32'].includes(target.platform)
      || !['arm64', 'x64'].includes(target.arch)
      || typeof target.runtime_abi !== 'string' || !/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u.test(target.runtime_abi)
      || typeof target.minimum_os !== 'string' || !/^[0-9]+\.[0-9]+$/u.test(target.minimum_os)
      || !record(target.signing) || !exactKeys(target.signing, ['scheme', 'identity'])
      || !['adhoc', 'unsigned'].includes(target.signing.scheme)
      || typeof target.signing.identity !== 'string' || target.signing.identity === ''
      || !Array.isArray(target.native_paths)
      || target.native_paths.some(path => !safeFilesEntry(path))
      || target.native_paths.some((path, index) => index > 0 && target.native_paths[index - 1] >= path)) {
      throw new Error('platform component target is invalid')
    }
    if (target.platform === 'darwin' && target.signing.scheme !== 'adhoc'
      || target.platform === 'win32' && target.signing.scheme !== 'unsigned'
      || target.signing.scheme === 'adhoc' && target.signing.identity !== 'adhoc'
      || target.signing.scheme === 'unsigned' && target.signing.identity !== 'none'
      || target.runtime_abi === 'none' && target.native_paths.length !== 0
      || target.runtime_abi !== 'none' && target.native_paths.length === 0) {
      throw new Error('platform component signing contract is invalid')
    }
    return {
      platform: target.platform,
      arch: target.arch,
      runtime_abi: target.runtime_abi,
      minimum_os: target.minimum_os,
      signing: { scheme: target.signing.scheme, identity: target.signing.identity },
      native_paths: [...target.native_paths],
    }
  })
  const keys = targets.map(target => `${target.platform}-${target.arch}`)
  if (keys.some((key, index) => key !== PLATFORM_TARGETS[index])) {
    throw new Error('platform component targets must cover the supported Desktop matrix in stable order')
  }
  return targets
}

function exactKeys(value, expected) {
  const actual = Object.keys(value).sort()
  const wanted = [...expected].sort()
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index])
}

function safeFilesEntry(value) {
  return typeof value === 'string'
    && value !== ''
    && !value.includes('\0')
    && !isAbsolute(value)
    && !value.split(/[\\/]/u).includes('..')
}

function safePackageEntry(value) {
  return safeFilesEntry(value)
    && !value.includes('\\')
    && value.split('/').every(segment => segment !== '' && segment !== '.')
}

function sortedUniqueStrings(value) {
  return Array.isArray(value)
    && value.every(item => typeof item === 'string' && item !== '')
    && value.every((item, index) => index === 0 || value[index - 1] < item)
}

function parseAuthorityContract(value) {
  if (!record(value) || !exactKeys(value, ['effects', 'guards'])
    || !sortedUniqueStrings(value.effects) || !sortedUniqueStrings(value.guards)
    || value.effects.some(effect => !COMPONENT_AUTHORITY_EFFECTS.has(effect))
    || value.guards.some(guard => !COMPONENT_AUTHORITY_GUARDS.has(guard))) return
  return { effects: [...value.effects], guards: [...value.guards] }
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function trackedGitlinkCommit(root, path) {
  const row = execFileSync('git', ['ls-files', '-s', '--', path], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 4096,
  }).trim()
  const match = /^160000 ([0-9a-f]{40}) 0\t(.+)$/u.exec(row)
  if (match === null || match[2] !== path) throw new Error(`${path} must be one tracked Git submodule`)
  return match[1]
}

function normalizePath(path) {
  if (typeof path !== 'string') throw new Error('changed path must be a string')
  const normalized = path.replaceAll('\\', '/').replace(/^\.\//u, '')
  if (normalized === '' || normalized.includes('\0') || normalized.startsWith('/')
    || normalized.split('/').includes('..')) {
    throw new Error(`invalid changed path: ${JSON.stringify(path)}`)
  }
  return normalized
}

function componentInventory(root) {
  const value = readJson(join(root, COMPONENT_INVENTORY_PATH))
  if (!record(value) || value.schema_version !== 1 || !Array.isArray(value.components)
    || value.components.length === 0 || Object.keys(value).some(key => !['schema_version', 'components'].includes(key))) {
    throw new Error('component inventory is invalid')
  }
  const components = value.components.map(entry => {
    const sourceRoots = entry.source_roots ?? []
    if (!record(entry)
      || typeof entry.id !== 'string'
      || typeof entry.root !== 'string' || !safeFilesEntry(entry.root)
      || !Array.isArray(sourceRoots) || sourceRoots.length > 1
      || sourceRoots.some(path => !safeFilesEntry(path) || !path.startsWith('upstream/plugins/'))
      || !['profile', 'platform-profile'].includes(entry.kind)
      || !['hot-profile', 'platform-profile', 'blocked'].includes(entry.desktop)
      || typeof entry.cli !== 'boolean'
      || entry.desktop === 'hot-profile' && entry.kind !== 'profile'
      || entry.desktop === 'platform-profile' && entry.kind !== 'platform-profile') {
      throw new Error('component inventory entry is invalid')
    }
    const expectedKeys = [
      'id', 'root', 'kind', 'desktop', 'cli',
      ...(entry.source_roots === undefined ? [] : ['source_roots']),
      ...(entry.kind === 'platform-profile' ? ['targets'] : []),
    ]
    if (!exactKeys(entry, expectedKeys)) throw new Error('component inventory entry is invalid')
    const targets = entry.kind === 'platform-profile' ? parsePlatformTargets(entry.targets) : []
    const expectedRoot = entry.id === '@e-mate/dsh-client-shell'
      ? SHELL_COMPONENT_ROOT
      : `packages/${entry.id.replace(/^@e-mate\//u, '')}`
    if (entry.root !== expectedRoot) throw new Error(`component inventory root mismatch: ${entry.id}`)
    return { ...entry, source_roots: [...sourceRoots], targets }
  }).sort((left, right) => left.id.localeCompare(right.id))
  const ownedRoots = components.flatMap(component => [component.root, ...component.source_roots])
  if (new Set(components.map(component => component.id)).size !== components.length
    || new Set(ownedRoots).size !== ownedRoots.length) {
    throw new Error('component inventory identities must be unique')
  }
  return components
}

function validateBaseContract(value) {
  const errors = []
  if (!record(value)) return ['base contract must be an object']
  if (!exactKeys(value, [
    'schema_version', 'id', 'desktop_api', 'profile_format', 'schedule_protocol_floor', 'desktop_reference',
    'harness_version', 'harness_commit', 'runtime_imports', 'profile_signing_keys',
  ])) errors.push('base contract fields are invalid')
  if (value.schema_version !== 1) errors.push('base contract schema_version must be 1')
  if (value.id !== BASE_CONTRACT_ID) errors.push(`base contract id must equal ${BASE_CONTRACT_ID}`)
  if (value.desktop_api !== 1) errors.push('base contract desktop_api must be 1')
  if (value.profile_format !== 1) errors.push('base contract profile_format must be 1')
  if (value.schedule_protocol_floor !== 1) errors.push('base contract schedule_protocol_floor must be 1')
  const reference = record(value.desktop_reference) ? value.desktop_reference : {}
  if (reference.repository !== 'anywhere-labs/deepseek-harness-desktop'
    || reference.commit !== '6074088f5b660206e404b3591fab51fb99c69add'
    || reference.harness_repository !== 'deepseek-ai/deepseek-harness'
    || reference.harness_commit !== '99f6f02fecdb7dff40c3fbc9470f5907c29f74ca'
    || reference.harness_version !== '0.1.0-rc.7') {
    errors.push('base contract Desktop rc.7 reference drifted')
  }
  if (value.harness_version !== '0.1.0-rc.7') errors.push('base contract Harness version drifted')
  if (value.harness_commit !== HARNESS_COMMIT) {
    errors.push('base contract Harness commit drifted')
  }
  const runtimeImports = record(value.runtime_imports) ? Object.entries(value.runtime_imports) : []
  if (!record(value.runtime_imports)
    || runtimeImports.some(([name, version]) => !BASE_RUNTIME_PACKAGE.test(name)
      || typeof version !== 'string' || !PACKAGE_VERSION.test(version))
    || runtimeImports.some(([name], index) => index > 0 && runtimeImports[index - 1][0] >= name)) {
    errors.push('base contract runtime imports are invalid')
  }
  if (!Array.isArray(value.profile_signing_keys) || value.profile_signing_keys.length === 0
    || value.profile_signing_keys.some(key => !record(key)
      || typeof key.id !== 'string' || !/^[0-9a-f]{16}$/u.test(key.id)
      || key.algorithm !== 'ed25519'
      || typeof key.public_key_spki_der_base64 !== 'string'
      || !/^MCowBQYDK2VwAyEA[A-Za-z0-9+/]{43}=$/u.test(key.public_key_spki_der_base64))
    || new Set(value.profile_signing_keys.map(key => key.id)).size !== value.profile_signing_keys.length) {
    errors.push('base contract profile signing keys are invalid')
  }
  return errors
}

function validateComponent(root, inventory, baseContract, desktopDependencies) {
  const errors = []
  const componentRoot = inventory.root
  let manifest
  try {
    manifest = readJson(join(root, componentRoot, 'package.json'))
  } catch (cause) {
    return { root: componentRoot, errors: [`package.json cannot be read: ${cause instanceof Error ? cause.message : String(cause)}`] }
  }
  const slug = componentRoot === SHELL_COMPONENT_ROOT
    ? 'shell'
    : componentRoot.slice('packages/dsh-plugin-'.length)
  const expectedName = inventory.id
  if (manifest.name !== expectedName) errors.push(`package name must be ${expectedName}`)
  if (typeof manifest.version !== 'string' || !STABLE_VERSION.test(manifest.version)) {
    errors.push('package version must be stable SemVer')
  }
  if (manifest.license !== 'MIT') errors.push('package license must be MIT')
  if (!record(manifest.eMate) || manifest.eMate.harnessVersion !== baseContract.harness_version) {
    errors.push(`component Harness ABI must equal ${String(baseContract.harness_version)}`)
  }
  if (!record(manifest.eMate) || manifest.eMate.harnessCommit !== baseContract.harness_commit) {
    errors.push(`component Harness commit must equal ${String(baseContract.harness_commit)}`)
  }
  if (!Array.isArray(manifest.files) || manifest.files.length === 0 || manifest.files.some(value => !safeFilesEntry(value))) {
    errors.push('package files must be a non-empty safe allowlist')
  }
  if (inventory.desktop !== 'blocked' && !manifest.files?.includes('pnpm-lock.yaml')) {
    errors.push('component package files must bind its independent pnpm-lock.yaml')
  } else if (inventory.desktop !== 'blocked') {
    try {
      const lock = readFileSync(join(root, componentRoot, 'pnpm-lock.yaml'), 'utf8')
      if (!/^lockfileVersion: '9\.0'$/mu.test(lock)) {
        errors.push('component pnpm lock is invalid')
      } else if (/^\s+(?:specifier|version):\s*(?:file:|link:|workspace:)/mu.test(lock)) {
        errors.push('component pnpm lock must not reference a local or workspace dependency')
      } else if ([...harnessVersionsFromComponentLock(lock)].some(version => version !== baseContract.harness_version)) {
        errors.push(`component pnpm lock DSH packages must equal ${String(baseContract.harness_version)}`)
      }
    } catch (cause) {
      errors.push(`component pnpm lock cannot be read: ${cause instanceof Error ? cause.message : String(cause)}`)
    }
  }
  if (!safePackageEntry(manifest.main)) errors.push('package main must be a canonical safe component path')
  if (!record(manifest.dsh)
    || (!record(manifest.dsh.bundle) || typeof manifest.dsh.bundle.patch !== 'string')
      && (!record(manifest.dsh.client) || manifest.dsh.client.platform !== 'web')) {
    errors.push('package must declare a DSH bundle patch or Web client contract')
  }
  const component = record(manifest.eMate) && record(manifest.eMate.component)
    ? manifest.eMate.component
    : undefined
  if (component === undefined) {
    errors.push('eMate.component metadata is missing')
  } else {
    if (!exactKeys(component, [
      'schema_version', 'id', 'kind', 'base_imports', 'authority_contract', 'base_contracts',
    ])) {
      errors.push('component metadata fields are invalid')
    }
    if (component.schema_version !== 1) errors.push('component schema_version must be 1')
    if (component.id !== manifest.name) errors.push('component id must equal package name')
    if (!['profile', 'platform-profile'].includes(component.kind)) errors.push('component kind is invalid')
    if (component.kind !== inventory.kind) errors.push(`component kind must equal inventory kind ${inventory.kind}`)
    if (!Array.isArray(component.base_contracts)
      || component.base_contracts.length !== 1
      || component.base_contracts[0] !== baseContract.id) {
      errors.push(`component compatibility must equal the one tested base contract ${String(baseContract.id)}`)
    }
    if (!sortedUniqueStrings(component.base_imports)) {
      errors.push('component Base runtime imports must be a sorted unique string array')
    } else if (component.base_imports.some(name => !record(baseContract.runtime_imports)
      || !Object.hasOwn(baseContract.runtime_imports, name))) {
      errors.push('component imports a package outside the fixed Base runtime ABI')
    }
    if (parseAuthorityContract(component.authority_contract) === undefined) {
      errors.push('component authority contract is invalid')
    }
  }
  if (desktopDependencies.has(manifest.name)) {
    errors.push('component must not be a direct Desktop dependency')
  }
  for (const sourceRoot of inventory.source_roots) {
    try {
      const commit = trackedGitlinkCommit(root, sourceRoot)
      if (!record(manifest.dsh?.upstream) || manifest.dsh.upstream.commit !== commit) {
        errors.push(`component upstream commit must equal the ${sourceRoot} Git submodule commit`)
      }
    } catch (cause) {
      errors.push(cause instanceof Error ? cause.message : String(cause))
    }
  }
  return {
    root: componentRoot,
    id: typeof manifest.name === 'string' ? manifest.name : expectedName,
    version: typeof manifest.version === 'string' ? manifest.version : undefined,
    kind: component?.kind,
    desktop: inventory.desktop,
    cli: inventory.cli,
    source_roots: inventory.source_roots,
    targets: inventory.targets,
    base_imports: sortedUniqueStrings(component?.base_imports) ? [...component.base_imports] : [],
    authority_contract: parseAuthorityContract(component?.authority_contract) ?? { effects: [], guards: [] },
    errors,
  }
}

/** Load and validate the executable base/component compatibility inventory. */
export function loadReleaseBoundary(root = resolve(fileURLToPath(new URL('..', import.meta.url)))) {
  const errors = []
  let baseContract = {}
  try {
    baseContract = readJson(join(root, BASE_CONTRACT_PATH))
    errors.push(...validateBaseContract(baseContract).map(error => `${BASE_CONTRACT_PATH}: ${error}`))
  } catch (cause) {
    errors.push(`${BASE_CONTRACT_PATH}: ${cause instanceof Error ? cause.message : String(cause)}`)
  }
  let desktopDependencies = new Map()
  try {
    const desktop = readJson(join(root, 'desktop/e-mate-desktop/package.json'))
    desktopDependencies = new Map(Object.entries(record(desktop.dependencies) ? desktop.dependencies : {}))
    for (const [name, version] of desktopDependencies) {
      if (name.startsWith('@deepseek-ai/dsh') && version !== baseContract.harness_version) {
        errors.push(`desktop/e-mate-desktop/package.json: ${name} must equal ${String(baseContract.harness_version)}`)
      }
    }
    if (record(baseContract.runtime_imports)) {
      for (const [name, version] of Object.entries(baseContract.runtime_imports)) {
        const installed = name.startsWith(`${desktop.name}/`) ? desktop.version : desktopDependencies.get(name)
        if (installed !== version) {
          errors.push(`desktop/e-mate-desktop/package.json: Base runtime import ${name} must equal ${String(version)}`)
        }
      }
    }
    if (trackedGitlinkCommit(root, 'upstream/deepseek-harness') !== baseContract.harness_commit) {
      errors.push('upstream/deepseek-harness: Git submodule commit does not match the Base contract')
    }
    if (trackedGitlinkCommit(root, PRODUCT_UI_REFERENCE.path) !== PRODUCT_UI_REFERENCE.commit) {
      errors.push(`${PRODUCT_UI_REFERENCE.path}: Git submodule commit does not match the fixed product UI reference`)
    }
  } catch (cause) {
    errors.push(`Desktop/Harness package contract: ${cause instanceof Error ? cause.message : String(cause)}`)
  }
  let inventory = []
  try {
    inventory = componentInventory(root)
  } catch (cause) {
    errors.push(`${COMPONENT_INVENTORY_PATH}: ${cause instanceof Error ? cause.message : String(cause)}`)
  }
  const components = inventory.map(component => (
    validateComponent(root, component, baseContract, desktopDependencies)
  ))
  for (const component of components) {
    errors.push(...component.errors.map(error => `${component.root}: ${error}`))
  }
  const baseRuntimeImports = record(baseContract.runtime_imports) ? Object.keys(baseContract.runtime_imports).sort() : []
  const declaredRuntimeImports = [...new Set(components.flatMap(component => component.base_imports))].sort()
  if (JSON.stringify(baseRuntimeImports) !== JSON.stringify(declaredRuntimeImports)) {
    errors.push(`${BASE_CONTRACT_PATH}: runtime imports must equal the component-declared Base ABI union`)
  }
  return {
    baseContract,
    components,
    valid: errors.length === 0,
    errors,
  }
}

function componentForPath(path, components) {
  return components.find(component => [component.root, ...component.source_roots]
    .some(root => path === root || path.startsWith(`${root}/`)))
}

function localComponentPath(path, component) {
  const owner = [component.root, ...component.source_roots]
    .find(root => path === root || path.startsWith(`${root}/`))
  return owner === undefined || path === owner ? '' : path.slice(owner.length + 1)
}

function componentTestPath(path) {
  return /(^|\/)tests?\//u.test(path) || /\.(?:spec|test)\.[cm]?[jt]sx?$/u.test(path)
}

function docsPath(path) {
  return path.startsWith('docs/') || /(^|\/)(?:README|CHANGELOG)(?:\.[^/]*)?$/iu.test(path)
}

/** Resolve component build jobs from the validated inventory shared by CI and release workflows. */
export function componentJobsFor(boundary, componentIds, publishIds = []) {
  const published = new Set(publishIds)
  return [...new Set(componentIds)].sort().flatMap(id => {
    const component = boundary.components.find(candidate => candidate.id === id)
    if (component === undefined) throw new Error(`unknown component job: ${id}`)
    const targets = component.kind === 'platform-profile'
      ? component.targets.map(target => `${target.platform}-${target.arch}`)
      : ['portable']
    return targets.map(target => ({
      component: id,
      target,
      runner: target === 'portable' ? 'ubuntu-24.04' : TARGET_RUNNERS.get(target),
      publish: published.has(id),
    }))
  })
}

function ciComponentJobsFor(boundary, componentIds, publishIds = []) {
  const jobs = componentJobsFor(boundary, componentIds, publishIds)
  return [
    ...jobs.filter(job => job.target === 'portable').map(job => ({
      target: job.target,
      runner: job.runner,
      components: [job.component],
      publish_components: job.publish ? [job.component] : [],
    })),
    ...PLATFORM_TARGETS.flatMap(target => {
      const targetJobs = jobs.filter(job => job.target === target)
      const components = targetJobs.map(job => job.component)
      return components.length === 0 ? [] : [{
        target,
        runner: TARGET_RUNNERS.get(target),
        components,
        publish_components: targetJobs.filter(job => job.publish).map(job => job.component),
      }]
    }),
  ]
}

/** Validate every accepted platform component against a newly built Base. */
export function basePlatformComponentJobsFor(boundary) {
  return componentJobsFor(
    boundary,
    boundary.components
      .filter(component => component.desktop === 'platform-profile')
      .map(component => component.id),
  )
}

function classifyPath(path, boundary) {
  const component = componentForPath(path, boundary.components)
  if (component !== undefined) {
    if (component.errors.length > 0) {
      return { kind: 'base', path, reason: 'component contract is invalid' }
    }
    const local = localComponentPath(path, component)
    if (componentTestPath(local)) {
      return { kind: 'component-test', path, component: component.id, reason: 'component verification input' }
    }
    if (component.desktop === 'blocked') {
      return { kind: 'base', path, reason: 'component is not yet in the accepted Desktop runtime composition' }
    }
    return {
      kind: 'component',
      path,
      component: component.id,
      reason: component.kind === 'platform-profile'
        ? 'independent target-bound platform Profile component input'
        : 'independent Profile component input',
    }
  }
  if (path.startsWith('enterprise/')) return { kind: 'enterprise', path, reason: 'enterprise-only input' }
  if (VERIFICATION_PATHS.has(path) || path.startsWith('artifacts/')) {
    return { kind: 'verification', path, reason: 'repository gate or evidence only' }
  }
  if (docsPath(path) || /^[^/]+\.md$/iu.test(path)) return { kind: 'docs', path, reason: 'documentation only' }
  if (BASE_PATHS.includes(path) || BASE_PREFIXES.some(prefix => path.startsWith(prefix))) {
    return { kind: 'base', path, reason: 'shared, Harness, Desktop, packaging, or release input' }
  }
  return { kind: 'base', path, reason: 'unknown path fails closed' }
}

function emptyDimensions() {
  return Object.fromEntries(IMPACT_DIMENSIONS.map(name => [name, false]))
}

function allDimensions() {
  return Object.fromEntries(IMPACT_DIMENSIONS.map(name => [name, true]))
}

function dimensionsFor(classifications, boundary) {
  const dimensions = emptyDimensions()
  const mark = (...names) => names.forEach(name => { dimensions[name] = true })
  for (const item of classifications) {
    const path = item.path
    if (item.reason === 'unknown path fails closed' || path === '<classifier>') return allDimensions()
    if (item.kind === 'enterprise') {
      mark('enterprise')
      continue
    }
    if (item.kind === 'component' || item.kind === 'component-test') {
      mark('profile')
      const component = boundary?.components.find(candidate => candidate.id === item.component)
      if (component?.kind === 'platform-profile') mark('macos_runtime', 'windows_runtime')
      continue
    }
    if (item.kind === 'docs') continue
    if (item.kind === 'verification') {
      if (RELEASE_VERIFIER_PREFIXES.some(prefix => path.startsWith(prefix))) mark('release_verifier')
      continue
    }
    if (path === 'scripts/change-impact.mjs' || path === '.github/workflows/ci.yml') return allDimensions()
    if (path.startsWith('.github/workflows/')) {
      mark('release_verifier')
      if (path.includes('profile-release')) mark('profile')
      if (/(?:desktop-(?:release|publication)|release\.yml$)/u.test(path)) {
        mark('macos_packaging', 'windows_packaging')
      }
      continue
    }
    if (PACKAGING_SHARED_PATHS.has(path) || path.startsWith('desktop/.yarn/')) {
      mark('shared_runtime', 'macos_packaging', 'windows_packaging')
      continue
    }
    if (path.startsWith('desktop/e-mate-desktop/')) {
      if (componentTestPath(path)) {
        mark('release_verifier')
        continue
      }
      if (path === BASE_CONTRACT_PATH
        || /\/(?:cordis\.patch\.yml|scripts\/sync-emate-profile|src\/(?:e-mate-profile|profile(?:-|\.|s\.)))/u.test(path)) {
        mark('shared_runtime', 'profile')
        continue
      }
      if (/\/src\/(?:agent-update|install-recovery|installation-cleanup|profile-update|update-|updates\.)/u.test(path)) {
        mark('shared_runtime', 'macos_packaging', 'windows_packaging')
        continue
      }
      if (/\/(?:build\/(?:assistedMessages\.yml|installer\.nsh|windows-update-transaction)|scripts\/(?:package-win|verify-win-installer)|src\/windows-update-installer)\b/iu.test(path)) {
        mark('windows_runtime', 'windows_packaging')
        continue
      }
      if (/\/(?:scripts\/(?:generate-mac-app-icon|mac-universal|package-mac|release-mac|release-preflight|verify-mac)|src\/(?:mac-universal-inventory|mac-update-helper|mac-update-installer))\b/iu.test(path)) {
        mark('macos_runtime', 'macos_packaging')
        continue
      }
      if (/\/(?:build\/|scripts\/(?:desktop-release-manifest|generate-tray-icons|package-dir|prepare-python-runtime|verify-licenses|verify-packaged-runtime)|vendor\/)/u.test(path)) {
        mark('shared_runtime', 'macos_packaging', 'windows_packaging')
        continue
      }
      if (/\/src\/windows-/u.test(path)) mark('windows_runtime')
      else if (/\/src\/mac-/u.test(path)) mark('macos_runtime')
      else mark('shared_runtime')
      continue
    }
    if (path.startsWith('packages/dsh/') || path.startsWith('upstream/deepseek-harness')) {
      mark('shared_runtime', 'profile')
      continue
    }
    if (path.startsWith('scripts/')) {
      mark('release_verifier')
      if (/profile|component|stage-desktop-profile/u.test(path)) mark('profile')
      if (/base-sdk|build-harness|harness-|release\.mjs|release-source/u.test(path)) mark('shared_runtime')
      continue
    }
    if (BASE_PATHS.includes(path) || BASE_PREFIXES.some(prefix => path.startsWith(prefix))) {
      mark('shared_runtime', 'profile')
      continue
    }
    return allDimensions()
  }
  return dimensions
}

function ciPlan(lane, dimensions, options) {
  const releaseCandidate = options.releaseCandidate === true
  const base = lane === 'base'
  const formal = releaseCandidate || (options.protectedMain === true && base)
  const shell = options.components?.includes('@e-mate/dsh-client-shell') === true
  const appSmoke = {
    macos: shell || formal || base && (
      dimensions.shared_runtime || dimensions.profile || dimensions.macos_runtime || dimensions.macos_packaging
    ),
    windows: shell || formal || base && (
      dimensions.shared_runtime || dimensions.profile || dimensions.windows_runtime || dimensions.windows_packaging
    ),
  }
  return {
    app_smoke: appSmoke,
    distribution: { macos: formal, windows: formal },
  }
}

/** Classify normalized repository paths using one fail-closed release boundary. */
export function classifyChangedPaths(paths, options = {}) {
  const root = resolve(options.root ?? fileURLToPath(new URL('..', import.meta.url)))
  let normalized
  try {
    normalized = [...new Set(paths.map(normalizePath))].sort()
  } catch (cause) {
    return failureResult(paths, cause instanceof Error ? cause.message : String(cause))
  }
  let boundary
  try {
    boundary = loadReleaseBoundary(root)
  } catch (cause) {
    return failureResult(normalized, cause instanceof Error ? cause.message : String(cause))
  }
  const classifications = normalized.map(path => classifyPath(path, boundary))
  const kinds = new Set(classifications.map(item => item.kind))
  let components = [...new Set(classifications.flatMap(item => item.component === undefined ? [] : [item.component]))].sort()
  let publishComponents = [...new Set(classifications.flatMap(item => (
    item.kind === 'component' && item.component !== undefined ? [item.component] : []
  )))].sort()
  const hasComponentWork = kinds.has('component') || kinds.has('component-test')
  const acceptedProfileCompatible = typeof options.acceptedProfileCompatible === 'boolean'
    ? options.acceptedProfileCompatible
    : acceptedProfileIsCompatible(root, boundary.baseContract)
  const requiresProfileBootstrap = publishComponents.length > 0 && !acceptedProfileCompatible
  let lane
  if (!boundary.valid || kinds.has('base') || hasComponentWork && kinds.has('enterprise') || requiresProfileBootstrap) lane = 'base'
  else if (hasComponentWork) lane = 'plugin-only'
  else if (kinds.has('enterprise')) lane = 'enterprise-only'
  else if (kinds.has('verification')) lane = 'verification-only'
  else if (kinds.has('docs')) lane = 'docs-only'
  else lane = 'none'
  if (options.releaseCandidate === true && options.protectedMain !== true) {
    return failureResult(normalized, 'release candidate mode requires protected main')
  }
  if (options.audit === true && options.releaseCandidate === true) {
    return failureResult(normalized, 'audit and release candidate modes are mutually exclusive')
  }
  if (options.releaseCandidate === true) lane = 'base'
  if (options.audit === true) lane = 'base'
  const profileCandidate = options.audit !== true && (
    options.releaseCandidate === true
    || options.protectedMain === true && (lane === 'base' || publishComponents.length > 0)
  )
  if (profileCandidate && lane === 'base') {
    components = boundary.components.filter(component => component.desktop !== 'blocked').map(component => component.id).sort()
    publishComponents = [...components]
  }
  const componentJobs = componentJobsFor(boundary, components, publishComponents)
  const ciComponentJobs = ciComponentJobsFor(boundary, components, publishComponents)
    .filter(job => !(profileCandidate && lane === 'base' && job.target === 'portable'))
  const basePlatformComponentJobs = basePlatformComponentJobsFor(boundary)
  const ciBasePlatformComponentJobs = ciComponentJobsFor(
    boundary,
    boundary.components
      .filter(component => component.desktop === 'platform-profile')
      .map(component => component.id),
  )
  const portablePublish = publishComponents.length > 0
    && componentJobs.filter(job => job.publish).every(job => job.target === 'portable')
  const dimensions = dimensionsFor(classifications, boundary)
  return result({
    lane,
    normalized,
    classifications,
    components,
    componentJobs,
    ciComponentJobs,
    basePlatformComponentJobs,
    ciBasePlatformComponentJobs,
    publishComponents,
    portablePublish,
    boundary,
    dimensions,
    ciMode: options.audit === true ? 'audit' : profileCandidate ? 'release-candidate' : 'pr-fast',
    runComponents: lane === 'plugin-only' || profileCandidate,
    composeProfile: profileCandidate && publishComponents.length > 0,
    profileBootstrap: profileCandidate && !acceptedProfileCompatible,
    ci: options.audit === true
      ? { app_smoke: { macos: false, windows: false }, distribution: { macos: false, windows: false } }
      : ciPlan(lane, dimensions, { ...options, components }),
  })
}

function result({
  lane,
  normalized,
  classifications,
  components,
  componentJobs = [],
  ciComponentJobs = [],
  basePlatformComponentJobs = [],
  ciBasePlatformComponentJobs = [],
  publishComponents = [],
  portablePublish = false,
  boundary,
  dimensions = allDimensions(),
  ciMode = 'pr-fast',
  runComponents = false,
  composeProfile = false,
  profileBootstrap = false,
  ci = { app_smoke: { macos: true, windows: true }, distribution: { macos: false, windows: false } },
  error,
}) {
  return {
    schema_version: 2,
    document_type: 'emate.ci-plan',
    lane,
    ci_mode: ciMode,
    run_base: lane === 'base',
    run_plugins: lane === 'plugin-only',
    run_components: runComponents,
    compose_profile: composeProfile,
    profile_bootstrap: profileBootstrap,
    run_enterprise: dimensions.enterprise,
    run_verification: lane !== 'none',
    components,
    component_jobs: componentJobs,
    ci_component_jobs: ciComponentJobs,
    base_platform_component_jobs: basePlatformComponentJobs,
    ci_base_platform_component_jobs: ciBasePlatformComponentJobs,
    publish_components: publishComponents,
    portable_publish: portablePublish,
    ...dimensions,
    ci,
    changed_paths: normalized,
    classifications,
    contract: {
      valid: boundary?.valid ?? false,
      base_contract_id: typeof boundary?.baseContract?.id === 'string' ? boundary.baseContract.id : null,
      schedule_protocol_floor: Number.isSafeInteger(boundary?.baseContract?.schedule_protocol_floor)
        ? boundary.baseContract.schedule_protocol_floor
        : null,
      errors: boundary?.errors ?? (error === undefined ? [] : [error]),
    },
  }
}

function failureResult(paths, error) {
  const normalized = Array.isArray(paths) ? paths.filter(path => typeof path === 'string') : []
  return result({
    lane: 'base',
    normalized,
    classifications: [{ kind: 'base', path: '<classifier>', reason: error }],
    components: [],
    componentJobs: [],
    ciComponentJobs: [],
    basePlatformComponentJobs: [],
    ciBasePlatformComponentJobs: [],
    publishComponents: [],
    ciMode: 'pr-fast',
    runComponents: false,
    composeProfile: false,
    profileBootstrap: false,
    error,
  })
}

/** Require every release candidate to descend from the accepted 2.0.11 baseline. */
export function assertAcceptedPredecessor(root, head) {
  if (!SHA40.test(head)) throw new Error('head must be a full lowercase commit id')
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', ACCEPTED_PREDECESSOR, head], {
      cwd: root,
      stdio: 'ignore',
    })
  } catch {
    throw new Error(`release head does not descend from accepted 2.0.11 ${ACCEPTED_PREDECESSOR}`)
  }
}

function changedPathsFromGit(root, base, head) {
  if (!SHA40.test(base) || !SHA40.test(head)) throw new Error('base and head must be full lowercase commit ids')
  assertAcceptedPredecessor(root, head)
  const mergeBase = execFileSync('git', ['merge-base', base, head], { cwd: root, encoding: 'utf8' }).trim()
  if (!SHA40.test(mergeBase)) throw new Error('git merge-base did not return a commit id')
  const output = execFileSync(
    'git',
    ['diff', '--no-renames', '--name-only', '-z', '--diff-filter=ACDMRTUXB', mergeBase, head, '--'],
    { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
  )
  return output.split('\0').filter(Boolean)
}

function parseArguments(argv) {
  const options = { paths: [] }
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index]
    if (name === '--check-contract') options.checkContract = true
    else if (name === '--audit') options.audit = true
    else if (name === '--protected-main') options.protectedMain = true
    else if (name === '--release-candidate') options.releaseCandidate = true
    else if (['--base', '--head', '--paths-from', '--github-output', '--root'].includes(name)) {
      const value = argv[index + 1]
      if (value === undefined) throw new Error(`${name} requires a value`)
      options[name.slice(2).replace('-', '')] = value
      index += 1
    } else if (name === '--path') {
      const value = argv[index + 1]
      if (value === undefined) throw new Error('--path requires a value')
      options.paths.push(value)
      index += 1
    } else throw new Error(`unknown argument: ${String(name)}`)
  }
  return options
}

function writeGithubOutput(path, value) {
  appendFileSync(path, [
    `lane=${value.lane}`,
    `ci_mode=${value.ci_mode}`,
    `run_base=${String(value.run_base)}`,
    `run_plugins=${String(value.run_plugins)}`,
    `run_components=${String(value.run_components)}`,
    `compose_profile=${String(value.compose_profile)}`,
    `profile_bootstrap=${String(value.profile_bootstrap)}`,
    `run_enterprise=${String(value.run_enterprise)}`,
    `run_verification=${String(value.run_verification)}`,
    `components_json=${JSON.stringify(value.components)}`,
    `component_jobs_json=${JSON.stringify(value.component_jobs)}`,
    `ci_component_jobs_json=${JSON.stringify(value.ci_component_jobs)}`,
    `base_platform_component_jobs_json=${JSON.stringify(value.base_platform_component_jobs)}`,
    `ci_base_platform_component_jobs_json=${JSON.stringify(value.ci_base_platform_component_jobs)}`,
    `publish_components_json=${JSON.stringify(value.publish_components)}`,
    `portable_publish=${String(value.portable_publish)}`,
    ...IMPACT_DIMENSIONS.map(name => `${name}=${String(value[name])}`),
    `macos_app_smoke=${String(value.ci.app_smoke.macos)}`,
    `windows_app_smoke=${String(value.ci.app_smoke.windows)}`,
    `macos_distribution=${String(value.ci.distribution.macos)}`,
    `windows_distribution=${String(value.ci.distribution.windows)}`,
    `result_json=${JSON.stringify(value)}`,
    '',
  ].join('\n'))
}

function main() {
  let options
  try {
    options = parseArguments(process.argv.slice(2))
  } catch (cause) {
    const value = failureResult([], cause instanceof Error ? cause.message : String(cause))
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
    process.exitCode = 2
    return
  }
  const root = resolve(options.root ?? fileURLToPath(new URL('..', import.meta.url)))
  let paths = options.paths
  let inputError
  try {
    if (options.checkContract) paths = []
    else if (options.pathsfrom !== undefined) {
      const source = resolve(options.pathsfrom)
      const relativeSource = relative(root, source)
      if (relativeSource === '..' || relativeSource.startsWith(`..${sep}`)) throw new Error('--paths-from must stay inside the repository')
      paths = readFileSync(source, 'utf8').split(/\r?\n/u).filter(Boolean)
    } else if (options.base !== undefined || options.head !== undefined) {
      if (options.base === undefined || options.head === undefined) throw new Error('--base and --head must be provided together')
      paths = changedPathsFromGit(root, options.base, options.head)
    } else if (paths.length === 0 && options.audit !== true) throw new Error('provide --base/--head, --paths-from, --path, --audit, or --check-contract')
  } catch (cause) {
    inputError = cause instanceof Error ? cause.message : String(cause)
  }
  const value = inputError === undefined
    ? classifyChangedPaths(paths, {
      root,
      protectedMain: options.protectedMain,
      releaseCandidate: options.releaseCandidate,
      audit: options.audit,
    })
    : failureResult(paths, inputError)
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
  if (options.githuboutput !== undefined) writeGithubOutput(options.githuboutput, value)
  if (!value.contract.valid) process.exitCode = 1
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
