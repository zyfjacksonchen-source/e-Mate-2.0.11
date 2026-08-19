#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

export const PRODUCT = 'e-Mate'
export const VERSION = '2.0.10'
export const PACKAGE_NAME = '@e-mate/dsh'
export const TARBALL_FILENAME = 'e-mate-dsh-2.0.10.tgz'
export const R2_PUBLIC_ORIGIN = 'https://pub-ada3f610c0234a76838f4e19fe2bb25e.r2.dev'
const COMMIT = /^[0-9a-f]{40}$/u

export function releasePrefix(sourceCommit) {
  if (!COMMIT.test(sourceCommit)) throw new Error('release source commit is invalid')
  return `npm/candidates/v${VERSION}/${sourceCommit}`
}

export function releaseSource(sourceCommit) {
  const prefix = releasePrefix(sourceCommit)
  return {
    schema_version: 1,
    product: PRODUCT,
    version: VERSION,
    package_name: PACKAGE_NAME,
    source_commit: sourceCommit,
    manifest_url: `${R2_PUBLIC_ORIGIN}/${prefix}/release-manifest.json`,
    tarball_url: `${R2_PUBLIC_ORIGIN}/${prefix}/${TARBALL_FILENAME}`,
  }
}

function head() {
  return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
}

function main() {
  const { values } = parseArgs({ options: { out: { type: 'string' }, commit: { type: 'string' } } })
  if (values.out === undefined) throw new Error('usage: release-source.mjs --out <path> [--commit <git sha>]')
  const path = resolve(values.out)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(releaseSource(values.commit ?? process.env.GITHUB_SHA ?? head()), null, 2)}\n`)
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main()
