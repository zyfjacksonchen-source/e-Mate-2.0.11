import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const root = new URL('../', import.meta.url)

test('profile replaces built-in search and uses only credential references', async () => {
  const [manifest, patch, source] = await Promise.all([
    readFile(new URL('package.json', root), 'utf8'),
    readFile(new URL('cordis.patch.yml', root), 'utf8'),
    readFile(new URL('src/index.ts', root), 'utf8'),
  ])
  const pkg = JSON.parse(manifest)
  assert.equal(pkg.version, '2.0.7')
  assert.deepEqual(pkg.dependencies, { '@modelcontextprotocol/sdk': '1.29.0' })
  assert.equal(pkg.peerDependencies, undefined)
  assert.equal(pkg.eMate.harnessVersion, '0.1.0-rc.5')
  assert.equal(pkg.eMate.mcpSdkVersion, '1.29.0')
  assert.match(patch, /searchProvider: search-mcp/u)
  assert.match(patch, /web-search-deepseek[\s\S]*disabled: true/u)
  assert.match(source, /credentialRef: z\.string\(\)\.role\('credential-ref'\)/u)
  assert.doesNotMatch(source, /apiKey:\s*z\./u)
  assert.doesNotMatch(source, /\.\.\.process\.env/u)
  assert.doesNotMatch(source, /String\(error\)/u)
})
