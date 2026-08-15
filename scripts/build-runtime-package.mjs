#!/usr/bin/env node

// Build the minimum Office/OCR worker closure from the final e-Mate 2.0.5
// worker and hash lock. Installation-time downloads and system Python fallbacks
// are deliberately impossible: this script runs only while packing a release.
import { spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import {
  createWriteStream,
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  statSync,
} from 'node:fs'
import { cp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'

const PRODUCT_VERSION = '2.0.7'
const PYTHON_VERSION = '3.11.15'
const PYTHON_RELEASE = '20260602'
const SOURCE_COMMIT = '564a6b6c1d43fb6831dd4a5cd8026e472f063311'
const ASSETS = {
  'darwin-arm64': {
    name: 'cpython-3.11.15+20260602-aarch64-apple-darwin-install_only_stripped.tar.gz',
    size: 27091323,
    sha256: 'f1461690377000ee2161af52db780b7c1a200549fff7c8064e47e1ee1832265b',
  },
  'darwin-x64': {
    name: 'cpython-3.11.15+20260602-x86_64-apple-darwin-install_only_stripped.tar.gz',
    size: 27000688,
    sha256: '64035e377ac6f43cfc3e5e7dc373d79c36306524025cf6b1b8b7823d95b6fff5',
  },
  'win32-x64': {
    name: 'cpython-3.11.15+20260602-x86_64-pc-windows-msvc-install_only_stripped.tar.gz',
    size: 25675651,
    sha256: 'f606681b2327210e2e7edf8c33f5260ea05d50f0c5b546f7c9fd535b21ec627a',
  },
}

const packageRoot = resolve(process.cwd())
const repositoryRoot = resolve(import.meta.dirname, '..')
const sourceRoot = join(repositoryRoot, 'upstream', 'e-mate-2.0.5')
const requirementsRoot = join(repositoryRoot, 'requirements')
const packageManifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'))
const workerManifest = JSON.parse(readFileSync(join(requirementsRoot, 'worker-manifest.json'), 'utf8'))
const platformKey = `${process.platform}-${process.arch}`
const expectedName = `@e-mate/dsh-runtime-${platformKey}`
const asset = ASSETS[platformKey]

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', stdio: 'pipe', ...options })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    throw new Error(`${basename(command)} exited with ${String(result.status)}: ${(result.stderr || result.stdout).trim().slice(-1200)}`)
  }
  return result.stdout
}

function verifySources() {
  if (asset === undefined || packageManifest.name !== expectedName || packageManifest.version !== PRODUCT_VERSION) {
    throw new Error(`runtime package ${String(packageManifest.name)} cannot be built on ${platformKey}`)
  }
  if (!packageManifest.os?.includes(process.platform) || !packageManifest.cpu?.includes(process.arch)) {
    throw new Error('runtime package os/cpu declaration does not match the build host')
  }
  const commit = run('git', ['-C', sourceRoot, 'rev-parse', 'HEAD']).trim()
  if (commit !== SOURCE_COMMIT || workerManifest.source?.commit !== SOURCE_COMMIT) {
    throw new Error(`e-Mate 2.0.5 source drifted to ${commit}`)
  }
  const expected = [
    ['requirements/locks/manifest.json', workerManifest.source.manifest_sha256],
    ['requirements/locks/platform-stage.in', workerManifest.source.input_sha256],
    ['requirements/locks/platform-stage.lock', workerManifest.source.lock_sha256],
    ['ecorex/integration/dependency_pack_worker.py', workerManifest.source.worker_sha256],
  ]
  for (const [relativePath, digest] of expected) {
    if (sha256(join(sourceRoot, relativePath)) !== digest) throw new Error(`source drifted: ${relativePath}`)
  }
  if (sha256(join(requirementsRoot, 'worker.in')) !== workerManifest.worker_input_sha256
    || sha256(join(requirementsRoot, 'worker.lock')) !== workerManifest.worker_lock_sha256) {
    throw new Error('e-Mate worker dependency lock drifted')
  }
}

async function downloadArchive(destination) {
  const url = `https://github.com/astral-sh/python-build-standalone/releases/download/${PYTHON_RELEASE}/${encodeURIComponent(asset.name)}`
  const partial = `${destination}.partial`
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    const offset = existsSync(partial) ? statSync(partial).size : 0
    const response = await fetch(url, {
      headers: offset > 0 ? { Range: `bytes=${offset}-` } : {},
      redirect: 'follow',
      signal: AbortSignal.timeout(120000),
    })
    if (response.status === 416 && offset === asset.size) break
    if (!response.ok || response.body === null) throw new Error(`Python archive download returned HTTP ${response.status}`)
    const append = offset > 0 && response.status === 206
    if (append && !response.headers.get('content-range')?.startsWith(`bytes ${offset}-`)) {
      throw new Error('Python archive range response is inconsistent')
    }
    await pipeline(Readable.fromWeb(response.body), createWriteStream(partial, { flags: append ? 'a' : 'w' }))
    if (statSync(partial).size === asset.size && sha256(partial) === asset.sha256) break
    if (attempt === 6) throw new Error('Python archive failed size/SHA-256 validation after six attempts')
  }
  if (!existsSync(partial) || statSync(partial).size !== asset.size || sha256(partial) !== asset.sha256) {
    throw new Error('Python archive failed size/SHA-256 validation')
  }
  await rename(partial, destination)
}

async function resolveArchive() {
  if (process.env.EMATE_PYTHON_ARCHIVE) {
    const supplied = resolve(process.env.EMATE_PYTHON_ARCHIVE)
    if (!existsSync(supplied) || statSync(supplied).size !== asset.size || sha256(supplied) !== asset.sha256) {
      throw new Error('EMATE_PYTHON_ARCHIVE does not match the pinned platform asset')
    }
    return supplied
  }
  const cache = join(repositoryRoot, 'dist', 'cache', 'python')
  const destination = join(cache, asset.name)
  await mkdir(cache, { recursive: true })
  if (existsSync(destination) && statSync(destination).size === asset.size && sha256(destination) === asset.sha256) {
    return destination
  }
  await rm(destination, { force: true })
  await downloadArchive(destination)
  return destination
}

function assertArchiveShape(archive) {
  const entries = run('tar', ['-tzf', archive], { maxBuffer: 32 * 1024 * 1024 }).split(/\r?\n/).filter(Boolean)
  if (entries.length === 0) throw new Error('Python archive is empty')
  for (const entry of entries) {
    const parts = entry.replace(/\\/g, '/').split('/')
    if (!entry.startsWith('python/') || entry.startsWith('/') || parts.includes('..') || entry.includes('\0')) {
      throw new Error(`Python archive contains an unsafe path: ${entry}`)
    }
  }
}

function collectFiles(root, directory = root) {
  const files = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    const metadata = lstatSync(path)
    const normalized = relative(root, path).split(sep).join('/')
    if (metadata.isDirectory()) files.push(...collectFiles(root, path))
    else if (metadata.isSymbolicLink()) {
      const target = readlinkSync(path)
      const resolvedTarget = resolve(dirname(path), target)
      if (resolvedTarget !== root && !resolvedTarget.startsWith(`${root}${sep}`)) {
        throw new Error(`runtime symbolic link escapes payload: ${normalized}`)
      }
      files.push({ path, relative: normalized, kind: 'link', target })
    } else if (metadata.isFile()) {
      files.push({ path, relative: normalized, kind: 'file', size: metadata.size, mode: metadata.mode })
    } else {
      throw new Error(`runtime contains an unsupported file type: ${normalized}`)
    }
  }
  return files.sort((left, right) => left.relative.localeCompare(right.relative))
}

function treeIdentity(root) {
  const digest = createHash('sha256')
  const files = collectFiles(root)
  for (const file of files) {
    if (file.kind === 'link') digest.update(`L\0${file.relative}\0${file.target}\0`)
    else {
      digest.update(`F\0${file.relative}\0${file.size}\0`)
      digest.update(readFileSync(file.path))
    }
  }
  return { sha256: digest.digest('hex'), files }
}

function distributionInventory(sitePackages) {
  const inventory = []
  for (const entry of readdirSync(sitePackages, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.endsWith('.dist-info')) continue
    const metadataPath = join(sitePackages, entry.name, 'METADATA')
    if (!existsSync(metadataPath)) continue
    const metadata = readFileSync(metadataPath, 'utf8')
    const field = name => metadata.match(new RegExp(`^${name}:\\s*(.+)$`, 'mi'))?.[1]?.trim()
    inventory.push({
      name: field('Name') ?? entry.name,
      version: field('Version') ?? 'unknown',
      license: field('License-Expression') ?? field('License') ?? 'see packaged metadata',
      metadata: `runtime/python/${entry.name}/METADATA`,
    })
  }
  return inventory.sort((left, right) => left.name.localeCompare(right.name))
}

async function removeGeneratedEntryPoints(sitePackages) {
  // pip writes console-script shebangs with the random staging path. The
  // Worker imports libraries directly, so drop those unused scripts and their
  // path-dependent RECORD rows to keep the platform payload reproducible.
  await rm(join(sitePackages, 'bin'), { recursive: true, force: true })
  await rm(join(sitePackages, 'Scripts'), { recursive: true, force: true })
  for (const entry of readdirSync(sitePackages, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.endsWith('.dist-info')) continue
    const record = join(sitePackages, entry.name, 'RECORD')
    if (!existsSync(record)) continue
    const lines = (await readFile(record, 'utf8')).split(/\r?\n/)
      .filter(line => !/^(?:\.\.\/)+(?:bin|scripts)\//iu.test(line))
    await writeFile(record, `${lines.filter((line, index) => line !== '' || index < lines.length - 1).join('\n')}\n`)
  }
}

function workerRequest(python, worker, root, packId, operation, payload, timeout = 120000) {
  const request = JSON.stringify({ schema_version: 1, pack_id: packId, operation, payload })
  const result = spawnSync(python, ['-I', '-B', worker, root], {
    input: request,
    encoding: 'utf8',
    maxBuffer: 12 * 1024 * 1024,
    timeout,
    env: {
      LANG: process.env.LANG ?? 'C.UTF-8',
      LC_ALL: process.env.LC_ALL ?? 'C.UTF-8',
      PYTHONHASHSEED: '0',
      PYTHONNOUSERSITE: '1',
    },
  })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) throw new Error(`${packId} worker self-test exited with ${String(result.status)}`)
  const response = JSON.parse(result.stdout)
  if (response?.schema_version !== 1 || response?.pack_id !== packId || response?.status !== 'success') {
    throw new Error(`${packId} worker self-test returned an invalid response`)
  }
  return response.result
}

async function main() {
  verifySources()
  const archive = await resolveArchive()
  assertArchiveShape(archive)

  const temporary = join(packageRoot, `.runtime-${process.pid}-${randomUUID()}`)
  const payload = join(temporary, 'runtime')
  const pythonRoot = join(payload, 'python-bin')
  const sitePackages = join(payload, 'python')
  const output = join(packageRoot, 'runtime')
  await rm(temporary, { recursive: true, force: true })
  await mkdir(temporary, { recursive: true })
  try {
    run('tar', ['-xzf', archive, '-C', temporary])
    await mkdir(payload, { recursive: true })
    await rename(join(temporary, 'python'), pythonRoot)
    // npm intentionally omits symlinks from package tarballs. The product uses
    // only real interpreter files, so remove convenience links before hashing
    // instead of publishing a manifest that cannot survive npm installation.
    for (const file of collectFiles(pythonRoot).filter(file => file.kind === 'link')) {
      await rm(file.path)
    }
    await mkdir(sitePackages, { recursive: true })
    // npm tar omits symlinks, so the public manifest must name the real
    // interpreter file rather than python/python3 convenience links.
    const pythonRelative = process.platform === 'win32' ? 'python-bin/python.exe' : 'python-bin/bin/python3.11'
    const python = join(payload, ...pythonRelative.split('/'))
    if (!existsSync(python)) throw new Error(`packaged Python executable is missing: ${pythonRelative}`)
    const version = run(python, ['-I', '-B', '-c', 'import platform; print(platform.python_version())'], {
      env: { PYTHONDONTWRITEBYTECODE: '1', PYTHONNOUSERSITE: '1' },
    }).trim()
    if (version !== PYTHON_VERSION) throw new Error(`packaged Python drifted to ${version}`)

    run(python, [
      '-I', '-B', '-m', 'pip', 'install',
      '--disable-pip-version-check',
      '--no-compile',
      '--only-binary=:all:',
      '--require-hashes',
      '--target', sitePackages,
      '--requirement', join(requirementsRoot, 'worker.lock'),
    ], { env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1', PYTHONNOUSERSITE: '1' }, maxBuffer: 32 * 1024 * 1024 })
    await removeGeneratedEntryPoints(sitePackages)

    const worker = join(payload, 'worker.py')
    await cp(join(sourceRoot, 'ecorex', 'integration', 'dependency_pack_worker.py'), worker)
    const office = workerRequest(python, worker, temporary, 'office', 'probe', {})
    if (office?.provider !== 'python-office-formats-v1') throw new Error('Office worker probe failed')
    const ocr = workerRequest(python, worker, temporary, 'ocr', 'extract', {
      content_base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    })
    if (ocr?.provider !== 'rapidocr_onnxruntime') throw new Error('OCR worker probe failed')

    const models = collectFiles(sitePackages)
      .filter(file => file.kind === 'file' && file.relative.endsWith('.onnx'))
      .map(file => ({
        path: `runtime/python/${file.relative}`,
        size: file.size,
        sha256: sha256(file.path),
      }))
    if (models.length < 3) throw new Error('RapidOCR model closure is incomplete')
    const identity = treeIdentity(payload)
    const executables = identity.files
      .filter(file => file.kind === 'file' && (file.mode & 0o111) !== 0)
      .map(file => `runtime/${file.relative}`)
    const inventory = distributionInventory(sitePackages)
    const manifest = {
      schema_version: 1,
      package: packageManifest.name,
      version: PRODUCT_VERSION,
      os: process.platform,
      cpu: process.arch,
      python_version: PYTHON_VERSION,
      python: `runtime/${pythonRelative}`,
      python_sha256: sha256(python),
      worker: 'runtime/worker.py',
      worker_sha256: sha256(worker),
      site_packages: 'runtime/python',
      office: true,
      ocr: true,
      worker_lock_sha256: workerManifest.worker_lock_sha256,
      source_commit: SOURCE_COMMIT,
      python_asset: {
        release: PYTHON_RELEASE,
        name: asset.name,
        size: asset.size,
        sha256: asset.sha256,
      },
      payload_files: identity.files.length,
      payload_sha256: identity.sha256,
      models,
      executables,
      distributions: inventory,
    }

    await rm(output, { recursive: true, force: true })
    await rename(payload, output)
    await writeFile(join(packageRoot, 'emate-runtime.json'), `${JSON.stringify(manifest, null, 2)}\n`)
    await writeFile(join(packageRoot, 'THIRD_PARTY_NOTICES.txt'), [
      `CPython ${PYTHON_VERSION} from python-build-standalone release ${PYTHON_RELEASE}`,
      `Asset: ${asset.name}`,
      `SHA-256: ${asset.sha256}`,
      '',
      `Office/OCR worker copied from MIT e-Mate 2.0.5 commit ${SOURCE_COMMIT}.`,
      `Worker SHA-256: ${workerManifest.source.worker_sha256}`,
      '',
      'Python distributions (license text/metadata remains inside the packaged dist-info directory):',
      ...inventory.map(item => `- ${item.name} ${item.version} — ${item.license} — ${item.metadata}`),
      '',
    ].join('\n'))
    console.log(`build-runtime-package: ${packageManifest.name} -> ${identity.files.length} files, ${models.length} OCR models`)
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}

await main()
