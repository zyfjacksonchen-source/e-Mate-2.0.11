#!/usr/bin/env node

// Package the Chromium revision already selected by the pinned Harness
// Playwright dependency. Downloads, when needed, stay in the release build.
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'

const PRODUCT_VERSION = '2.0.7'
const PLAYWRIGHT_VERSION = '1.61.1'
const BROWSER_REVISION = '1228'
const BROWSER_VERSION = '149.0.7827.55'

const packageRoot = resolve(process.cwd())
const repositoryRoot = resolve(import.meta.dirname, '..')
const harnessRoot = join(repositoryRoot, 'upstream', 'deepseek-harness')
const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'))
const expectedName = `@e-mate/dsh-browser-${process.platform}-${process.arch}`

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function assertPackage() {
  if (manifest.name !== expectedName || manifest.version !== PRODUCT_VERSION) {
    throw new Error(`browser package ${String(manifest.name)} cannot be built on ${process.platform}-${process.arch}`)
  }
  if (manifest.os?.[0] !== process.platform || manifest.cpu?.[0] !== process.arch) {
    throw new Error('browser package os/cpu declaration does not match the build host')
  }
}

function loadTargetPlaywright() {
  const require = createRequire(join(harnessRoot, 'apps', 'web', 'package.json'))
  const playwrightRoot = dirname(require.resolve('playwright/package.json'))
  const version = JSON.parse(readFileSync(join(playwrightRoot, 'package.json'), 'utf8')).version
  if (version !== PLAYWRIGHT_VERSION) throw new Error(`pinned Harness Playwright drifted to ${version}`)
  const playwrightCoreRoot = join(dirname(playwrightRoot), 'playwright-core')
  const browsers = JSON.parse(readFileSync(join(playwrightCoreRoot, 'browsers.json'), 'utf8')).browsers
  const chromium = browsers.find(entry => entry.name === 'chromium')
  if (String(chromium?.revision) !== BROWSER_REVISION || chromium?.browserVersion !== BROWSER_VERSION) {
    throw new Error('pinned Harness Chromium revision drifted')
  }
  return { chromium: require('playwright').chromium, cli: join(playwrightRoot, 'cli.js') }
}

function installTargetChromium(cli) {
  const result = spawnSync(process.execPath, [cli, 'install', 'chromium'], {
    cwd: join(harnessRoot, 'apps', 'web'),
    stdio: 'inherit',
    env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH },
  })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) throw new Error(`target Playwright Chromium install exited with ${String(result.status)}`)
}

function browserSource(executable) {
  let revisionRoot = dirname(executable)
  while (basename(revisionRoot) !== `chromium-${BROWSER_REVISION}`) {
    const parent = dirname(revisionRoot)
    if (parent === revisionRoot) throw new Error(`unexpected target Chromium path ${executable}`)
    revisionRoot = parent
  }
  const headlessRoot = join(dirname(revisionRoot), `chromium_headless_shell-${BROWSER_REVISION}`)
  const executableName = process.platform === 'win32' ? 'chrome-headless-shell.exe' : 'chrome-headless-shell'
  const findExecutable = directory => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isFile() && entry.name === executableName) return path
      if (entry.isDirectory()) {
        const nested = findExecutable(path)
        if (nested !== undefined) return nested
      }
    }
  }
  if (!existsSync(headlessRoot)) return undefined
  const headlessExecutable = findExecutable(headlessRoot)
  if (headlessExecutable === undefined) return undefined
  const first = relative(headlessRoot, headlessExecutable).split(sep)[0]
  return {
    source: join(headlessRoot, first),
    executableRelative: relative(join(headlessRoot, first), headlessExecutable),
  }
}

function executableFiles(directory, base = directory) {
  const files = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    const metadata = lstatSync(path)
    if (metadata.isSymbolicLink()) throw new Error(`browser payload contains a symbolic link: ${path}`)
    if (metadata.isDirectory()) files.push(...executableFiles(path, base))
    else if ((metadata.mode & 0o111) !== 0) files.push(relative(base, path).split(sep).join('/'))
  }
  return files.sort()
}

async function main() {
  assertPackage()
  const { chromium, cli } = loadTargetPlaywright()
  let executable = chromium.executablePath()
  let selected = existsSync(executable) ? browserSource(executable) : undefined
  if (selected === undefined) {
    installTargetChromium(cli)
    executable = chromium.executablePath()
    selected = existsSync(executable) ? browserSource(executable) : undefined
  }
  if (selected === undefined) throw new Error('target Chromium headless-shell is missing after Playwright install')

  const { source, executableRelative } = selected
  const temporary = join(packageRoot, `.browser-${process.pid}`)
  const output = join(packageRoot, 'browser')
  await rm(temporary, { recursive: true, force: true })
  await cp(source, temporary, { recursive: true })
  await rm(output, { recursive: true, force: true })
  await rename(temporary, output)

  const packagedExecutable = join(output, executableRelative)
  const about = join(output, 'ABOUT')
  await mkdir(packageRoot, { recursive: true })
  await writeFile(join(packageRoot, 'emate-browser.json'), `${JSON.stringify({
    schema_version: 1,
    package: manifest.name,
    version: PRODUCT_VERSION,
    os: process.platform,
    cpu: process.arch,
    chromium: true,
    engine: 'chromium-headless-shell',
    playwright_version: PLAYWRIGHT_VERSION,
    browser_revision: BROWSER_REVISION,
    browser_version: BROWSER_VERSION,
    executable: join('browser', executableRelative).split(sep).join('/'),
    executable_sha256: sha256(packagedExecutable),
    executables: executableFiles(output).map(path => `browser/${path}`),
  }, null, 2)}\n`)
  const headlessLicense = join(output, 'LICENSE.headless_shell')
  await writeFile(join(packageRoot, 'THIRD_PARTY_NOTICES.txt'), [
    existsSync(about) ? await readFile(about, 'utf8') : `Chromium Headless Shell ${BROWSER_VERSION}.\n`,
    existsSync(headlessLicense) ? await readFile(headlessLicense, 'utf8') : '',
  ].filter(Boolean).join('\n'))
  console.log(`build-browser-package: ${manifest.name} -> ${packagedExecutable}`)
}

await main()
