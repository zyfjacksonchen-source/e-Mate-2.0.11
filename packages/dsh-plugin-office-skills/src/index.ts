/** Clean-room Office skill bundle for the pinned Harness skill registry. */

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

interface SkillLookupOptions {
  signal?: AbortSignal
}

interface SkillCandidate {
  name: string
  description: string
  whenToUse: string
  invocation: typeof INVOCATION
  source: 'bundled'
  provider: string
  resourceBase: { kind: 'directory'; path: string }
  rank: number
  locator: unknown
  path: string
  metadata: Readonly<Record<string, unknown>>
}

interface SkillDefinition extends Omit<SkillCandidate, 'rank' | 'locator'> {
  content: string
}

interface SkillProvider {
  name: string
  list(options: SkillLookupOptions): Promise<readonly SkillCandidate[]>
  get(skill: SkillCandidate, options: SkillLookupOptions): Promise<SkillDefinition | undefined>
}

interface SkillContext {
  skills: {
    registerProvider(create: () => SkillProvider): () => void
  }
}

export const name = 'emate-office-skills'
export const inject = ['skills']
const PROVIDER_NAME = name
// Pinned Harness rc.5 assigns packaged skills rank 600.
const BUNDLED_SKILL_RANK = 600
const INVOCATION = { modelInvocable: true, userInvocable: true } as const

interface SkillSpec {
  name: string
  description: string
  whenToUse: string
  directory: string
  format: 'docx' | 'pdf' | 'xlsx' | 'pptx'
}

const skillRoot = fileURLToPath(new URL('../skills/', import.meta.url))
const SPECS: readonly SkillSpec[] = [
  {
    name: 'documents',
    description: 'Read, create, edit, and verify DOCX documents with a fail-closed host-toolchain check.',
    whenToUse: 'Use for Word or DOCX reading, authoring, editing, review, and conversion tasks.',
    directory: `${skillRoot}documents`,
    format: 'docx',
  },
  {
    name: 'pdf',
    description: 'Read, create, fill, edit, and visually verify PDF files with a fail-closed host-toolchain check.',
    whenToUse: 'Use for PDF reading, generation, form filling, editing, extraction, rendering, or review.',
    directory: `${skillRoot}pdf`,
    format: 'pdf',
  },
  {
    name: 'spreadsheets',
    description: 'Read, create, edit, calculate, and verify XLSX, CSV, and TSV workbooks with a fail-closed host-toolchain check.',
    whenToUse: 'Use for spreadsheet authoring, editing, analysis, formulas, charts, or workbook review.',
    directory: `${skillRoot}spreadsheets`,
    format: 'xlsx',
  },
  {
    name: 'presentations',
    description: 'Read, create, edit, render, and verify PPTX presentations with a fail-closed host-toolchain check.',
    whenToUse: 'Use for PowerPoint or PPTX authoring, editing, layout, rendering, and review.',
    directory: `${skillRoot}presentations`,
    format: 'pptx',
  },
]

function candidate(spec: SkillSpec): SkillCandidate {
  return {
    name: spec.name,
    description: spec.description,
    whenToUse: spec.whenToUse,
    invocation: INVOCATION,
    source: 'bundled',
    provider: PROVIDER_NAME,
    resourceBase: { kind: 'directory', path: spec.directory },
    rank: BUNDLED_SKILL_RANK,
    locator: spec.name,
    path: `${spec.directory}/SKILL.md`,
    metadata: { eMateCapability: 'office', format: spec.format, adapter: 'clean-room' },
  }
}

async function loadDefinition(spec: SkillSpec, options: SkillLookupOptions): Promise<SkillDefinition> {
  const path = `${spec.directory}/SKILL.md`
  const raw = await readFile(path, options.signal === undefined
    ? { encoding: 'utf8' }
    : { encoding: 'utf8', signal: options.signal })
  const lines = raw.replace(/^\uFEFF/, '').split(/\r?\n/)
  const end = lines[0] === '---' ? lines.indexOf('---', 1) : -1
  if (end < 0) throw new Error(`${PROVIDER_NAME}: malformed skill frontmatter in ${path}`)
  const summary = candidate(spec)
  return {
    name: summary.name,
    description: summary.description,
    whenToUse: summary.whenToUse,
    invocation: summary.invocation,
    source: summary.source,
    provider: summary.provider,
    resourceBase: summary.resourceBase,
    path,
    metadata: summary.metadata,
    content: lines.slice(end + 1).join('\n').trim(),
  }
}

/** Register the four packaged skills through the Harness skill provider seam. */
export function apply(ctx: SkillContext): void {
  ctx.skills.registerProvider((): SkillProvider => ({
    name: PROVIDER_NAME,
    async list(options) {
      options.signal?.throwIfAborted()
      return SPECS.map(candidate)
    },
    async get(skill, options) {
      options.signal?.throwIfAborted()
      const spec = SPECS.find(item => item.name === skill.name && item.name === skill.locator)
      return spec === undefined ? undefined : await loadDefinition(spec, options)
    },
  }))
}
