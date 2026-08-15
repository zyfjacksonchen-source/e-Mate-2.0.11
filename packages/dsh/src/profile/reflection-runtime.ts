import { createHash } from 'node:crypto'

const MAX_MODEL_OUTPUT_CHARS = 64_000

export function reflectionDigest(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function messageText(message) {
  return message.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('\n')
    .trim()
}

export function conversationTranscript(agent, maximumCharacters = 24_000) {
  if (!Number.isSafeInteger(maximumCharacters) || maximumCharacters < 1) throw new Error('transcript limit is invalid')
  const messages = agent.session?.deriveMessages?.()
  if (!Array.isArray(messages)) throw new Error('e-Mate session message projection is unavailable')
  const candidates = messages
    .filter(message => message?.source?.kind === 'user' || message?.source?.kind === 'model')
    .map(message => ({
      id: String(message.id),
      role: message.source.kind === 'user' ? 'User' : 'Assistant',
      text: messageText(message),
    }))
    .filter(message => message.id.length > 0 && message.text.length > 0)
  const selected = []
  let remaining = maximumCharacters
  for (let index = candidates.length - 1; index >= 0 && remaining > 0; index -= 1) {
    const candidate = candidates[index]
    const prefix = `[message:${candidate.id}] ${candidate.role}: `
    const available = remaining - prefix.length - 1
    if (available < 1) break
    const text = candidate.text.length <= available
      ? candidate.text
      : available === 1 ? '…' : `…${candidate.text.slice(-(available - 1))}`
    selected.push({ ...candidate, text })
    remaining -= prefix.length + text.length + 1
  }
  selected.reverse()
  if (selected.length === 0) throw new Error('the e-Mate session has no user/assistant text to review')
  return {
    text: selected.map(message => `[message:${message.id}] ${message.role}: ${message.text}`).join('\n'),
    messageIds: selected.map(message => message.id),
    userMessages: selected.filter(message => message.role === 'User').length,
  }
}

function modelRoute(agent) {
  const routed = agent.session?.requestHeader?.()?.config
  if (typeof routed?.provider === 'string' && routed.provider.length > 0
    && typeof routed?.model === 'string' && routed.model.length > 0) {
    return { provider: routed.provider, model: routed.model }
  }
  if (typeof agent.options?.provider === 'string' && agent.options.provider.length > 0
    && typeof agent.options?.model === 'string' && agent.options.model.length > 0) {
    return { provider: agent.options.provider, model: agent.options.model }
  }
  throw new Error('no e-Mate model route is available for local reflection')
}

function finishError(finish) {
  if (finish.kind === 'error' || finish.kind === 'aborted') {
    const error = new Error(finish.failure.message)
    error.code = finish.failure.code
    return error
  }
  if (finish.kind === 'max-tokens') return new Error('reflection model output was truncated at the token cap')
  return undefined
}

export async function runJsonReflection(ctx, llmModule, agent, { system, prompt, maxTokens = 2_000 }, signal) {
  signal?.throwIfAborted()
  const route = modelRoute(agent)
  const assembler = new llmModule.BlockAssembler()
  const message = llmModule.createUserMessage({
    content: [{ type: 'text', text: prompt }],
    source: { kind: 'plugin', plugin: 'e-mate-reflection' },
  })
  for await (const chunk of ctx.llm.stream({
    ...route,
    messages: [message],
    system,
    maxTokens,
    sessionId: agent.id,
    ...(signal === undefined ? {} : { signal }),
  })) assembler.push(chunk)
  const failed = finishError(assembler.finish)
  if (failed !== undefined) throw failed
  const blocks = assembler.blocks()
  if (blocks.some(block => block.type !== 'text' && block.type !== 'reasoning')) {
    throw new Error('reflection model returned unsupported non-text content')
  }
  const text = blocks.filter(block => block.type === 'text').map(block => block.text).join('').trim()
  if (text.length === 0 || text.length > MAX_MODEL_OUTPUT_CHARS) throw new Error('reflection model returned invalid text length')
  let value
  try {
    value = JSON.parse(text)
  } catch (error) {
    throw new Error('reflection model did not return strict JSON', { cause: error })
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('reflection model JSON must be an object')
  }
  return { value, ...route }
}

export function startReflectionJob(ctx, owner, kind, label, operation) {
  if (owner === undefined) throw new Error('reflection requires an owning e-Mate Agent')
  const controller = new AbortController()
  return ctx.jobs.start({
    kind,
    label,
    owner,
    outputLimitBytes: 32 * 1024,
    run: () => ({
      cancel: reason => controller.abort(reason),
      done: Promise.resolve().then(() => operation(controller.signal)).then(
        value => ({ status: 'completed', detail: label, output: JSON.stringify(value) }),
        error => ({
          status: controller.signal.aborted ? 'killed' : 'failed',
          detail: error instanceof Error ? error.message : String(error),
        }),
      ),
    }),
  })
}
