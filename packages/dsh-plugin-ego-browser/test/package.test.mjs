import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { apply, inject } from '../lib/index.js'
import { supportForPlatform, WINDOWS_EDGE_CANDIDATE } from '../lib/platform.js'

test('platform support is explicit and fail-closed', () => {
  assert.deepEqual(supportForPlatform('darwin'), {
    status: 'setup-required',
    code: 'EGO_BROWSER_RUNTIME_UNVERIFIED',
  })
  assert.deepEqual(supportForPlatform('win32'), {
    status: 'setup-required',
    code: 'PLAYWRIGHT_MCP_EDGE_UNVERIFIED',
  })
  assert.deepEqual(supportForPlatform('linux'), {
    status: 'blocked',
    code: 'EGO_BROWSER_UNSUPPORTED_PLATFORM',
  })
})

test('registers one CLI-only bundled skill through the Harness skill seam', async () => {
  let provider
  assert.deepEqual(inject, ['skills'])
  apply({ skills: { registerProvider(create) { provider = create({ signal: AbortSignal.abort(), invalidate() {} }); return () => {} } } })
  assert.equal(provider.name, 'emate-ego-browser')
  const [skill] = await provider.list({})
  assert.equal(skill.name, 'ego-browser')
  assert.equal(skill.rank, 600)
  assert.equal(skill.metadata.upstreamCommit, 'c46a439e7fbad90ad33dbea6c6af329b6009809f')
  assert.deepEqual(skill.metadata.windowsCandidate, WINDOWS_EDGE_CANDIDATE)
  assert.deepEqual(skill.invocation, { modelInvocable: false, userInvocable: false })
  const loaded = await provider.get(skill, {})
  assert.match(loaded.content, /Harness Bash Tool/)
  assert.match(loaded.content, /EGO_BROWSER_UNSUPPORTED_PLATFORM/)
  assert.match(loaded.content, /PLAYWRIGHT_MCP_EDGE_UNVERIFIED/)
  assert.doesNotMatch(loaded.content, /fetch\(['"]\/api|new WebSocket|playwright install/i)
})

test('Windows Edge candidate stays pinned, dependency-free, and disconnected', async () => {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  const patch = await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
  const source = await readFile(new URL('../SOURCE.md', import.meta.url), 'utf8')
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(manifest.dsh.upstream.commit, 'c46a439e7fbad90ad33dbea6c6af329b6009809f')
  assert.deepEqual(manifest.dependencies, undefined)
  assert.deepEqual(manifest.optionalDependencies, undefined)
  assert.deepEqual(manifest.peerDependencies, undefined)
  assert.deepEqual(manifest.eMate, {
    harnessVersion: '0.1.0-rc.5',
    harnessCommit: '47f943859bef60e4160492346772ded9b24f765a',
  })
  assert.equal(WINDOWS_EDGE_CANDIDATE.version, '0.0.78')
  assert.equal(WINDOWS_EDGE_CANDIDATE.commit, '5f8fc00210b27b4407c375b59cda4838045d429c')
  assert.equal(WINDOWS_EDGE_CANDIDATE.browser, 'msedge')
  assert.doesNotMatch(patch, /dsh-mcp-client|playwright/i)
  assert.doesNotMatch(source, /@latest|install-browser\s+--|--allow-unrestricted-file-access|--no-sandbox/)
  assert.match(source, /capabilities: \{\}/)
})

test('pinned rc.5 exposes no session-bound MCP workspace-root path', async () => {
  const harness = new URL('../../../upstream/deepseek-harness/', import.meta.url)
  const [mcpPlugin, mcpConnection, presets, acp] = await Promise.all([
    readFile(new URL('packages/mcp/mcp-client/src/index.ts', harness), 'utf8'),
    readFile(new URL('packages/mcp/mcp-client/src/connection.ts', harness), 'utf8'),
    readFile(new URL('packages/preset/agent-presets/src/index.ts', harness), 'utf8'),
    readFile(new URL('packages/acp/acp/src/index.ts', harness), 'utf8'),
  ])
  assert.match(mcpPlugin, /export const inject = \['tools'\]/)
  assert.match(mcpPlugin, /cwd: z\.string\(\)\.default\(''\)/)
  assert.doesNotMatch(mcpPlugin, /workspaceRegistry|sessions|agentPresets/)
  assert.match(mcpConnection, /\{ capabilities: \{\} \}/)
  assert.doesNotMatch(mcpConnection, /roots\/list|ListRoots|workspaceRegistry|session\.header\.cwd/)
  assert.match(presets, /private readonly standing = new Map<string, Promise<StandingMount>>\(\)/)
  assert.match(presets, /this\.standing\.get\(preset\.id\)/)
  assert.match(acp, /if \(params\.mcpServers\.length > 0\) throw invalidParams\('mcpServers is not supported'\)/)
})
