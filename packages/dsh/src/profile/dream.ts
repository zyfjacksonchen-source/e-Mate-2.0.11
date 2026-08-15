import { join } from 'node:path'
import { loadTargetLlm, loadTargetTools } from './target-runtime.js'
import {
  conversationTranscript,
  reflectionDigest,
  runJsonReflection,
  startReflectionJob,
} from './reflection-runtime.js'

export const name = 'emate-dream'
export const inject = ['tools', 'jobs', 'llm', 'emateMemory']

const SYSTEM = `You are e-Mate's local dream-distillation worker. Curate only facts explicitly present in the supplied project memories and conversation. Never infer a secret, identity, preference, decision, or event that is not stated. Do not issue tools or instructions. Return strict JSON only, with exactly this shape: {"distilled_memory":["concise explicit fact"],"dream":"short account of duplicates, conflicts, and cleanup"}. Keep distilled_memory at 12 items or fewer, each at most 400 characters. Keep dream at most 2500 characters.`

function validateDream(value) {
  if (Object.keys(value).sort().join(',') !== 'distilled_memory,dream'
    || !Array.isArray(value.distilled_memory)
    || value.distilled_memory.length > 12
    || value.distilled_memory.some(item => typeof item !== 'string' || item.trim().length === 0 || item.trim().length > 400)
    || typeof value.dream !== 'string'
    || value.dream.trim().length === 0
    || value.dream.trim().length > 2_500) {
    throw new Error('dream distillation JSON is invalid')
  }
  const distilled = value.distilled_memory.map(item => item.trim())
  const dream = value.dream.trim()
  const content = [
    '[MEMORY]',
    ...(distilled.length === 0 ? ['(none)'] : distilled.map(item => `- ${item}`)),
    '',
    '[DREAM]',
    dream,
  ].join('\n')
  if (content.length > 8_000) throw new Error('dream distillation exceeds the local memory boundary')
  return content
}

function memoryExcerpt(records) {
  let remaining = 16_000
  const selected = []
  for (const record of records) {
    const line = `[memory:${record.id}] ${record.content}`
    if (line.length > remaining) break
    selected.push(line)
    remaining -= line.length + 1
  }
  return selected.length === 0 ? '(none)' : selected.join('\n')
}

async function distill(ctx, llmModule, memory, agent, signal) {
  const exec = { agent, signal }
  const memories = await memory.find({ kinds: ['memory'], limit: 10 }, exec)
  const transcript = conversationTranscript(agent)
  const digest = reflectionDigest({
    memories: memories.map(record => [record.id, record.updated_at, record.content]),
    transcript: transcript.text,
  })
  const existing = await memory.find({ kinds: ['dream'], sourceDigest: digest, limit: 1 }, exec)
  if (existing.length > 0) return { record_id: existing[0].id, deduplicated: true }
  const reflected = await runJsonReflection(ctx, llmModule, agent, {
    system: SYSTEM,
    prompt: `## Current project memories\n${memoryExcerpt(memories)}\n\n## Current e-Mate conversation\n${transcript.text}`,
  }, signal)
  const stored = await memory.store({
    kind: 'dream',
    content: validateDream(reflected.value),
    tags: ['dream-distillation'],
    sourceEventIds: transcript.messageIds,
    sourceDigest: digest,
  }, exec)
  return {
    record_id: stored.id,
    deduplicated: false,
    provider: reflected.provider,
    model: reflected.model,
  }
}

const jobOutput = {
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      job_id: { type: 'string', required: true },
      status: { type: 'string', required: true, const: 'running' },
    },
  },
  render: (_args, value) => [{ type: 'text', text: `Started project dream distillation Job ${value.job_id}.` }],
}

const searchOutput = {
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: { items: { type: 'array', required: true, items: { type: 'json' } } },
  },
  render: (_args, value) => [{
    type: 'text',
    text: value.items.length === 0 ? 'No dream distillation exists in this project.' : value.items.map(item => item.content).join('\n\n'),
  }],
}

export async function apply(ctx, config = {}) {
  const bindingPath = config.bindingPath ?? join(import.meta.dirname, 'runtime-binding.json')
  const [{ defineTool }, llmModule] = await Promise.all([
    loadTargetTools(bindingPath),
    loadTargetLlm(bindingPath),
  ])
  ctx.effect(() => ctx.jobs.attachController('emate-dream'), 'emate.dream: target Job controller')

  ctx.tools.register(defineTool({
    name: 'e_mate_dream_distill',
    description: 'Start a real local Job that uses the current session model to distill only explicit current-project memories and conversation facts. Use when the user asks e-Mate to organize, consolidate, or dream over its project memory.',
    parameters: {},
    output: jobOutput,
    execute(_args, exec) {
      exec.signal.throwIfAborted()
      const jobId = startReflectionJob(ctx, exec.agent, 'emate-dream', 'Distill e-Mate project memory', signal =>
        distill(ctx, llmModule, ctx.emateMemory, exec.agent, signal))
      return Promise.resolve({ job_id: jobId, status: 'running' })
    },
    presentCall: () => ({ card: 'generic', title: 'Distill project memory', kind: 'write' }),
  }))

  ctx.tools.register(defineTool({
    name: 'e_mate_dream_search',
    description: 'Read dream distillations from only the current e-Mate project or ungrouped session.',
    parameters: {
      query: { type: 'string', description: 'Optional text query.' },
      limit: { type: 'integer', description: 'Optional result count from 1 to 10.' },
    },
    output: searchOutput,
    async execute(args, exec) {
      const records = await ctx.emateMemory.find({ ...args, kinds: ['dream'] }, exec)
      return { items: records.map(record => ({
        record_id: record.id,
        content: record.content,
        created_at: record.created_at,
        scope: record.scope_type,
      })) }
    },
    presentCall: args => ({ card: 'generic', title: 'Search project dreams', kind: 'read', rawInput: args.query }),
  }))
}
