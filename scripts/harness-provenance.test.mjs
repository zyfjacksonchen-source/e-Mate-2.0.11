import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import test from 'node:test'

import {
  assertExactOccurrence,
  assertHarnessSource,
  assertHarnessSourceClean,
  DESKTOP_OVERLAYS,
  findDesktopHarnessPackages,
  HARNESS_COMMIT,
  hashDirectory,
} from './harness-provenance.mjs'

const root = resolve(import.meta.dirname, '..')
const harnessRoot = join(root, 'upstream', 'deepseek-harness')

test('pins one clean native model-directory refresh owner', () => {
  assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: harnessRoot, encoding: 'utf8' }).trim(), HARNESS_COMMIT)
  assert.doesNotThrow(() => assertHarnessSource(root))
  const source = readFileSync(join(
    harnessRoot,
    'packages/client/ui-model-selection/src/client/service.ts',
  ), 'utf8')
  assertExactOccurrence(source, "ctx.remote.$on('credentials/updated', refresh)", 'native model listener')
})

test('keeps exactly the three overlays still missing from e13', () => {
  assert.deepEqual([...DESKTOP_OVERLAYS], [
    ['@deepseek-ai/dsh-client-ui-workspace', 'desktop/patches/dsh-client-ui-workspace@0.1.0-rc.7.patch'],
    ['@deepseek-ai/dsh-sandbox-windows-acl', 'desktop/patches/dsh-sandbox-windows-acl@0.1.0-rc.7.patch'],
    ['@deepseek-ai/dsh-tool-fs', 'desktop/.yarn/patches/@deepseek-ai-dsh-tool-fs-npm-0.1.0-rc.7-redundant-escalation.patch'],
  ])

  const workspace = readFileSync(join(harnessRoot, 'packages/client/ui-workspace/src/client/WorkspaceBrowser.tsx'), 'utf8')
  const workspacePatch = readFileSync(join(root, DESKTOP_OVERLAYS.get('@deepseek-ai/dsh-client-ui-workspace')), 'utf8')
  assert.doesNotMatch(workspace, /data-dsh-workspace-drop-target/u)
  assert.match(workspacePatch, /data-dsh-workspace-drop-target/u)

  const windows = readFileSync(join(harnessRoot, 'packages/sandbox/sandbox-windows-acl/src/spawn.ts'), 'utf8')
  const windowsPatch = readFileSync(join(root, DESKTOP_OVERLAYS.get('@deepseek-ai/dsh-sandbox-windows-acl')), 'utf8')
  assert.equal(windows.match(/dwFlags: abi\.STARTF_USESTDHANDLES/gu)?.length, 2)
  assert.doesNotMatch(windows, /wShowWindow/u)
  assert.equal(windowsPatch.match(/^\+\s*wShowWindow: 0,/gmu)?.length, 2)

  const source = readFileSync(join(harnessRoot, 'packages/fs/tool-fs/src/sandbox.ts'), 'utf8')
  assertExactOccurrence(
    source,
    'validateEscalationArgs(args.sandbox_permissions, args.justification)',
    'native filesystem escalation validation',
  )
  assert.doesNotMatch(source, /redundantEscalation/u)

  for (const path of [
    'packages/shell/tool-bash/src/index.ts',
    'packages/shell/tool-pwsh/src/index.ts',
  ]) {
    const native = readFileSync(join(harnessRoot, path), 'utf8')
    assert.match(native, /const redundantEscalation =/u)
  }
})

test('rejects zero or two native owners instead of guessing', () => {
  assert.throws(() => assertExactOccurrence('', 'owner', 'fixture owner'), /expected once, found 0/u)
  assert.throws(() => assertExactOccurrence('owner\nowner', 'owner', 'fixture owner'), /expected once, found 2/u)
})

test('rejects tracked and untracked dirty Harness source', () => {
  const directory = mkdtempSync(join(tmpdir(), 'e-mate-harness-clean-'))
  const tracked = join(directory, 'tracked.txt')
  try {
    execFileSync('git', ['init', '--quiet'], { cwd: directory })
    writeFileSync(tracked, 'accepted\n')
    execFileSync('git', ['add', 'tracked.txt'], { cwd: directory })
    execFileSync('git', [
      '-c', 'user.name=e-Mate Test', '-c', 'user.email=test@example.invalid',
      'commit', '--quiet', '-m', 'fixture',
    ], { cwd: directory })
    assert.doesNotThrow(() => assertHarnessSourceClean(directory))

    writeFileSync(tracked, 'dirty\n')
    assert.throws(() => assertHarnessSourceClean(directory), /source must be clean/u)
    writeFileSync(tracked, 'accepted\n')
    assert.doesNotThrow(() => assertHarnessSourceClean(directory))

    writeFileSync(join(directory, 'untracked.txt'), 'dirty\n')
    assert.throws(() => assertHarnessSourceClean(directory), /source must be clean/u)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('hashes emitted libs deterministically and rejects byte drift', () => {
  const directory = mkdtempSync(join(tmpdir(), 'e-mate-harness-hash-'))
  const reverse = mkdtempSync(join(tmpdir(), 'e-mate-harness-hash-reverse-'))
  try {
    mkdirSync(join(directory, 'nested'))
    writeFileSync(join(directory, 'z.js'), 'z\n')
    writeFileSync(join(directory, 'nested', 'a.js'), 'a\n')
    writeFileSync(join(reverse, 'z.js'), 'z\n')
    mkdirSync(join(reverse, 'nested'))
    writeFileSync(join(reverse, 'nested', 'a.js'), 'a\n')
    const first = hashDirectory(directory)
    assert.equal(hashDirectory(directory), first)
    assert.equal(hashDirectory(reverse), first)
    writeFileSync(join(directory, 'nested', 'a.js'), 'changed\n')
    assert.notEqual(hashDirectory(directory), first)
  } finally {
    rmSync(directory, { recursive: true, force: true })
    rmSync(reverse, { recursive: true, force: true })
  }
})

test('discovers root and nested physical Desktop Harness packages', () => {
  const directory = mkdtempSync(join(tmpdir(), 'e-mate-desktop-closure-'))
  const writePackage = (path, name) => {
    mkdirSync(path, { recursive: true })
    writeFileSync(join(path, 'package.json'), `${JSON.stringify({ name, version: '0.1.0-rc.7' })}\n`)
  }
  try {
    writePackage(join(directory, '@deepseek-ai/dsh-session'), '@deepseek-ai/dsh-session')
    writePackage(join(directory, 'holder'), 'holder')
    writePackage(
      join(directory, 'holder/node_modules/@deepseek-ai/dsh-session-persistence'),
      '@deepseek-ai/dsh-session-persistence',
    )
    assert.deepEqual(
      findDesktopHarnessPackages(directory).map(value => relative(directory, value.path)),
      ['@deepseek-ai/dsh-session', 'holder/node_modules/@deepseek-ai/dsh-session-persistence'],
    )
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('Desktop declares no Session, model-directory, bash, or pwsh patch path', () => {
  const manifest = readFileSync(join(root, 'desktop/package.json'), 'utf8')
  assert.doesNotMatch(manifest, /"@deepseek-ai\/dsh-session(?:-persistence)?@npm:[^"]+":\s*"patch:/u)
  assert.doesNotMatch(manifest, /dsh-client-ui-model-selection@.*patch:/u)
  assert.doesNotMatch(manifest, /"@deepseek-ai\/dsh-tool-(?:bash|pwsh)@npm:[^"]+":\s*"patch:/u)
})
