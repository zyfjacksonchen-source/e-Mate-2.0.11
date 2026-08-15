import { join } from 'node:path'
import { loadTargetLlm, loadTargetTools } from './target-runtime.js'
import {
  conversationTranscript,
  reflectionDigest,
  runJsonReflection,
  startReflectionJob,
} from './reflection-runtime.js'

export const name = 'emate-learning'
export const inject = ['tools', 'jobs', 'llm', 'emateMemory']

const MIN_USER_MESSAGES = 6
const SYSTEM = `You are e-Mate's conservative autonomous-learning reviewer. Learn only durable lessons explicitly supported by the supplied e-Mate conversation. Do not infer private identity, credentials, personality, intent, or unstated facts. Do not edit files or Skills and do not issue tools. Return strict JSON only with exactly this shape: {"decision":"silent","items":[]} or {"decision":"learn","items":[{"content":"durable explicit lesson","evidence_message_ids":["message id"]}]}. Return silent unless the lesson will materially improve future work in this same project. At most 8 items, each at most 500 characters, and every item must cite one or more supplied message IDs.`

function validateLearning(value, allowedIds) {
  if (Object.keys(value).sort().join(',') !== 'decision,items'
    || (value.decision !== 'silent' && value.decision !== 'learn')
    || !Array.isArray(value.items)
    || value.items.length > 8
    || (value.decision === 'silent' && value.items.length !== 0)
    || (value.decision === 'learn' && value.items.length === 0)) {
    throw new Error('autonomous learning JSON is invalid')
  }
  const items = value.items.map((item) => {
    if (item === null || typeof item !== 'object' || Array.isArray(item)
      || Object.keys(item).sort().join(',') !== 'content,evidence_message_ids'
      || typeof item.content !== 'string'
      || item.content.trim().length === 0
      || item.content.trim().length > 500
      || !Array.isArray(item.evidence_message_ids)
      || item.evidence_message_ids.length === 0
      || item.evidence_message_ids.length > 12
      || item.evidence_message_ids.some(id => typeof id !== 'string' || !allowedIds.has(id))) {
      throw new Error('autonomous learning item lacks valid transcript evidence')
    }
    return {
      content: item.content.trim(),
      evidence: [...new Set(item.evidence_message_ids)],
    }
  })
  return { decision: value.decision, items }
}

function countUserMessages(agent) {
  const messages = agent.session?.deriveMessages?.()
  return Array.isArray(messages) ? messages.filter(message => message?.source?.kind === 'user').length : 0
}

async function review(ctx, llmModule, memory, agent, signal) {
  const exec = { agent, signal }
  const transcript = conversationTranscript(agent)
  const digest = reflectionDigest({ transcript: transcript.text })
  const existing = await memory.find({ kinds: ['learning'], sourceDigest: digest, limit: 1 }, exec)
  if (existing.length > 0) return { record_id: existing[0].id, decision: 'learn', deduplicated: true }
  const reflected = await runJsonReflection(ctx, llmModule, agent, {
    system: SYSTEM,
    prompt: `Review this bounded e-Mate conversation. Every allowed evidence ID is embedded in the transcript.\n\n${transcript.text}`,
  }, signal)
  const learned = validateLearning(reflected.value, new Set(transcript.messageIds))
  if (learned.decision === 'silent') {
    return { decision: 'silent', deduplicated: false, provider: reflected.provider, model: reflected.model }
  }
  const content = learned.items.map(item => `- ${item.content}`).join('\n')
  if (content.length > 8_000) throw new Error('autonomous learning exceeds the local memory boundary')
  const stored = await memory.store({
    kind: 'learning',
    content,
    tags: ['autonomous-learning'],
    sourceEventIds: learned.items.flatMap(item => item.evidence),
    sourceDigest: digest,
  }, exec)
  return {
    record_id: stored.id,
    decision: 'learn',
    deduplicated: false,
    provider: reflected.provider,
    model: reflected.model,
  }
}

const searchOutput = {
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: { items: { type: 'array', required: true, items: { type: 'json' } } },
  },
  render: (_args, value) => [{
    type: 'text',
    text: value.items.length === 0 ? 'No autonomous learning exists in this project.' : value.items.map(item => item.content).join('\n\n'),
  }],
}

export async function apply(ctx, config = {}) {
  const bindingPath = config.bindingPath ?? join(import.meta.dirname, 'runtime-binding.json')
  const [{ defineTool }, llmModule] = await Promise.all([
    loadTargetTools(bindingPath),
    loadTargetLlm(bindingPath),
  ])
  ctx.effect(() => ctx.jobs.attachController('emate-learning'), 'emate.learning: target Job controller')
  const baselines = new Map()
  const running = new Set()

  ctx.on('agent/status', ({ agent, status }) => {
    if (status !== 'idle' || agent.session?.header?.origin === 'subagent' || running.has(String(agent.id))) return
    const count = countUserMessages(agent)
    const baseline = baselines.get(String(agent.id)) ?? 0
    if (count - baseline < MIN_USER_MESSAGES) return
    try {
      running.add(String(agent.id))
      startReflectionJob(ctx, agent, 'emate-learning', 'Review e-Mate project learning', async (signal) => {
        try {
          return await review(ctx, llmModule, ctx.emateMemory, agent, signal)
        } finally {
          running.delete(String(agent.id))
        }
      })
      baselines.set(String(agent.id), count)
    } catch (error) {
      running.delete(String(agent.id))
      ctx.logger.warn(`e-Mate autonomous learning Job did not start: ${String(error)}`)
    }
  })

  ctx.tools.register(defineTool({
    name: 'e_mate_learning_search',
    description: 'Read evidence-backed autonomous learning records from only the current e-Mate project or ungrouped session.',
    parameters: {
      query: { type: 'string', description: 'Optional text query.' },
      limit: { type: 'integer', description: 'Optional result count from 1 to 10.' },
    },
    output: searchOutput,
    async execute(args, exec) {
      const records = await ctx.emateMemory.find({ ...args, kinds: ['learning'] }, exec)
      return { items: records.map(record => ({
        record_id: record.id,
        content: record.content,
        created_at: record.created_at,
        scope: record.scope_type,
        evidence_message_ids: record.source_event_ids,
      })) }
    },
    presentCall: args => ({ card: 'generic', title: 'Search project learning', kind: 'read', rawInput: args.query }),
  }))
}
