/** Thin Harness Skill adapter for the pinned ego-browser command. */

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { supportForPlatform, WINDOWS_EDGE_CANDIDATE } from './platform.ts'

interface SkillLookupOptions {
  signal?: AbortSignal
}

type EgoSkillCandidate = ReturnType<typeof summary>

interface SkillDefinition extends Omit<EgoSkillCandidate, 'rank' | 'locator'> {
  content: string
}

interface SkillProvider {
  name: string
  list(options: SkillLookupOptions): Promise<readonly EgoSkillCandidate[]>
  get(skill: EgoSkillCandidate, options: SkillLookupOptions): Promise<SkillDefinition | undefined>
}

interface SkillContext {
  skills: {
    registerProvider(create: () => SkillProvider): () => void
  }
}

export const name = 'emate-ego-browser'
export const inject = ['skills']
const PROVIDER_NAME = name
const SKILL_NAME = 'ego-browser'
const BUNDLED_SKILL_RANK = 600
const UPSTREAM_COMMIT = 'c46a439e7fbad90ad33dbea6c6af329b6009809f'
const skillDirectory = fileURLToPath(new URL('../skills/ego-browser/', import.meta.url))
const skillPath = `${skillDirectory}SKILL.md`

function summary() {
  const platform = supportForPlatform(process.platform)
  const invocable = platform.status === 'ready'
  return {
    name: SKILL_NAME,
    description: 'Browser automation candidate: ego lite on macOS and pinned Playwright MCP with system Edge on Windows; both remain setup-required until platform acceptance passes.',
    whenToUse: 'Do not invoke this candidate while its platform status is not ready.',
    invocation: { modelInvocable: invocable, userInvocable: invocable },
    source: 'bundled' as const,
    provider: PROVIDER_NAME,
    resourceBase: { kind: 'directory' as const, path: skillDirectory },
    rank: BUNDLED_SKILL_RANK,
    locator: SKILL_NAME,
    path: skillPath,
    metadata: {
      eMateCapability: 'browser',
      adapter: 'skill-cli',
      supportedPlatforms: [],
      setupRequiredPlatforms: ['darwin', 'win32'],
      platformStatus: platform.status,
      ...platform.code === undefined ? {} : { blockedCode: platform.code },
      upstreamCommit: UPSTREAM_COMMIT,
      windowsCandidate: WINDOWS_EDGE_CANDIDATE,
    },
  }
}

async function loadDefinition(options: SkillLookupOptions): Promise<SkillDefinition> {
  const raw = await readFile(skillPath, options.signal === undefined
    ? { encoding: 'utf8' }
    : { encoding: 'utf8', signal: options.signal })
  const lines = raw.replace(/^\uFEFF/, '').split(/\r?\n/)
  const end = lines[0] === '---' ? lines.indexOf('---', 1) : -1
  if (end < 0) throw new Error(`${PROVIDER_NAME}: malformed skill frontmatter in ${skillPath}`)
  const skill = summary()
  return {
    name: skill.name,
    description: skill.description,
    whenToUse: skill.whenToUse,
    invocation: skill.invocation,
    source: skill.source,
    provider: skill.provider,
    resourceBase: skill.resourceBase,
    path: skill.path,
    metadata: skill.metadata,
    content: lines.slice(end + 1).join('\n').trim(),
  }
}

/** Register ego-browser through the Harness skill provider seam only. */
export function apply(ctx: SkillContext): void {
  ctx.skills.registerProvider((): SkillProvider => ({
    name: PROVIDER_NAME,
    async list(options) {
      options.signal?.throwIfAborted()
      return [summary()]
    },
    async get(skill, options) {
      options.signal?.throwIfAborted()
      return skill.name === SKILL_NAME && skill.locator === SKILL_NAME
        ? await loadDefinition(options)
        : undefined
    },
  }))
}
