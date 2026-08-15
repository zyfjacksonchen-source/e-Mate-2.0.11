import { createHash, randomUUID } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { basename, extname, isAbsolute, join, resolve, sep } from 'node:path'
import { loadTargetPlaywright, loadTargetTools, readManagedBinding } from './target-runtime.js'

export const name = 'emate-browser-computer-use'
export const inject = ['tools', 'subprocess', 'attachments', 'webServer', 'emateCapabilities']

const VERSION = '2.0.7'
const PLAYWRIGHT_VERSION = '1.61.1'
const SHA256 = /^[0-9a-f]{64}$/u
const DOWNLOAD_ID = /^browser_artifact:([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/u
const MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024
const MAX_SNAPSHOT_CHARS = 40_000
const MAX_ELEMENTS = 240

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function contained(root, relative, label) {
  if (typeof relative !== 'string' || relative === '' || relative.includes('\0') || isAbsolute(relative)) {
    throw new Error(`${label} path is invalid`)
  }
  const path = resolve(root, relative)
  if (!path.startsWith(`${root}${sep}`)) throw new Error(`${label} path escapes the Browser package`)
  return path
}

export function loadBrowserBinding(bindingPath = join(import.meta.dirname, 'runtime-binding.json')) {
  const binding = readManagedBinding(bindingPath)
  if (binding.browser_package !== `@e-mate/dsh-browser-${process.platform}-${process.arch}`
    || !isAbsolute(binding.browser_root)
    || !SHA256.test(binding.browser_manifest_sha256)) {
    throw new Error('e-Mate Browser binding is invalid')
  }
  const root = resolve(binding.browser_root)
  const manifestPayload = readFileSync(join(root, 'emate-browser.json'))
  if (sha256(manifestPayload) !== binding.browser_manifest_sha256) {
    throw new Error('e-Mate Browser manifest checksum mismatch')
  }
  const manifest = JSON.parse(manifestPayload.toString('utf8'))
  if (!isRecord(manifest)
    || manifest.schema_version !== 1
    || manifest.package !== binding.browser_package
    || manifest.version !== VERSION
    || manifest.os !== process.platform
    || manifest.cpu !== process.arch
    || manifest.chromium !== true
    || manifest.engine !== 'chromium-headless-shell'
    || manifest.playwright_version !== PLAYWRIGHT_VERSION
    || !SHA256.test(manifest.executable_sha256)) {
    throw new Error('e-Mate Browser manifest is invalid')
  }
  const executable = contained(root, manifest.executable, 'Chromium')
  const metadata = lstatSync(executable)
  if (!metadata.isFile() || sha256(readFileSync(executable)) !== manifest.executable_sha256) {
    throw new Error('e-Mate Chromium checksum mismatch')
  }
  return {
    root,
    executable,
    dshHome: resolve(binding.dsh_home),
    package: binding.browser_package,
    browserVersion: manifest.browser_version,
  }
}

function safeTimeout(value, fallback = 15_000) {
  if (value === undefined) return fallback
  if (!Number.isSafeInteger(value) || value < 100 || value > 60_000) {
    throw new Error('timeout must be an integer from 100 to 60000 milliseconds')
  }
  return value
}

function blockedAddress(address) {
  const normalized = address.toLowerCase().split('%', 1)[0]
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/u.exec(normalized)?.[1]
  const ipv4 = mapped ?? (/^\d+\.\d+\.\d+\.\d+$/u.test(normalized) ? normalized : undefined)
  if (ipv4 !== undefined) {
    const parts = ipv4.split('.').map(Number)
    return parts.length !== 4 || parts.some(part => !Number.isSafeInteger(part) || part < 0 || part > 255)
      || (parts[0] === 169 && parts[1] === 254)
  }
  const first = Number.parseInt(normalized.split(':', 1)[0], 16)
  return Number.isFinite(first) && (first & 0xffc0) === 0xfe80
    || normalized === 'fd00:ec2::254'
}

async function assertSafeBrowserUrl(value) {
  let url
  try {
    url = new URL(value)
  } catch {
    throw new Error('browser URL is invalid')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('browser navigation accepts only http and https URLs')
  }
  const addresses = await lookup(url.hostname, { all: true, verbatim: true })
  if (addresses.length === 0 || addresses.some(({ address }) => blockedAddress(address))) {
    throw new Error('browser URL resolves to a link-local or cloud-metadata address')
  }
  return url.href
}

function sessionIdFrom(exec) {
  const value = exec.agent?.id ?? exec.agent?.session?.id
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('browser Computer Use requires a live e-Mate session')
  }
  return value
}

function sessionKey(sessionId) {
  return sha256(Buffer.from(sessionId, 'utf8'))
}

function delay(milliseconds, signal) {
  signal?.throwIfAborted()
  let onAbort
  return new Promise((resolveDelay, reject) => {
    const timer = setTimeout(resolveDelay, milliseconds)
    onAbort = () => {
      clearTimeout(timer)
      reject(signal.reason ?? new Error('browser action cancelled'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  }).finally(() => { if (onAbort !== undefined) signal?.removeEventListener('abort', onAbort) })
}

async function waitForDevTools(handle, signal) {
  const deadline = Date.now() + 15_000
  let offset = 0
  let output = ''
  let outcome
  void handle.done.then(value => { outcome = value })
  while (Date.now() < deadline) {
    signal?.throwIfAborted()
    const read = handle.collected.stderr?.readFrom(offset)
    if (read === undefined || read.lossy) throw new Error('Chromium startup output exceeded its boundary')
    offset = read.nextOffset
    output = `${output}${read.text}`.slice(-32_768)
    const endpoint = /DevTools listening on (ws:\/\/[^\s]+)/u.exec(output)?.[1]
    if (endpoint !== undefined) return endpoint
    if (outcome !== undefined) {
      throw new Error(`Chromium exited before DevTools became ready (${outcome.signal ?? `exit ${String(outcome.exitCode)}`})`)
    }
    await delay(50, signal)
  }
  throw new Error('Chromium did not expose DevTools within 15 seconds')
}

function browserEnvironment() {
  return {
    LANG: process.env.LANG ?? 'C.UTF-8',
    LC_ALL: process.env.LC_ALL ?? 'C.UTF-8',
  }
}

async function snapshotPage(page) {
  const serialized = await page.evaluate(({ maxElements, maxChars }) => {
    const marker = 'data-emate-cu-ref'
    document.querySelectorAll(`[${marker}]`).forEach(element => element.removeAttribute(marker))
    const selector = 'a,button,input,textarea,select,summary,[role], [contenteditable="true"], [tabindex]'
    const elements = []
    for (const element of document.querySelectorAll(selector)) {
      if (!(element instanceof HTMLElement)) continue
      const style = getComputedStyle(element)
      const box = element.getBoundingClientRect()
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0
        || box.width === 0 || box.height === 0) continue
      const ref = elements.length + 1
      element.setAttribute(marker, String(ref))
      const tag = element.tagName.toLowerCase()
      const role = element.getAttribute('role') ?? (tag === 'a' ? 'link' : tag === 'button' ? 'button' : tag)
      const text = (element.getAttribute('aria-label')
        ?? element.getAttribute('title')
        ?? element.textContent
        ?? '').replace(/\s+/gu, ' ').trim().slice(0, 180)
      const entry = { ref, role, text }
      if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
        entry.type = element instanceof HTMLInputElement ? element.type : 'textarea'
        entry.placeholder = element.placeholder.slice(0, 120)
      }
      if (element instanceof HTMLAnchorElement) entry.href = element.href.slice(0, 500)
      if ('disabled' in element && element.disabled === true) entry.disabled = true
      elements.push(entry)
      if (elements.length >= maxElements) break
    }
    const body = (document.body?.innerText ?? '').replace(/\n{3,}/gu, '\n\n').trim()
    return JSON.stringify({
      url: location.href,
      title: document.title,
      text: body.slice(0, maxChars),
      truncated: body.length > maxChars || elements.length >= maxElements,
      elements,
    })
  }, { maxElements: MAX_ELEMENTS, maxChars: MAX_SNAPSHOT_CHARS })
  const value = JSON.parse(serialized)
  const refs = value.elements.map(element => {
    const detail = [element.text === '' ? undefined : JSON.stringify(element.text), element.type, element.placeholder]
      .filter(Boolean).join(' · ')
    return `[${String(element.ref)}] ${element.role}${detail === '' ? '' : ` ${detail}`}${element.disabled ? ' (disabled)' : ''}`
  }).join('\n')
  return {
    url: value.url,
    title: value.title,
    text: [value.text, refs === '' ? undefined : `Interactive elements:\n${refs}`].filter(Boolean).join('\n\n'),
    truncated: value.truncated,
  }
}

function safeSelector(value) {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > 500) {
    throw new Error('selector must be a non-empty CSS selector of at most 500 characters')
  }
  return value
}

function actionTarget(page, args) {
  if (args.ref !== undefined) {
    if (!Number.isSafeInteger(args.ref) || args.ref < 1 || args.ref > MAX_ELEMENTS) {
      throw new Error(`ref must be an integer from 1 to ${MAX_ELEMENTS}`)
    }
    return page.locator(`[data-emate-cu-ref="${String(args.ref)}"]`)
  }
  if (args.selector !== undefined) return page.locator(safeSelector(args.selector))
  throw new Error('this browser action requires ref or selector')
}

function downloadRoot(runtime) {
  return join(runtime.dshHome, 'e-mate', 'attachments', 'browser')
}

function safeFilename(value) {
  const raw = basename(typeof value === 'string' ? value : '').trim()
  const name = raw.replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/gu, '-').replace(/\s+/gu, ' ').slice(0, 120)
  return name === '' || name === '.' || name === '..' ? 'e-Mate-download.bin' : name
}

function mimeFor(name) {
  return ({
    '.pdf': 'application/pdf',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.zip': 'application/zip',
    '.json': 'application/json',
    '.txt': 'text/plain; charset=utf-8',
    '.csv': 'text/csv; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
  })[extname(name).toLowerCase()] ?? 'application/octet-stream'
}

function atomicWrite(path, content) {
  mkdirSync(resolve(path, '..'), { recursive: true })
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
  try {
    writeFileSync(temporary, content, { mode: 0o600 })
    renameSync(temporary, path)
  } finally {
    rmSync(temporary, { force: true })
  }
}

async function saveDownload(runtime, download) {
  const path = await download.path()
  if (typeof path !== 'string') throw new Error('browser download did not produce a local file')
  const metadata = lstatSync(path)
  if (!metadata.isFile() || metadata.size < 1 || metadata.size > MAX_DOWNLOAD_BYTES) {
    throw new Error(`browser download must be a regular file of at most ${MAX_DOWNLOAD_BYTES} bytes`)
  }
  const content = readFileSync(path)
  const digest = sha256(content)
  const id = randomUUID()
  const root = downloadRoot(runtime)
  const object = join(root, 'objects', digest)
  const existing = lstatSafe(object)
  if (existing === undefined) atomicWrite(object, content)
  else if (!existing.isFile() || existing.size !== content.byteLength || sha256(readFileSync(object)) !== digest) {
    throw new Error('browser artifact object failed integrity validation')
  }
  const filename = safeFilename(download.suggestedFilename())
  const receipt = {
    schema_version: 1,
    product: 'e-Mate',
    version: VERSION,
    id,
    sha256: digest,
    size: content.byteLength,
    filename,
    mime_type: mimeFor(filename),
  }
  atomicWrite(join(root, 'receipts', `${id}.json`), `${JSON.stringify(receipt, null, 2)}\n`)
  return {
    artifact_id: `browser_artifact:${id}`,
    filename,
    mime_type: receipt.mime_type,
    size: receipt.size,
    sha256: digest,
    download_url: `/api/e-mate/browser.download?id=${encodeURIComponent(id)}`,
  }
}

function lstatSafe(path) {
  try {
    return lstatSync(path)
  } catch {
    return undefined
  }
}

function registerDownload(ctx, runtime) {
  ctx.effect(() => ctx.webServer.register({
    kind: 'route',
    path: '/api/e-mate/browser.download',
    handler(req, res) {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { Allow: 'GET, HEAD' })
        res.end()
        return
      }
      const id = new URL(req.url, 'http://127.0.0.1').searchParams.get('id')
      if (id === null || !/^[0-9a-f-]{36}$/u.test(id)) {
        res.writeHead(400)
        res.end('invalid browser artifact id')
        return
      }
      try {
        const receipt = JSON.parse(readFileSync(join(downloadRoot(runtime), 'receipts', `${id}.json`), 'utf8'))
        const artifactId = `browser_artifact:${receipt.id}`
        if (!isRecord(receipt)
          || DOWNLOAD_ID.exec(artifactId) === null
          || receipt.id !== id
          || receipt.product !== 'e-Mate'
          || receipt.version !== VERSION
          || !SHA256.test(receipt.sha256)
          || !Number.isSafeInteger(receipt.size)
          || receipt.size < 1
          || receipt.size > MAX_DOWNLOAD_BYTES
          || typeof receipt.filename !== 'string'
          || typeof receipt.mime_type !== 'string') {
          throw new Error('invalid browser artifact receipt')
        }
        const content = readFileSync(join(downloadRoot(runtime), 'objects', receipt.sha256))
        if (content.byteLength !== receipt.size || sha256(content) !== receipt.sha256) {
          throw new Error('browser artifact checksum mismatch')
        }
        const encoded = encodeURIComponent(receipt.filename)
        res.writeHead(200, {
          'Content-Type': receipt.mime_type,
          'Content-Length': String(content.byteLength),
          'Content-Disposition': `attachment; filename="e-Mate-download"; filename*=UTF-8''${encoded}`,
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
        })
        res.end(req.method === 'HEAD' ? undefined : content)
      } catch {
        res.writeHead(404)
        res.end('browser artifact unavailable')
      }
    },
  }), 'emate.browser: verified download route')
}

function toolContent(value) {
  const summary = [
    `Browser ${value.action}`,
    value.title === '' ? undefined : `Title: ${value.title}`,
    `URL: ${value.url}`,
    value.text,
    value.download === undefined ? undefined : `Downloaded ${value.download.filename} (${String(value.download.size)} bytes, SHA-256 ${value.download.sha256})\n${value.download.download_url}`,
  ].filter(Boolean).join('\n')
  const blocks = [{ type: 'text', text: summary }]
  if (value.screenshot !== undefined) blocks.push({ type: 'image', attachment: value.screenshot })
  return blocks
}

class BrowserController {
  constructor(ctx, runtime, chromium) {
    this.ctx = ctx
    this.runtime = runtime
    this.chromium = chromium
    this.sessions = new Map()
    this.launching = new Map()
  }

  async launch(sessionId, signal) {
    const key = sessionKey(sessionId)
    const profile = join(this.runtime.dshHome, 'e-mate', 'browser', 'sessions', key)
    mkdirSync(profile, { recursive: true, mode: 0o700 })
    const handle = this.ctx.subprocess.spawn({
      argv: [
        this.runtime.executable,
        '--headless=new',
        '--remote-debugging-address=127.0.0.1',
        '--remote-debugging-port=0',
        `--user-data-dir=${profile}`,
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-background-networking',
        '--disable-component-update',
        '--disable-default-apps',
        '--disable-sync',
        '--metrics-recording-only',
        'about:blank',
      ],
      cwd: this.runtime.root,
      stdio: {
        stdin: 'ignore',
        stdout: { maxBytes: 64 * 1024 },
        stderr: { maxBytes: 64 * 1024 },
      },
      graceMs: 3_000,
      env: browserEnvironment(),
    })
    try {
      const endpoint = await waitForDevTools(handle, signal)
      const browser = await this.chromium.connectOverCDP(endpoint, { timeout: 10_000 })
      const context = browser.contexts()[0]
      if (context === undefined) throw new Error('Chromium CDP did not expose its persistent context')
      context.setDefaultTimeout(15_000)
      context.setDefaultNavigationTimeout(30_000)
      await context.route('**/*', async route => {
        const url = route.request().url()
        if (/^(?:about|blob|data):/u.test(url)) {
          await route.continue()
          return
        }
        try {
          await assertSafeBrowserUrl(url)
          await route.continue()
        } catch {
          await route.abort('blockedbyclient')
        }
      })
      const session = { id: sessionId, key, handle, browser, context, dead: false, queue: Promise.resolve() }
      this.sessions.set(sessionId, session)
      void handle.done.then(() => {
        session.dead = true
        if (this.sessions.get(sessionId) === session) this.sessions.delete(sessionId)
      })
      browser.on('disconnected', () => {
        session.dead = true
        if (this.sessions.get(sessionId) === session) this.sessions.delete(sessionId)
      })
      return session
    } catch (error) {
      handle.terminate()
      await handle.waitForExit(AbortSignal.timeout(5_000)).catch(() => false)
      throw error
    }
  }

  async get(sessionId, signal) {
    const existing = this.sessions.get(sessionId)
    if (existing !== undefined && !existing.dead) return existing
    let launch = this.launching.get(sessionId)
    if (launch === undefined) {
      launch = this.launch(sessionId, signal).finally(() => { this.launching.delete(sessionId) })
      this.launching.set(sessionId, launch)
    }
    return launch
  }

  page(session) {
    const pages = session.context.pages().filter(page => !page.isClosed())
    const page = pages.at(-1)
    if (page === undefined) throw new Error('Chromium has no active page')
    return page
  }

  async close(sessionId) {
    const session = this.sessions.get(sessionId)
    if (session === undefined) return
    this.sessions.delete(sessionId)
    session.dead = true
    await Promise.race([
      session.browser.close().catch(() => {}),
      delay(2_000).catch(() => {}),
    ])
    session.handle.terminate()
    await session.handle.waitForExit(AbortSignal.timeout(5_000)).catch(() => false)
  }

  async dispose() {
    await Promise.all([...this.sessions.keys()].map(id => this.close(id)))
  }

  async action(args, exec) {
    const id = sessionIdFrom(exec)
    const session = await this.get(id, exec.signal)
    const run = async () => {
      exec.signal?.throwIfAborted()
      const closeOnAbort = () => { void this.close(id) }
      exec.signal?.addEventListener('abort', closeOnAbort, { once: true })
      try {
        let page = this.page(session)
        const timeout = safeTimeout(args.timeout)
        let text
        let screenshot
        let download
        if (args.action === 'navigate') {
          if (typeof args.url !== 'string') throw new Error('navigate requires url')
          await page.goto(await assertSafeBrowserUrl(args.url), { waitUntil: 'domcontentloaded', timeout })
          text = (await snapshotPage(page)).text
        } else if (args.action === 'snapshot') {
          text = (await snapshotPage(page)).text
        } else if (args.action === 'click') {
          await actionTarget(page, args).click({ timeout })
          await page.waitForTimeout(100)
        } else if (args.action === 'fill') {
          if (typeof args.text !== 'string') throw new Error('fill requires text')
          const target = actionTarget(page, args)
          const [type, autocomplete] = await Promise.all([
            target.getAttribute('type'),
            target.getAttribute('autocomplete'),
          ])
          if (type?.toLowerCase() === 'password' || /(?:current|new)-password/iu.test(autocomplete ?? '')) {
            throw new Error('browser Computer Use does not accept passwords; the user must enter credentials directly')
          }
          await target.fill(args.text, { timeout })
        } else if (args.action === 'select') {
          if (typeof args.value !== 'string') throw new Error('select requires value')
          await actionTarget(page, args).selectOption(args.value, { timeout })
        } else if (args.action === 'scroll') {
          const direction = args.direction ?? 'down'
          const distance = 700
          const [x, y] = direction === 'up' ? [0, -distance]
            : direction === 'left' ? [-distance, 0]
              : direction === 'right' ? [distance, 0]
                : direction === 'down' ? [0, distance]
                  : (() => { throw new Error('scroll direction must be up, down, left, or right') })()
          await page.mouse.wheel(x, y)
        } else if (args.action === 'screenshot') {
          const data = await page.screenshot({ type: 'png', fullPage: args.full_page === true, timeout })
          screenshot = await this.ctx.attachments.saveImage({ data, mediaType: 'image/png', name: 'e-Mate-browser.png' })
        } else if (args.action === 'wait') {
          if (args.selector !== undefined) await page.locator(safeSelector(args.selector)).waitFor({ state: 'visible', timeout })
          else await page.waitForTimeout(Math.min(timeout, 10_000))
        } else if (args.action === 'back') {
          await page.goBack({ waitUntil: 'domcontentloaded', timeout })
        } else if (args.action === 'forward') {
          await page.goForward({ waitUntil: 'domcontentloaded', timeout })
        } else if (args.action === 'get_text') {
          text = (args.selector === undefined ? await page.locator('body').innerText({ timeout }) : await page.locator(safeSelector(args.selector)).innerText({ timeout })).slice(0, MAX_SNAPSHOT_CHARS)
        } else if (args.action === 'press') {
          if (typeof args.key !== 'string' || args.key.length < 1 || args.key.length > 80) throw new Error('press requires a valid key')
          if (args.ref !== undefined || args.selector !== undefined) await actionTarget(page, args).press(args.key, { timeout })
          else await page.keyboard.press(args.key)
        } else if (args.action === 'download') {
          const [downloaded] = await Promise.all([
            page.waitForEvent('download', { timeout }),
            actionTarget(page, args).click({ timeout }),
          ])
          download = await saveDownload(this.runtime, downloaded)
        } else {
          throw new Error(`unsupported browser action ${String(args.action)}`)
        }
        page = this.page(session)
        return {
          action: args.action,
          url: page.url(),
          title: await page.title(),
          ...(text === undefined ? {} : { text }),
          ...(screenshot === undefined ? {} : { screenshot }),
          ...(download === undefined ? {} : { download }),
        }
      } finally {
        exec.signal?.removeEventListener('abort', closeOnAbort)
      }
    }
    const pending = session.queue.then(run, run)
    session.queue = pending.then(() => undefined, () => undefined)
    return pending
  }

  async selfTest(signal) {
    const id = '__e-mate-browser-self-test__'
    try {
      const session = await this.get(id, signal)
      const page = this.page(session)
      return { ready: page.url() === 'about:blank', browser_version: this.runtime.browserVersion }
    } finally {
      await this.close(id)
    }
  }
}

function registerCapability(ctx, controller, error) {
  const capabilities = ctx.get('emateCapabilities')
  if (capabilities === undefined) return
  ctx.effect(() => capabilities.register({
    id: 'browser',
    title: '浏览器',
    summary: '使用内置 Chromium 完成真实网页浏览、交互、截图和下载。',
    icon_key: 'browser',
    order: 40,
    actions: controller === undefined ? [] : [{ id: 'self-test', label: '运行自检', kind: 'secondary' }],
    async status() {
      return controller === undefined
        ? { state: 'blocked', detail: error?.slice(0, 240) ?? '浏览器运行包不可用。', action_ids: [] }
        : { state: 'ready', detail: `Chromium ${controller.runtime.browserVersion}`, action_ids: ['self-test'] }
    },
    async invoke(action, _data, signal) {
      if (action !== 'self-test' || controller === undefined) throw new Error('browser capability action is unavailable')
      return controller.selfTest(signal)
    },
  }), 'emate.browser: capability metadata')
}

function registerTool(ctx, controller, defineTool) {
  ctx.tools.register(defineTool({
    name: 'e_mate_browser',
    description: 'Control the packaged Chromium browser through real e-Mate Tool events. Navigate, inspect a bounded snapshot, click/fill/select by snapshot ref or CSS selector, scroll, capture a durable screenshot, wait, move through history, read text, press a key, or save a verified download. Use snapshot after navigation and before ref-based actions. CAPTCHA, MFA, payments, destructive confirmations, and account authorization require the user.',
    parameters: {
      action: {
        type: 'string', required: true,
        enum: ['navigate', 'snapshot', 'click', 'fill', 'select', 'scroll', 'screenshot', 'wait', 'back', 'forward', 'get_text', 'press', 'download'],
      },
      url: { type: 'string', description: 'HTTP(S) URL for navigate.' },
      ref: { type: 'number', description: 'Element ref from the latest snapshot.' },
      selector: { type: 'string', description: 'CSS selector when a snapshot ref is unavailable.' },
      text: { type: 'string', description: 'Text for fill.' },
      value: { type: 'string', description: 'Option value for select.' },
      key: { type: 'string', description: 'Keyboard key for press.' },
      direction: { type: 'string', enum: ['up', 'down', 'left', 'right'], description: 'Scroll direction.' },
      full_page: { type: 'boolean', description: 'Capture the complete page for screenshot.' },
      timeout: { type: 'number', description: 'Action timeout from 100 to 60000 milliseconds.' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          action: { type: 'string', required: true },
          url: { type: 'string', required: true },
          title: { type: 'string', required: true },
          text: { type: 'string' },
          screenshot: {
            type: 'object', additionalProperties: false,
            properties: {
              attachmentId: { type: 'string', required: true },
              mediaType: { type: 'string', required: true },
              bytes: { type: 'integer', required: true },
              width: { type: 'integer', required: true },
              height: { type: 'integer', required: true },
              name: { type: 'string' },
            },
          },
          download: {
            type: 'object', additionalProperties: false,
            properties: {
              artifact_id: { type: 'string', required: true },
              filename: { type: 'string', required: true },
              mime_type: { type: 'string', required: true },
              size: { type: 'integer', required: true },
              sha256: { type: 'string', required: true },
              download_url: { type: 'string', required: true },
            },
          },
        },
      },
      render: (_args, value) => toolContent(value),
    },
    isConcurrencySafe: () => false,
    timeoutMs: 65_000,
    execute: (args, exec) => controller.action(args, exec),
    presentCall: args => ({ card: 'generic', title: `Browser: ${args.action}`, kind: args.action === 'snapshot' || args.action === 'get_text' ? 'read' : 'execute', rawInput: args.url ?? args.selector ?? args.ref }),
  }))
}

export async function apply(ctx, config = {}) {
  let runtime
  let chromium
  let error
  try {
    runtime = loadBrowserBinding(config.bindingPath)
    chromium = (await loadTargetPlaywright(config.bindingPath)).chromium
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught)
  }
  if (runtime === undefined || chromium === undefined) {
    registerCapability(ctx, undefined, error)
    return
  }
  const controller = new BrowserController(ctx, runtime, chromium)
  registerCapability(ctx, controller)
  registerDownload(ctx, runtime)
  const { defineTool } = await loadTargetTools(config.bindingPath)
  registerTool(ctx, controller, defineTool)
  ctx.effect(() => async () => controller.dispose(), 'emate.browser: managed Chromium lifecycle')
}
