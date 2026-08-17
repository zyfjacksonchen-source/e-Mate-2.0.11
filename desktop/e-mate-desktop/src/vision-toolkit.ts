import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import { apply as applyVisionToolkit } from '@anionex/dsh-vision-toolkit'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const name = 'e-mate-desktop-vision-toolkit'
export const inject = [
  'tools',
  'credentials',
  'skills',
  'subprocess',
  'settings',
  'agents',
  'sessions',
  'webServer',
  'emateCapabilities',
]

const SETTINGS_NAMESPACE = settingsNamespace('vision-toolkit')
const MODEL_SETTINGS_NAMESPACE = settingsNamespace('llm-pi-ai')
const MODEL_ID = 'gpt-5.6-luna'
const CREDENTIAL_REF = 'E_MATE_MODEL_KEY_GPT'
const UNCONFIGURED_BASE_URL = 'https://127.0.0.1.invalid/v1'

type CapabilityRegistry = {
  register(definition: unknown): () => void
}

type DesktopVisionContext = Context & {
  emateCapabilities: CapabilityRegistry
}

type VisionConfig = {
  provider: {
    baseUrl: string
    credential: string
    model: string
    protocol: 'openai'
  }
  language: 'zh'
  timeoutMs: number
  maxImageBytes: number
  maxImagePixels: number
  concurrency: number
  runtime: { mode: 'managed'; python: string }
  allowedDirs: string[]
}

const UNCONFIGURED: VisionConfig = {
  provider: {
    baseUrl: UNCONFIGURED_BASE_URL,
    credential: CREDENTIAL_REF,
    model: MODEL_ID,
    protocol: 'openai',
  },
  language: 'zh',
  timeoutMs: 120_000,
  maxImageBytes: 16 * 1024 * 1024,
  maxImagePixels: 40_000_000,
  concurrency: 4,
  runtime: { mode: 'managed', python: bundledPythonPath() },
  allowedDirs: [],
}

/** Resolve the architecture-matched Python shipped beside app.asar. */
export function bundledPythonPath(): string {
  const target = `${process.platform}-${process.arch}`
  const relative = process.platform === 'win32'
    ? join('python-runtime', target, 'python', 'python.exe')
    : join('python-runtime', target, 'python', 'bin', 'python3')
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
  const packaged = resourcesPath === undefined ? undefined : join(resourcesPath, relative)
  if (packaged !== undefined && existsSync(packaged)) return packaged
  return join(dirname(dirname(fileURLToPath(import.meta.url))), 'build', relative)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Derive the vision route only from the enterprise-projected native catalog. */
export function visionConfigFromModelSettings(value: unknown): VisionConfig | undefined {
  if (!isRecord(value) || !isRecord(value.providers)) return undefined
  const provider = value.providers['e-mate-enterprise']
  if (!isRecord(provider)
    || provider.apiKeyEnv !== CREDENTIAL_REF
    || typeof provider.baseURL !== 'string'
    || !Array.isArray(provider.models)) return undefined
  const model = provider.models.find(candidate => isRecord(candidate)
    && candidate.id === MODEL_ID
    && Array.isArray(candidate.input)
    && candidate.input.includes('image'))
  if (model === undefined) return undefined
  let baseUrl: URL
  try {
    baseUrl = new URL(provider.baseURL)
  } catch {
    return undefined
  }
  if ((baseUrl.protocol !== 'https:' && baseUrl.protocol !== 'http:')
    || baseUrl.username || baseUrl.password || baseUrl.search || baseUrl.hash) return undefined
  return {
    ...UNCONFIGURED,
    provider: {
      ...UNCONFIGURED.provider,
      baseUrl: baseUrl.toString().replace(/\/+$/u, ''),
    },
  }
}

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

async function projectEnterpriseVision(ctx: Context): Promise<void> {
  const projected = visionConfigFromModelSettings(ctx.settings.get(MODEL_SETTINGS_NAMESPACE)) ?? UNCONFIGURED
  if (!same(ctx.settings.get(SETTINGS_NAMESPACE), projected)) {
    await ctx.settings.replace(SETTINGS_NAMESPACE, projected)
  }
}

async function runtimeStatus(ctx: Context): Promise<{ state: string; detail: string; action_ids: never[] }> {
  const endpoint = `http://127.0.0.1:${String(ctx.webServer.port)}/_dsh/vision-toolkit/settings`
  try {
    const snapshotResponse = await fetch(endpoint, { headers: { accept: 'application/json' }, cache: 'no-store' })
    const snapshot = await snapshotResponse.json() as unknown
    if (!snapshotResponse.ok || !isRecord(snapshot) || snapshot.ok !== true || !isRecord(snapshot.value)
      || !isRecord(snapshot.value.runtime) || snapshot.value.runtime.ready !== true
      || !isRecord(snapshot.value.credential) || snapshot.value.credential.configured !== true
      || !isRecord(snapshot.value.settings) || !isRecord(snapshot.value.settings.value)
      || !isRecord(snapshot.value.settings.value.provider)
      || snapshot.value.settings.value.provider.baseUrl === UNCONFIGURED_BASE_URL) {
      return { state: 'setup-required', detail: 'OCR 运行时或企业视觉模型配置尚未就绪。', action_ids: [] }
    }
    const healthResponse = await fetch(endpoint, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        origin: `http://127.0.0.1:${String(ctx.webServer.port)}`,
      },
      body: JSON.stringify({ action: 'health', testConnection: true }),
    })
    const health = await healthResponse.json() as unknown
    if (!healthResponse.ok || !isRecord(health) || health.ok !== true || !isRecord(health.value)
      || health.value.healthy !== true || health.value.connectionTested !== true) {
      return { state: 'setup-required', detail: 'OCR 本地运行时已加载，但视觉模型连接检查未通过。', action_ids: [] }
    }
    return { state: 'ready', detail: 'OCR 与视觉工具已连接企业下发的 gpt-5.6-luna，并通过真实运行检查。', action_ids: [] }
  } catch {
    return { state: 'setup-required', detail: 'OCR 运行时尚未完成启动或连接检查。', action_ids: [] }
  }
}

/** Mount the rc.6 native toolkit without exposing its user-editable model Settings client. */
export async function apply(ctx: DesktopVisionContext): Promise<() => void> {
  const disposeToolkit = await applyVisionToolkit(ctx, UNCONFIGURED)
  let projection = Promise.resolve()
  const refresh = (): void => {
    projection = projection.then(() => projectEnterpriseVision(ctx))
      .catch(error => ctx.logger.warn('e-Mate Vision Toolkit projection failed: %s', error instanceof Error ? error.message : String(error)))
  }
  refresh()
  const disposeSettings = ctx.on('settings/updated', namespace => {
    if (namespace === String(MODEL_SETTINGS_NAMESPACE)) refresh()
  })
  const disposeCapability = ctx.emateCapabilities.register({
    id: 'vision-ocr',
    title: '视觉 / OCR',
    summary: '使用目标 dsh-vision-toolkit 执行 OCR、图像理解、定位、裁剪与视觉产物交付。',
    icon_key: 'ocr',
    order: 45,
    actions: [],
    status: () => runtimeStatus(ctx),
  })
  return () => {
    disposeCapability()
    disposeSettings()
    disposeToolkit()
  }
}
