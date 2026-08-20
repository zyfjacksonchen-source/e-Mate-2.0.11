import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import { isBaseProfileRuntimeSpecifier } from '../src/module-resolution.ts'

const execFileAsync = promisify(execFile)

describe('hot Profile component runtime boundary', () => {
  it('exposes only the exact Base ABI imports declared by that component', () => {
    const imports = new Set(['@deepseek-ai/dsh-tools', '@e-mate/desktop/vision-toolkit', 'react'])
    expect(isBaseProfileRuntimeSpecifier('@deepseek-ai/dsh-tools', imports)).toBe(true)
    expect(isBaseProfileRuntimeSpecifier('@deepseek-ai/dsh-tools/internal', imports)).toBe(true)
    expect(isBaseProfileRuntimeSpecifier('react/jsx-runtime', imports)).toBe(true)
    expect(isBaseProfileRuntimeSpecifier('@e-mate/desktop/vision-toolkit', imports)).toBe(true)
    expect(isBaseProfileRuntimeSpecifier('@e-mate/desktop/updates', imports)).toBe(false)
    expect(isBaseProfileRuntimeSpecifier('@e-mate/desktop/profile-service', imports)).toBe(false)
    expect(isBaseProfileRuntimeSpecifier('@e-mate/desktop/terminal', imports)).toBe(false)
    expect(isBaseProfileRuntimeSpecifier('@deepseek-ai/dsh-skill-filesystem', imports)).toBe(false)
    expect(isBaseProfileRuntimeSpecifier('react-dom/client', imports)).toBe(false)
    expect(isBaseProfileRuntimeSpecifier('@modelcontextprotocol/sdk/client/index.js', imports)).toBe(false)
    expect(isBaseProfileRuntimeSpecifier('yaml', imports)).toBe(false)
    expect(isBaseProfileRuntimeSpecifier('zod', imports)).toBe(false)
    expect(isBaseProfileRuntimeSpecifier('@e-mate/dsh-plugin-sibling', imports)).toBe(false)
    expect(isBaseProfileRuntimeSpecifier('@e-mate/plugin', imports)).toBe(false)
  })

  it('blocks dynamic undeclared package imports at the runtime boundary', async () => {
    const temporary = await mkdtemp(join(tmpdir(), 'e-mate-runtime-boundary-'))
    const root = join(temporary, 'component')
    const sibling = join(temporary, 'sibling.mjs')
    const runner = join(temporary, 'runner.mjs')
    await mkdir(root)
    await writeFile(join(root, 'package.json'), JSON.stringify({
      eMate: { component: { base_imports: [] } },
    }))
    await writeFile(join(root, 'builtin.mjs'), "export const value = typeof (await import('fs')).readFile === 'function'\n")
    await writeFile(join(root, 'inside.mjs'), 'export const value = true\n')
    await writeFile(join(root, 'relative.mjs'), "export const value = (await import('./inside.mjs')).value\n")
    await writeFile(join(root, 'blocked.mjs'), "const name = '@e-mate/desktop/' + 'updates'; await import(name)\n")
    await writeFile(sibling, 'export const value = false\n')
    await writeFile(join(root, 'sibling-escape.mjs'), "await import('../sibling.mjs')\n")
    await writeFile(join(root, 'file-escape.mjs'), `await import(${JSON.stringify(pathToFileURL(sibling).href)})\n`)
    await writeFile(runner, `
import assert from 'node:assert/strict'
import { installProfilePackageResolver } from ${JSON.stringify(new URL('../src/module-resolution.ts', import.meta.url).href)}
import { pathToFileURL } from 'node:url'
const root = ${JSON.stringify(root)}
const dispose = installProfilePackageResolver(import.meta.url, [root], {})
const blocked = async (file, message) => {
  try { await import(pathToFileURL(file).href) } catch (error) {
    assert.ok(String(error).includes(message), String(error))
    return
  }
  assert.fail('expected import to be blocked')
}
try {
  assert.equal((await import(pathToFileURL(root + '/builtin.mjs').href)).value, true)
  assert.equal((await import(pathToFileURL(root + '/relative.mjs').href)).value, true)
  await blocked(root + '/blocked.mjs', 'hot Profile component undeclared runtime import is blocked: @e-mate/desktop/updates')
  await blocked(root + '/sibling-escape.mjs', 'hot Profile component path escape is blocked: ../sibling.mjs')
  await blocked(root + '/file-escape.mjs', 'hot Profile component path escape is blocked: file:')
} finally { dispose() }
`)
    try {
      await expect(execFileAsync(process.execPath, [runner])).resolves.toMatchObject({ stderr: '' })
    } finally {
      await rm(temporary, { recursive: true, force: true })
    }
  })
})
