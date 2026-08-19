import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  formatAccessibilitySnapshot,
  validateCdpEndpoint,
} from '../lib/cdp.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))

test('accepts only an explicit literal loopback CDP origin', () => {
  assert.equal(validateCdpEndpoint('http://127.0.0.1:9222'), 'http://127.0.0.1:9222')
  assert.equal(validateCdpEndpoint('http://[::1]:9222'), 'http://[::1]:9222')
  for (const endpoint of [
    'https://127.0.0.1:9222',
    'http://localhost:9222',
    'http://example.com:9222',
    'http://127.0.0.1:9222/json',
    'http://user@127.0.0.1:9222',
  ]) assert.throws(() => validateCdpEndpoint(endpoint), /loopback HTTP origin/)
})

test('renders bounded session indices without exposing form values', () => {
  const snapshot = formatAccessibilitySnapshot(
    { title: 'Example', url: 'https://example.com/' },
    [
      { role: { value: 'heading' }, name: { value: 'Welcome' } },
      { role: { value: 'button' }, name: { value: 'Continue' }, backendDOMNodeId: 41 },
      { role: { value: 'textbox' }, name: { value: 'Password' }, value: { value: 'never-print-this' }, backendDOMNodeId: 42 },
    ],
  )
  assert.match(snapshot.text, /\[1\] button "Continue"/)
  assert.match(snapshot.text, /\[2\] textbox "Password"/)
  assert.doesNotMatch(snapshot.text, /never-print-this/)
  assert.deepEqual([...snapshot.indices], [[1, 41], [2, 42]])
})

test('ships no extension, browser binary, runtime downloader, or MCP subprocess', async () => {
  const manifest = JSON.parse(await readFile(`${root}/package.json`, 'utf8'))
  const source = await readFile(`${root}/src/index.ts`, 'utf8')
  assert.equal(manifest.name, '@e-mate/dsh-plugin-cdp')
  assert.equal(manifest.eMate.harnessCommit, 'df78045a127e32cb5b942defba52c539590d1596')
  assert.equal(manifest.files.includes('extension'), false)
  assert.doesNotMatch(source, /npx|playwright|puppeteer|chrome-devtools-mcp|child_process/iu)
})
