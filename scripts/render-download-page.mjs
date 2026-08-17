#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

export const RELEASE_SOURCE_PLACEHOLDER = '__EMATE_RELEASE_SOURCE_COMMIT__'
export const DESKTOP_MANIFEST_URL = 'https://pub-ada3f610c0234a76838f4e19fe2bb25e.r2.dev/desktop/latest.json'

export function renderDownloadPage(template) {
  if (template.includes(RELEASE_SOURCE_PLACEHOLDER)
    || !template.includes(DESKTOP_MANIFEST_URL)
    || !template.includes('data-desktop-artifact="darwin"')
    || !template.includes('data-desktop-artifact="win32"')) {
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
