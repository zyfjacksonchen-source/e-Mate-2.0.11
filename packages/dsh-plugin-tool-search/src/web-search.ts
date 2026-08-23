import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { HarnessError } from '@deepseek-ai/dsh-llm'

export const name = 'emate-web-search-gpt'
export const inject = ['web']
export const GPT_RESPONSES_PROVIDER_ID = 'gpt-responses'
export const DEFAULT_CREDENTIAL_REF = 'E_MATE_SEARCH_KEY_DEEPSEEK'
export const DEFAULT_BASE_URL = 'http://43.135.183.53:8080/v1'
export const DEFAULT_MODEL = 'gpt-5.6-luna'
export const DEFAULT_MAX_OUTPUT_TOKENS = 4096

interface WebSearchRequest {
  readonly query: string
  readonly maxResults?: number
}

interface WebSearchSource {
  readonly url: string
  readonly title?: string
}

interface WebSearchResult {
  readonly content?: string
  readonly sources: readonly WebSearchSource[]
  readonly truncated: boolean
}

interface WebSearchProvider {
  readonly id: string
  available(): boolean
  search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult>
}

interface WebRuntime {
  registerSearchProvider(provider: WebSearchProvider): () => void
}

interface CredentialRuntime {
  resolve(ref: ReturnType<typeof credentialRef>): Promise<{ value: string } | undefined>
}

export interface Config {
  apiKeyEnv?: string
  baseURL?: string
  model?: string
  allowInsecureHttp?: boolean
  maxOutputTokens?: number
}


type ResolvedConfig = Required<Config>
type JsonRecord = Record<string, unknown>

export class GptResponsesSearchError extends HarnessError {}

function record(value: unknown): JsonRecord | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as JsonRecord
    : undefined
}

function endpointFrom(config: ResolvedConfig): string {
  let url: URL
  try {
    url = new URL(config.baseURL)
  } catch (error: unknown) {
    throw new Error('GPT search base URL is invalid', { cause: error })
  }
  if (
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && config.allowInsecureHttp))
    || url.username !== ''
    || url.password !== ''
    || url.search !== ''
    || url.hash !== ''
  ) {
    throw new Error('GPT search base URL violates the transport boundary')
  }
  const path = url.pathname.replace(/\/+$/u, '')
  return `${url.origin}${path}/responses`
}

function sourceFrom(annotation: JsonRecord): WebSearchSource | undefined {
  if (annotation.type !== 'url_citation' || typeof annotation.url !== 'string') return
  let url: URL
  try {
    url = new URL(annotation.url)
  } catch {
    return
  }
  if (
    (url.protocol !== 'https:' && url.protocol !== 'http:')
    || url.username !== ''
    || url.password !== ''
  ) return
  const title = typeof annotation.title === 'string' && annotation.title.trim() !== ''
    ? annotation.title.trim()
    : undefined
  return { url: url.toString(), ...(title === undefined ? {} : { title }) }
}

export function mapResponsesPayload(payload: unknown): WebSearchResult {
  const root = record(payload)
  if (root === undefined || !Array.isArray(root.output)) {
    throw new GptResponsesSearchError('GPT search returned an invalid Responses payload', 'WEB_PROVIDER_ERROR')
  }
  let searched = false
  const text: string[] = []
  const sources = new Map<string, WebSearchSource>()
  for (const rawItem of root.output) {
    const item = record(rawItem)
    if (item === undefined) continue
    if (item.type === 'web_search_call') searched = true
    if (item.type !== 'message' || !Array.isArray(item.content)) continue
    for (const rawContent of item.content) {
      const content = record(rawContent)
      if (content === undefined || content.type !== 'output_text') continue
      if (typeof content.text === 'string' && content.text.trim() !== '') text.push(content.text.trim())
      if (!Array.isArray(content.annotations)) continue
      for (const rawAnnotation of content.annotations) {
        const annotation = record(rawAnnotation)
        const source = annotation === undefined ? undefined : sourceFrom(annotation)
        if (source !== undefined && !sources.has(source.url)) sources.set(source.url, source)
      }
    }
  }
  if (!searched || sources.size === 0) {
    throw new GptResponsesSearchError('GPT Responses did not return a cited web search result', 'WEB_PROVIDER_ERROR')
  }
  const content = text.join('\n\n')
  return {
    ...(content === '' ? {} : { content }),
    sources: [...sources.values()],
    truncated: false,
  }
}

function aborted(signal?: AbortSignal, cause?: unknown): GptResponsesSearchError {
  return new GptResponsesSearchError('GPT search aborted', 'WEB_ABORTED', {
    cause: signal?.aborted === true ? signal.reason : cause,
  })
}

function isAbortError(error: unknown): boolean {
  return record(error)?.name === 'AbortError'
}

class GptResponsesSearchProvider implements WebSearchProvider {
  readonly id = GPT_RESPONSES_PROVIDER_ID

  constructor(
    private readonly ctx: Context,
    private readonly config: ResolvedConfig,
    private readonly endpoint: string,
  ) {}

  available(): boolean {
    return this.config.model.length > 0 && Number.isInteger(this.config.maxOutputTokens)
  }

  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    if (signal?.aborted === true) throw aborted(signal)
    const credentials = this.ctx.get('credentials') as CredentialRuntime | undefined
    if (credentials === undefined) {
      throw new GptResponsesSearchError('Managed GPT search credentials are unavailable', 'WEB_PROVIDER_CREDENTIAL_MISSING')
    }
    let apiKey: string | undefined
    try {
      apiKey = (await credentials.resolve(credentialRef(this.config.apiKeyEnv)))?.value
    } catch (error: unknown) {
      if (signal?.aborted === true || isAbortError(error)) throw aborted(signal, error)
      throw new GptResponsesSearchError('Managed GPT search credential resolution failed', 'WEB_PROVIDER_ERROR', { cause: error })
    }
    if (typeof apiKey !== 'string' || apiKey.length < 20 || /\s/u.test(apiKey)) {
      throw new GptResponsesSearchError(
        `Managed GPT search has no usable credential for "${this.config.apiKeyEnv}"`,
        'WEB_PROVIDER_CREDENTIAL_MISSING',
      )
    }
    if (signal?.aborted === true) throw aborted(signal)
    let response: Response
    try {
      response = await fetch(this.endpoint, {
        method: 'POST',
        redirect: 'error',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
          accept: 'application/json',
          'user-agent': 'e-mate/2.0.12',
        },
        body: JSON.stringify({
          model: this.config.model,
          input: request.query,
          tools: [{ type: 'web_search' }],
          max_output_tokens: this.config.maxOutputTokens,
        }),
        ...(signal === undefined ? {} : { signal }),
      })
    } catch (error: unknown) {
      if (signal?.aborted === true || isAbortError(error)) throw aborted(signal, error)
      throw new GptResponsesSearchError('GPT search request failed', 'WEB_PROVIDER_ERROR', { cause: error })
    }
    if (!response.ok) {
      throw new GptResponsesSearchError(`GPT search upstream rejected the request (HTTP ${response.status})`, 'WEB_PROVIDER_ERROR')
    }
    try {
      return mapResponsesPayload(await response.json())
    } catch (error: unknown) {
      if (signal?.aborted === true || isAbortError(error)) throw aborted(signal, error)
      if (error instanceof GptResponsesSearchError) throw error
      throw new GptResponsesSearchError('GPT search returned an unreadable response', 'WEB_PROVIDER_ERROR', { cause: error })
    }
  }
}

export function apply(ctx: Context, config: Config = {}): void {
  const resolved: ResolvedConfig = {
    apiKeyEnv: config.apiKeyEnv ?? DEFAULT_CREDENTIAL_REF,
    baseURL: config.baseURL ?? DEFAULT_BASE_URL,
    model: config.model ?? DEFAULT_MODEL,
    allowInsecureHttp: config.allowInsecureHttp ?? false,
    maxOutputTokens: config.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
  }
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(resolved.apiKeyEnv)
    || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(resolved.model)
    || !Number.isInteger(resolved.maxOutputTokens)
    || resolved.maxOutputTokens < 1) {
    throw new Error('GPT search configuration is invalid')
  }
  const web = ctx.get('web') as WebRuntime | undefined
  if (web === undefined) throw new Error('DSH web runtime is unavailable')
  web.registerSearchProvider(new GptResponsesSearchProvider(ctx, resolved, endpointFrom(resolved)))
}
