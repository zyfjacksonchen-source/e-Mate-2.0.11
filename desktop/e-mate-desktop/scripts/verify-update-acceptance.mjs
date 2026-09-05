#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { validateUpdateAcceptance } from './update-acceptance-validation.mjs'

export const verifyUpdateAcceptance = validateUpdateAcceptance

async function main(argv) {
  if (argv.length !== 3) throw new Error('update acceptance rejected: usage: verify-update-acceptance.mjs <candidate-manifest.json> <mac-acceptance.json> <windows-acceptance.json>')
  const values = await Promise.all(argv.map(async path => JSON.parse(await readFile(path, 'utf8'))))
  process.stdout.write(JSON.stringify(verifyUpdateAcceptance(...values)) + '\n')
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch(error => { process.stderr.write(String(error.message) + '\n'); process.exitCode = 1 })
}
