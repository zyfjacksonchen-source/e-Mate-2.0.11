#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

export const RELEASE_SOURCE_PLACEHOLDER = '__EMATE_RELEASE_SOURCE_COMMIT__'
const desktopVersion = JSON.parse(readFileSync(new URL('../desktop/e-mate-desktop/package.json', import.meta.url), 'utf8')).version
if (typeof desktopVersion !== 'string' || !/^\d+\.\d+\.\d+$/u.test(desktopVersion)) {
  throw new Error('download page requires the stable Desktop package version')
}
export const DESKTOP_MANIFEST_URL = `https://pub-ada3f610c0234a76838f4e19fe2bb25e.r2.dev/desktop/manual/v${desktopVersion}/latest.json`
export const DESKTOP_SCRIPT = './site.a8feef4609f9.js'

export function renderDownloadPage(template) {
  const script = readFileSync(new URL(`../deploy/download-page/${DESKTOP_SCRIPT.slice(2)}`, import.meta.url), 'utf8')
  if (template.includes(RELEASE_SOURCE_PLACEHOLDER)
    || !template.includes(DESKTOP_SCRIPT)
    || !template.includes('data-platform-switch')
    || !template.includes('data-downloads')
    || !script.includes(`const VERSION = "${desktopVersion}";`)
    || !script.includes('`${R2_ORIGIN}/desktop/manual/v${VERSION}/latest.json`')) {
    throw new Error('download page desktop manifest contract is incomplete')
  }
  return template
}

function main() {
  const { values } = parseArgs({ options: { template: { type: 'string' }, out: { type: 'string' }, commit: { type: 'string' } } })
  if (values.out === undefined) {
    throw new Error('usage: render-download-page.mjs --out <path> [--template <path>]')
  }
  const template = resolve(values.template ?? 'deploy/download-page/index.html')
  const output = resolve(values.out)
  mkdirSync(dirname(output), { recursive: true })
  writeFileSync(output, renderDownloadPage(readFileSync(template, 'utf8')))
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main()
