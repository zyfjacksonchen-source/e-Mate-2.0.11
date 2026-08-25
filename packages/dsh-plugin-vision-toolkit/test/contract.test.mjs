import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'

const root = new URL('../', import.meta.url)
const builtModules = new Map()
const target = process.env.EMATE_COMPONENT_TARGET
const targetTest = target === undefined ? test.skip : test

async function loadBuiltModule(relative = 'lib/index.mjs') {
  if (builtModules.has(relative)) return builtModules.get(relative)
  const { installProfilePackageResolver } = await import(new URL(
    '../../../desktop/e-mate-desktop/src/module-resolution.ts',
    import.meta.url,
  ))
  const base = JSON.parse(await readFile(new URL('../../../desktop/e-mate-desktop/base-contract.json', import.meta.url)))
  const desktopEntry = pathToFileURL(resolve(
    fileURLToPath(new URL('../../../desktop/e-mate-desktop/lib/index.js', import.meta.url)),
  )).href
  const dispose = installProfilePackageResolver(
    desktopEntry,
    [fileURLToPath(root)],
    base.runtime_imports,
    new URL('.test-loader.mjs', root).href,
    new URL('../../../upstream/deepseek-harness/packages/host/apiproxy/package.json', import.meta.url).href,
  )
  try {
    const module = await import(new URL(relative, root))
    builtModules.set(relative, module)
    return module
  } finally {
    dispose()
  }
}

test('Vision Toolkit preserves the native Host and Client surfaces as one managed Profile component', async () => {
  const [manifest, patch, source, buildScript, built, client] = await Promise.all([
    readFile(new URL('package.json', root), 'utf8'),
    readFile(new URL('cordis.patch.yml', root), 'utf8'),
    readFile(new URL('src/index.ts', root), 'utf8'),
    readFile(new URL('scripts/build.mjs', root), 'utf8'),
    readFile(new URL('lib/index.mjs', root), 'utf8'),
    readFile(new URL('lib/client.js', root), 'utf8'),
  ])
  const pkg = JSON.parse(manifest)
  assert.equal(pkg.version, '2.0.13')
  assert.equal(pkg.eMate.component.kind, 'platform-profile')
  assert.equal(pkg.dsh.visionToolkit.adapterState, 'managed')
  assert.equal(pkg.dsh.visionToolkit.upstreamCommit, 'bc9803d7d6300c864d17460ecbb33540b26638e0')
  assert.equal(pkg.dsh.upstream.commit, '29850a83871d4b7a7cc13e251420c5a440e2f69e')
  assert.equal(pkg.dependencies.saxes, '6.0.0')
  assert.equal(pkg.eMate.harnessVersion, '0.1.0-rc.7')
  assert.equal(pkg.exports['./client'], './lib/client.js')
  assert.deepEqual(pkg.dsh.client, {
    inject: [
      '@deepseek-ai/dsh-api-remotes',
      '@deepseek-ai/dsh-client-runtime',
      '@deepseek-ai/dsh-client-ui-conversation',
      '@deepseek-ai/dsh-client-ui-tool',
      '@deepseek-ai/dsh-client-ui-settings',
      '@deepseek-ai/dsh-client-ui-input-trigger',
      '@deepseek-ai/dsh-client-locale',
    ],
    platform: 'web',
  })
  assert.deepEqual(pkg.eMate.component.base_imports, [
    '@deepseek-ai/dsh-client-ui-primitives',
    '@deepseek-ai/dsh-credentials',
    '@deepseek-ai/dsh-settings',
    '@deepseek-ai/dsh-tools',
    '@deepseek-ai/schemastery',
    '@e-mate/desktop/vision-toolkit',
    'react',
  ])
  assert.doesNotMatch(patch, /provider|credential|model|baseUrl/u)
  assert.match(source, /settings must match the enterprise model policy/u)
  assert.match(source, /sandboxPolicy\.resolve/u)
  assert.match(source, /'sandboxPolicy'/u)
  assert.match(source, /@e-mate\/desktop\/vision-toolkit/u)
  assert.equal(
    buildScript.includes("neverBundle: [/^@deepseek-ai\\//, /^@e-mate\\/desktop\\//, '@standard-schema/spec']"),
    true,
  )
  assert.match(built, /vision_glance/u)
  assert.match(built, /vision_long_screenshot_ocr/u)
  assert.match(built, /@e-mate\/dsh-plugin-vision-toolkit/u)
  assert.match(client, /@e-mate\/dsh-plugin-vision-toolkit/u)
  for (const surface of [
    'vision_ground',
    'vision_detect',
    'vision_trace',
    'vision_pixel_diff',
    'vision_crop',
    'vision_long_screenshot_ocr',
    'vision_extract_foreground',
    'vision_html_screenshot',
    'vision_dominant_colors',
    'tool.call.toolview',
    'conversation.input.dock',
    'settings.section',
    '/_dsh/vision-toolkit/paste-images',
  ]) assert.match(client, new RegExp(surface.replaceAll('.', '\\.')))
  assert.doesNotMatch(client, /@anionex\/dsh-vision-toolkit/u)
  assert.match(client, /disabled: !snapshot\.writable \|\| busy/u)
  assert.doesNotMatch(built, /from\s+["']saxes["']/u)
  assert.doesNotMatch(built, /__applyPinnedVisionToolkit|__VisionToolkitWebBackend/u)
  assert.match(built, /managed Settings generation refused; runtime remains unavailable/u)
  assert.match(built, /vision-toolkit settings must match the enterprise model policy/u)
  assert.equal(existsSync(new URL('runtime/requirements.lock', root)), true)
  assert.equal(existsSync(new URL('vendor/agent-vision-toolkit/UPSTREAM_MANIFEST.json', root)), true)
})

targetTest('Vision ships one signed offline CPython wheel closure for the selected target', async () => {
  const wheelRoot = new URL(`runtime/wheels/${target}/`, root)
  const files = (await readdir(wheelRoot)).sort()
  assert.equal(files.length, 3)
  assert.deepEqual(files.map(file => file.split('-')[0]).sort(), ['numpy', 'pillow', 'vtracer'])
  const requirements = await readFile(new URL('runtime/requirements.lock', root), 'utf8')
  for (const file of files) {
    const digest = createHash('sha256').update(await readFile(new URL(file, wheelRoot))).digest('hex')
    assert.match(requirements, new RegExp(`--hash=sha256:${digest}`))
  }
  const installer = await readFile(new URL('.build/upstream-lib/runtime-install.js', root), 'utf8')
  assert.match(installer, /PIP_NO_INDEX: '1'/u)
  assert.match(installer, /UV_NO_INDEX: '1'/u)
  assert.equal((installer.match(/'--no-index'/gu) ?? []).length, 2)
  assert.equal((installer.match(/'--find-links'/gu) ?? []).length, 2)
  assert.equal((installer.match(/'--require-hashes'/gu) ?? []).length, 2)
})

targetTest('Vision prepares and reuses its managed runtime without a package index', { timeout: 120_000 }, async () => {
  const python = process.env.EMATE_BUILD_PYTHON
  assert.ok(python && existsSync(python), 'EMATE_BUILD_PYTHON must point to the target CPython 3.12 runtime')
  const state = await mkdtemp(join(tmpdir(), 'e-mate-vision-runtime-'))
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = state
  try {
    const [{ prepareUpstreamRuntime }, { visionConfigFromModelSettings }, { spawnSubprocess }] = await Promise.all([
      loadBuiltModule('.test-lib/test-entry.mjs'),
      loadBuiltModule(),
      import(new URL('../../../upstream/deepseek-harness/packages/subprocess/subprocess-local/lib/types/spawn.js', import.meta.url)),
    ])
    const config = visionConfigFromModelSettings({
      providers: {
        'e-mate-enterprise': {
          apiKeyEnv: 'E_MATE_MODEL_KEY_GPT',
          api: 'openai-responses',
          baseURL: 'https://models.example/v1',
          models: [{ id: 'gpt-5.6-luna', input: ['text', 'image'] }],
        },
      },
    })
    assert.ok(config)
    config.runtime.python = python
    const subprocess = {
      resolveExecutable: async () => { throw new Error('uv must not be required') },
      spawn: spec => spawnSubprocess({
        ...spec,
        env: {
          ...spec.env,
          HTTP_PROXY: 'http://127.0.0.1:1',
          HTTPS_PROXY: 'http://127.0.0.1:1',
          PIP_INDEX_URL: 'http://127.0.0.1:1/simple',
        },
      }),
    }
    const first = await prepareUpstreamRuntime({ subprocess }, config)
    assert.equal(first.pythonVersion, '3.12.14')
    assert.deepEqual(first.dependencies, { pillow: '12.3.0', numpy: '2.4.6', vtracer: '0.6.15' })
    const second = await prepareUpstreamRuntime({ subprocess }, config)
    assert.equal(second.python.program, first.python.program)
    assert.deepEqual(second.dependencies, first.dependencies)
  } finally {
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    await rm(state, { recursive: true, force: true })
  }
})

targetTest('managed Vision Web reports read-only state and cannot overwrite enterprise settings or credentials', async () => {
  const { VisionToolkitWebBackend: Backend } = await loadBuiltModule('.test-lib/test-entry.mjs')
  const writes = []
  const ctx = {
    settings: {
      writable: true,
      describe: () => [{ ns: 'vision-toolkit', value: {}, revision: 0 }],
      replace: async (...args) => { writes.push(['settings', ...args]) },
    },
    credentials: {
      describe: async () => ({ configured: true, source: 'file', writable: true }),
      set: async (...args) => { writes.push(['credential', ...args]) },
    },
  }
  const manager = {
    status: () => ({ ready: true, generation: 1 }),
    prepareCandidate: async () => { throw new Error('must not prepare') },
  }
  const backend = new Backend(ctx, manager, { routeAvailable: true }, () => {}, true)
  const snapshot = await backend.snapshot()
  assert.equal(snapshot.writable, false)
  assert.equal(snapshot.credential.writable, false)
  await assert.rejects(backend.save({}), /managed by the enterprise model policy/u)
  await assert.rejects(backend.saveCredential({}), /managed by the enterprise model policy/u)
  assert.deepEqual(writes, [])
})

targetTest('Vision read tools do not create artifact directories and write tools honor the session sandbox', async () => {
  const { createPathPolicy, createVisionTools } = await loadBuiltModule('.test-lib/test-entry.mjs')
  const workspace = await mkdtemp(join(tmpdir(), 'e-mate-vision-policy-'))
  try {
    const readPolicy = await createPathPolicy(workspace, [], undefined, false)
    assert.equal(existsSync(readPolicy.outputDir), false)

    const runtimeCalls = []
    const runtime = new Proxy({}, {
      get: (_target, key) => async () => { runtimeCalls.push(String(key)); return {} },
    })
    let writeChecks = 0
    const definitions = createVisionTools(runtime, value => value, undefined, () => {
      writeChecks += 1
      throw new Error('read-only sandbox policy')
    })
    const byName = name => definitions.find(definition => definition.name === name)
    const exec = {
      agent: { session: { header: { id: 'vision-test', cwd: workspace } } },
      signal: new AbortController().signal,
    }
    const writeArgs = new Map([
      ['vision_trace', { image: 'input.png' }],
      ['vision_crop', { image: 'input.png', region: '0,0,1,1' }],
      ['vision_pixel_diff', { original: 'a.png', rebuilt: 'b.png' }],
      ['vision_long_screenshot_ocr', { image: 'input.png' }],
      ['vision_extract_foreground', { image: 'input.png' }],
      ['vision_html_screenshot', { source: 'input.html' }],
    ])
    for (const [name, args] of writeArgs) {
      await assert.rejects(byName(name).execute(args, exec), /read-only sandbox policy/u)
    }
    for (const name of ['vision_ground', 'vision_detect']) {
      const args = name === 'vision_ground'
        ? { image: 'input.png', target: 'button' }
        : { image: 'input.png' }
      await assert.rejects(byName(name).execute({ ...args, preview: true }, exec), /read-only sandbox policy/u)
      await byName(name).execute({ ...args, preview: false }, exec)
    }
    await byName('vision_glance').execute({ images: ['input.png'] }, exec)
    await byName('vision_dominant_colors').execute({ image: 'input.png' }, exec)
    assert.equal(writeChecks, 8)
    assert.deepEqual(runtimeCalls.sort(), ['detect', 'dominantColors', 'glance', 'ground'])

    const stagedRuntime = await readFile(new URL('.build/upstream-lib/runtime.js', root), 'utf8')
    assert.equal((stagedRuntime.match(/pathPolicy\(options\.workspace, false\)/gu) ?? []).length, 3)
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

targetTest('derives the native Responses protocol from the enterprise model projection', async () => {
  const { visionConfigFromModelSettings } = await loadBuiltModule()
  const projected = {
    providers: {
      'e-mate-enterprise': {
        apiKeyEnv: 'E_MATE_MODEL_KEY_GPT',
        api: 'openai-responses',
        baseURL: 'https://models.example/v1',
        models: [{ id: 'gpt-5.6-luna', input: ['text', 'image'] }],
      },
    },
  }
  assert.equal(visionConfigFromModelSettings(projected).provider.protocol, 'responses')
  projected.providers['e-mate-enterprise'].api = 'openai-completions'
  assert.equal(visionConfigFromModelSettings(projected), undefined)
})

targetTest('managed Vision replaces a stale saved route before strict policy validation and runtime startup', async () => {
  const { apply: applyPinned } = await loadBuiltModule('.test-lib/test-entry.mjs')
  const stale = { provider: { baseUrl: 'https://stale.example/v1', model: 'stale-model' } }
  const managed = {
    provider: { baseUrl: 'https://managed.example/v1', model: 'managed-model' },
    runtime: { mode: 'external', agentVisionToolkitPath: '/definitely-missing-e-mate-vision-runtime' },
  }
  let current = stale
  let validate
  const replacements = []
  const ctx = {
    settings: {
      register: (_namespace, _schema, options) => {
        validate = options.validate
        validate(current)
        return { get: () => current, watch: () => () => {} }
      },
      replace: async (_namespace, value) => {
        validate(value)
        replacements.push(value)
        current = value
      },
    },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    inject: () => {},
  }
  const dispose = await applyPinned(ctx, managed, {
    managed: true,
    validateConfig(value) {
      assert.deepEqual(value.provider.baseUrl, 'https://managed.example/v1')
      assert.deepEqual(value.provider.model, 'managed-model')
    },
  })
  assert.equal(replacements.length, 1)
  assert.equal(current, managed)
  assert.throws(() => { validate(stale) }, /Expected values to be strictly deep-equal/u)
  dispose()
})

targetTest('managed Vision runtime stays unavailable when a replacement policy generation is refused', async () => {
  const [{ VisionToolkitRuntimeManager }, { visionConfigFromModelSettings }] = await Promise.all([
    loadBuiltModule('.test-lib/test-entry.mjs'),
    loadBuiltModule(),
  ])
  const projected = {
    providers: {
      'e-mate-enterprise': {
        apiKeyEnv: 'E_MATE_MODEL_KEY_GPT',
        api: 'openai-responses',
        baseURL: 'https://models-a.example/v1',
        models: [{ id: 'gpt-5.6-luna', input: ['text', 'image'] }],
      },
    },
  }
  const first = visionConfigFromModelSettings(projected)
  assert.ok(first)
  const second = structuredClone(first)
  second.provider.baseUrl = 'https://models-b.example/v1'
  let refuseSecond = true
  const manager = new VisionToolkitRuntimeManager(
    { logger: { info: () => {} } },
    async (_ctx, config) => {
      if (refuseSecond && config.provider.baseUrl === second.provider.baseUrl) throw new Error('replacement refused')
      return { config, upstreamVersion: { version: 'test', commit: 'a'.repeat(40), path: '/test' } }
    },
  )
  await manager.initialize(first)
  assert.equal(manager.status().ready, true)
  manager.deactivate()
  assert.equal(manager.status().ready, false)
  assert.throws(() => manager.current(), /runtime is not ready/u)
  await assert.rejects(manager.reconfigure(second), /replacement refused/u)
  assert.equal(manager.status().ready, false)
  refuseSecond = false
  await manager.reconfigure(second)
  assert.equal(manager.status().activeConfig.provider.baseUrl, second.provider.baseUrl)
})

test('Vision capability readiness is bounded, abortable, and cached between refreshes', async () => {
  const source = await readFile(new URL('src/index.ts', root), 'utf8')
  assert.match(source, /AbortSignal\.any\(\[signal, AbortSignal\.timeout\(3_000\)\]\)/u)
  assert.match(source, /value\.state === 'ready' \? 30_000 : 2_000/u)
  assert.match(source, /status,\n/u)
  assert.match(source, /credentials\/updated/u)
  assert.doesNotMatch(source, /statusPromise/u)
  assert.match(source, /if \(epoch === statusEpoch\)/u)
})
