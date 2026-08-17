#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { releaseSource } from './release-source.mjs'

export const RELEASE_SOURCE_PLACEHOLDER = '__EMATE_RELEASE_SOURCE_COMMIT__'

export function renderDownloadPage(template, sourceCommit) {
  const source = releaseSource(sourceCommit)
  const page = template.replaceAll(RELEASE_SOURCE_PLACEHOLDER, sourceCommit)
  if (page.includes(RELEASE_SOURCE_PLACEHOLDER) || !page.includes(source.tarball_url) || !page.includes(source.manifest_url)) {
    throw new Error('download page release source rendering failed')
  }
  return page
}

function main() {
  const { values } = parseArgs({ options: { template: { type: 'string' }, out: { type: 'string' }, commit: { type: 'string' } } })
  if (values.out === undefined || values.commit === undefined) {
    throw new Error('usage: render-download-page.mjs --commit <git sha> --out <path> [--template <path>]')
  }
  const template = resolve(values.template ?? 'deploy/download-page/index.html')
  const output = resolve(values.out)
  mkdirSync(dirname(output), { recursive: true })
  writeFileSync(output, renderDownloadPage(readFileSync(template, 'utf8'), values.commit))
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main()
