import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, test } from 'node:test'
import { createServer } from 'node:http'
import { Context } from '../../../upstream/deepseek-harness/vendor/cordis/lib/index.js'
import SessionStore from '../../../upstream/deepseek-harness/packages/core/session/lib/index.js'
import JsonlSessionPersistence from '../../../upstream/deepseek-harness/packages/session/session-persistence-jsonl/lib/index.js'
import { defaultLegacySources, migrateLegacySessions } from '../lib/legacy-migration.js'
import { registerLegacyArtifactDownload } from '../profile/plugins/legacy-migration.js'

const temporary = []

afterEach(() => {
  for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true })
})

function scratch() {
  const path = mkdtempSync(join(tmpdir(), 'e-mate-legacy-test-'))
  temporary.push(path)
  return path
}

function digest(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

async function harnessPersistence(root) {
  const ctx = new Context()
  const sessionsFiber = await ctx.plugin(SessionStore)
  const persistenceFiber = await ctx.plugin(JsonlSessionPersistence, { root, compression: 'none' })
  return {
    ctx,
    async dispose() {
      await persistenceFiber.dispose()
      await sessionsFiber.dispose()
    },
  }
}

function cowDatabase(path, projectPath, artifactPath) {
  const database = new DatabaseSync(path)
  database.exec(`
    CREATE TABLE sessions (
      session_id TEXT NOT NULL,
      title TEXT,
      project_path TEXT,
      created_at INTEGER NOT NULL,
      last_active INTEGER NOT NULL
    );
    CREATE TABLE messages (
      session_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      extras TEXT,
      created_at INTEGER NOT NULL
    );
  `)
  database.prepare('INSERT INTO sessions VALUES (?, ?, ?, ?, ?)')
    .run('cow-session', '旧会话', projectPath, 1_700_000_000, 1_700_000_003)
  database.prepare('INSERT INTO messages VALUES (?, ?, ?, ?, ?, ?)')
    .run('cow-session', 1, 'user', JSON.stringify({ text: '你好' }), '{}', 1_700_000_001)
  database.prepare('INSERT INTO messages VALUES (?, ?, ?, ?, ?, ?)')
    .run(
      'cow-session',
      2,
      'assistant',
      JSON.stringify([{ text: '你好，我是 e-Mate' }]),
      artifactPath === undefined ? '{}' : JSON.stringify({
        artifacts: [
          { path: artifactPath, title: '报告.docx', status: 'ready', intent: 'deliverable' },
          { path: join(artifactPath, '..', 'missing.docx'), title: '缺失.docx', status: 'ready', intent: 'deliverable' },
        ],
      }),
      1_700_000_002,
    )
  database.close()
}

function runtimeDatabase(path, projectPath) {
  const artifactBytes = Buffer.from('legacy runtime PDF bytes')
  const artifactDigest = createHash('sha256').update(artifactBytes).digest('hex')
  const artifactPath = join(
    dirname(path),
    'artifacts',
    'blobs',
    artifactDigest.slice(0, 2),
    artifactDigest.slice(2, 4),
    artifactDigest,
  )
  mkdirSync(dirname(artifactPath), { recursive: true })
  writeFileSync(artifactPath, artifactBytes)
  const database = new DatabaseSync(path)
  database.exec(`
    CREATE TABLE threads (
      thread_id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      title TEXT,
      metadata_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE turns (
      turn_id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      status TEXT NOT NULL,
      input_text TEXT NOT NULL,
      agent_model_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE items (
      item_id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      turn_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      content_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE projects (project_id TEXT PRIMARY KEY, project_path TEXT NOT NULL);
    CREATE TABLE project_thread_bindings (thread_id TEXT PRIMARY KEY, project_id TEXT NOT NULL);
  `)
  const insertThread = database.prepare('INSERT INTO threads VALUES (?, ?, ?, ?, ?, ?)')
  insertThread.run('active-thread', 'active', '运行态会话', '{}', '2026-08-01T00:00:00Z', '2026-08-01T00:00:03Z')
  insertThread.run('deleted-thread', 'deleted', '已删除', '{}', '2026-08-01T00:00:00Z', '2026-08-01T00:00:03Z')
  database.prepare('INSERT INTO turns VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run('turn-1', 'active-thread', 'completed', '生成报告', 'ecorex-chat', '2026-08-01T00:00:01Z', '2026-08-01T00:00:03Z')
  const insertItem = database.prepare('INSERT INTO items VALUES (?, ?, ?, ?, ?, ?, ?)')
  insertItem.run('assistant-1', 'active-thread', 'turn-1', 'message', 'completed', JSON.stringify({ role: 'assistant', text: '报告已生成' }), '2026-08-01T00:00:02Z')
  insertItem.run('tool-1', 'active-thread', 'turn-1', 'tool_call', 'completed', JSON.stringify({ name: 'legacy_tool', arguments: '{}' }), '2026-08-01T00:00:02Z')
  insertItem.run('runtime-artifact', 'active-thread', 'turn-1', 'artifact', 'completed', JSON.stringify({
    artifact: {
      role: 'deliverable',
      status: 'ready',
      display_name: 'runtime.pdf',
      mime_type: 'application/pdf',
      size_bytes: artifactBytes.byteLength,
      sha256: artifactDigest,
    },
  }), '2026-08-01T00:00:02Z')
  database.prepare('INSERT INTO projects VALUES (?, ?)').run('project-1', projectPath)
  database.prepare('INSERT INTO project_thread_bindings VALUES (?, ?)').run('active-thread', 'project-1')
  database.close()
  return { artifactDigest, artifactPath }
}

test('default legacy discovery resolves candidate roots without Array.map callback arguments', () => {
  const root = scratch()
  assert.deepEqual(defaultLegacySources({
    dshHome: join(root, 'dsh'),
    home: join(root, 'home'),
    environment: {},
    platform: 'darwin',
  }), [])
})

test('imports CowAgent sessions through the real Harness SessionPersistence and replays idempotently', async () => {
  const root = scratch()
  const sourceRoot = join(root, 'cow')
  const dshHome = join(root, 'dsh')
  const project = join(root, 'project')
  mkdirSync(sourceRoot, { recursive: true })
  mkdirSync(project)
  const source = join(sourceRoot, 'conversations.db')
  const artifact = join(sourceRoot, 'outputs', 'report.docx')
  mkdirSync(join(sourceRoot, 'outputs'))
  writeFileSync(artifact, 'legacy office bytes')
  cowDatabase(source, project, artifact)
  const before = digest(source)
  const artifactDigest = digest(artifact)
  const harness = await harnessPersistence(join(dshHome, 'sessions'))
  const { ctx } = harness
  try {
    const options = {
      sessionPersistence: ctx.sessionPersistence,
      dshHome,
      sources: [{ family: 'cowagent', root: sourceRoot, database: source }],
    }
    const first = await migrateLegacySessions(options)
    assert.equal(first.imported_sessions, 1)
    assert.equal(first.reused_sessions, 0)
    const [header] = await ctx.sessionPersistence.list()
    assert.equal(header.cwd, project)
    const loaded = await ctx.sessionPersistence.inspect(header.id)
    assert.deepEqual(loaded.meta, {
      version: 0,
      id: header.id,
      createdAt: 1_700_000_000_000,
      cwd: project,
      delegationDepth: 0,
    })
    assert.deepEqual(loaded.events.map(event => event.type), [
      'turn/start', 'user/message', 'step/start', 'assistant/message', 'step/end', 'turn/end',
      'emate/legacy-artifacts', 'session/title',
    ])
    assert.equal(loaded.events.find(event => event.type === 'assistant/message').data.message.content[0].text, '你好，我是 e-Mate')
    const artifactEvent = loaded.events.find(event => event.type === 'emate/legacy-artifacts')
    assert.equal(artifactEvent.data.items[0].artifact_id, `legacy-sha256:${artifactDigest}`)
    assert.deepEqual(artifactEvent.data.items[1], {
      status: 'unavailable',
      reason: 'missing-or-unsafe',
      kind: 'artifact',
      message_seq: '2',
      name: '缺失.docx',
    })
    const object = join(dshHome, 'e-mate', 'attachments', 'legacy-v1', 'objects', artifactDigest.slice(0, 2), artifactDigest.slice(2, 4), artifactDigest)
    assert.equal(readFileSync(object, 'utf8'), 'legacy office bytes')
    const second = await migrateLegacySessions(options)
    assert.equal(second.imported_sessions, 0)
    assert.equal(second.reused_sessions, 1)
    assert.equal((await ctx.sessionPersistence.list()).length, 1)
    assert.equal(digest(source), before)
    assert.equal(digest(artifact), artifactDigest)
  } finally {
    await harness.dispose()
  }
})

test('imports only non-deleted ECoreX Runtime threads and preserves tool history as evidence', async () => {
  const root = scratch()
  const sourceRoot = join(root, 'ECoreX')
  const dshHome = join(root, 'dsh')
  const project = join(root, 'project')
  mkdirSync(sourceRoot, { recursive: true })
  mkdirSync(project)
  const source = join(sourceRoot, 'runtime.sqlite3')
  const runtimeArtifact = runtimeDatabase(source, project)
  const before = digest(source)
  const harness = await harnessPersistence(join(dshHome, 'sessions'))
  const { ctx } = harness
  try {
    const result = await migrateLegacySessions({
      sessionPersistence: ctx.sessionPersistence,
      dshHome,
      sources: [{ family: 'ecorex-runtime', root: sourceRoot, database: source }],
    })
    assert.equal(result.imported_sessions, 1)
    const [header] = await ctx.sessionPersistence.list()
    assert.equal(header.cwd, project)
    const loaded = await ctx.sessionPersistence.inspect(header.id)
    assert.equal(loaded.events.some(event => event.type === 'tool/call'), false)
    assert.equal(
      loaded.events.find(event => event.type === 'emate/legacy-artifacts').data.items[0].artifact_id,
      `legacy-sha256:${runtimeArtifact.artifactDigest}`,
    )
    assert.equal(digest(runtimeArtifact.artifactPath), runtimeArtifact.artifactDigest)
    const evidence = JSON.parse(readFileSync(join(dshHome, 'e-mate', 'migrations', 'legacy-evidence-v1', `${header.id}.json`), 'utf8'))
    assert.equal(evidence.omitted_items.some(item => item.item_id === 'tool-1'), true)
    assert.equal(digest(source), before)
  } finally {
    await harness.dispose()
  }
})

test('serves imported artifacts only by their verified content identity', async () => {
  const root = scratch()
  const dshHome = join(root, 'dsh')
  const content = Buffer.from('verified legacy artifact')
  const sha256 = createHash('sha256').update(content).digest('hex')
  const object = join(dshHome, 'e-mate', 'attachments', 'legacy-v1', 'objects', sha256.slice(0, 2), sha256.slice(2, 4), sha256)
  mkdirSync(dirname(object), { recursive: true })
  writeFileSync(object, content, { mode: 0o600 })
  let route
  registerLegacyArtifactDownload({ webServer: { register(value) { route = value; return () => {} } } }, dshHome)
  const server = createServer((request, response) => { route.handler(request, response) })
  await new Promise((resolveListen, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolveListen)
  })
  const base = `http://127.0.0.1:${server.address().port}${route.path}`
  try {
    const downloaded = await fetch(`${base}?id=${sha256}`)
    assert.equal(downloaded.status, 200)
    assert.equal(downloaded.headers.get('content-type'), 'application/octet-stream')
    assert.equal(downloaded.headers.get('x-content-type-options'), 'nosniff')
    assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), content)
    const head = await fetch(`${base}?id=${sha256}`, { method: 'HEAD' })
    assert.equal(head.status, 200)
    assert.equal(head.headers.get('content-length'), String(content.byteLength))
    assert.equal((await head.arrayBuffer()).byteLength, 0)
    assert.equal((await fetch(`${base}?id=bad`)).status, 400)
    assert.equal((await fetch(`${base}?id=${sha256}`, { method: 'POST' })).status, 405)
    writeFileSync(object, 'tampered')
    assert.equal((await fetch(`${base}?id=${sha256}`)).status, 404)
  } finally {
    await new Promise(resolveClose => server.close(resolveClose))
  }
})

test('fails closed before creating a Harness session when a source is not SQLite', async () => {
  const root = scratch()
  const sourceRoot = join(root, 'cow')
  const dshHome = join(root, 'dsh')
  mkdirSync(sourceRoot)
  const source = join(sourceRoot, 'conversations.db')
  writeFileSync(source, 'not sqlite')
  const harness = await harnessPersistence(join(dshHome, 'sessions'))
  const { ctx } = harness
  try {
    await assert.rejects(migrateLegacySessions({
      sessionPersistence: ctx.sessionPersistence,
      dshHome,
      sources: [{ family: 'cowagent', root: sourceRoot, database: source }],
    }))
    assert.deepEqual(await ctx.sessionPersistence.list(), [])
  } finally {
    await harness.dispose()
  }
})

test('validates every existing target identity before importing another source session', async () => {
  const root = scratch()
  const sourceRoot = join(root, 'cow')
  const dshHome = join(root, 'dsh')
  const project = join(root, 'project')
  mkdirSync(sourceRoot, { recursive: true })
  mkdirSync(project)
  const source = join(sourceRoot, 'conversations.db')
  cowDatabase(source, project)
  const harness = await harnessPersistence(join(dshHome, 'sessions'))
  const { ctx } = harness
  const options = {
    sessionPersistence: ctx.sessionPersistence,
    dshHome,
    sources: [{ family: 'cowagent', root: sourceRoot, database: source }],
  }
  try {
    await migrateLegacySessions(options)
    const [header] = await ctx.sessionPersistence.list()
    const existing = await ctx.sessionPersistence.inspect(header.id)
    const nextSeq = existing.events.length
    await ctx.sessionPersistence.append(header.id, [
      { type: 'turn/start', seq: nextSeq, time: 1_700_000_004_000, data: { turn: 2 } },
      { type: 'turn/end', seq: nextSeq + 1, time: 1_700_000_004_000, data: { turn: 2, reason: { kind: 'completed' } } },
    ])
    const database = new DatabaseSync(source)
    database.prepare('INSERT INTO sessions VALUES (?, ?, ?, ?, ?)')
      .run('new-session', '新增会话', project, 1_700_000_010, 1_700_000_010)
    database.close()
    await assert.rejects(migrateLegacySessions(options), /conflicts with its stable legacy identity/)
    assert.equal((await ctx.sessionPersistence.list()).length, 1)
  } finally {
    await harness.dispose()
  }
})
