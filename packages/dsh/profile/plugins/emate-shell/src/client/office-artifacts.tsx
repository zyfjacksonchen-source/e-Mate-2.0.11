import type { ConversationNodeDefinition } from '@deepseek-ai/dsh-client-runtime/client'
import { isAppendSurfaceEvent } from '@deepseek-ai/dsh-client-runtime/client'
import type { TurnTailOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import css from './legacy-artifacts.module.css'

const ARTIFACT_ID = /^office_artifact:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const SHA256 = /^[0-9a-f]{64}$/u
const MAX_BYTES = 5 * 1024 * 1024
const FAMILIES = {
  document: {
    label: 'DOCX',
    extension: '.docx',
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  },
  spreadsheet: {
    label: 'XLSX',
    extension: '.xlsx',
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  },
  presentation: {
    label: 'PPTX',
    extension: '.pptx',
    mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  },
  pdf: { label: 'PDF', extension: '.pdf', mime: 'application/pdf' },
} as const

type OfficeFamily = keyof typeof FAMILIES

interface OfficeArtifact {
  readonly artifact_id: string
  readonly family: OfficeFamily
  readonly filename: string
  readonly mime_type: string
  readonly size_bytes: number
  readonly sha256: string
  readonly download_url: string
}

interface ProducedOfficeArtifact extends OfficeArtifact {
  readonly seq: number
}

interface OfficeArtifactsTurnData {
  readonly artifacts: readonly ProducedOfficeArtifact[]
}

interface OfficeArtifactsState extends OfficeArtifactsTurnData {
  readonly turn: number
}

declare module '@deepseek-ai/dsh-client-runtime/client' {
  interface ConversationTurnDataMap {
    /** Successful Office files projected from target Tool presentation metadata. */
    'e-mate-office-artifacts': OfficeArtifactsTurnData
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function parseArtifact(meta: unknown): OfficeArtifact | null {
  if (!isRecord(meta) || !isRecord(meta.eMateOfficeArtifact)) return null
  const value = meta.eMateOfficeArtifact
  const family = typeof value.family === 'string' ? FAMILIES[value.family as OfficeFamily] : undefined
  if (family === undefined
    || typeof value.artifact_id !== 'string'
    || !ARTIFACT_ID.test(value.artifact_id)
    || typeof value.filename !== 'string'
    || value.filename.length < 1
    || value.filename.length > 240
    || !value.filename.toLowerCase().endsWith(family.extension)
    || value.mime_type !== family.mime
    || typeof value.size_bytes !== 'number'
    || !Number.isSafeInteger(value.size_bytes)
    || value.size_bytes < 1
    || value.size_bytes > MAX_BYTES
    || typeof value.sha256 !== 'string'
    || !SHA256.test(value.sha256)
    || value.download_url !== `/api/e-mate/office.download?id=${encodeURIComponent(value.artifact_id)}`) return null
  return value as unknown as OfficeArtifact
}

export const officeArtifactsDefinition: ConversationNodeDefinition<OfficeArtifactsState> = {
  kind: 'e-mate-office-artifacts',
  match: event => {
    if (event.type === 'turn/start') return { id: String(event.data.turn), role: 'start' }
    if (event.type === 'tool/result' && isAppendSurfaceEvent(event) && parseArtifact(event.data.meta) !== null) {
      return { id: String(event.data.turn), role: 'update' }
    }
    return null
  },
  start: (_context, match) => {
    if (match.event.type !== 'turn/start') throw new Error('Office artifacts require turn/start')
    return { turn: match.event.data.turn, artifacts: [] }
  },
  update: (context, match) => {
    if (match.event.type !== 'tool/result') return context.state
    const artifact = parseArtifact(match.event.data.meta)
    if (artifact === null || context.state.artifacts.some(item => item.artifact_id === artifact.artifact_id)) {
      return context.state
    }
    return { ...context.state, artifacts: [...context.state.artifacts, { ...artifact, seq: match.event.seq }] }
  },
  buildLocationData: (context, scope) => scope !== 'turn'
    || context.state === undefined
    || context.state.artifacts.length === 0
    ? null
    : {
        kind: 'turn',
        turn: context.state.turn,
        key: 'e-mate-office-artifacts',
        value: { artifacts: context.state.artifacts },
      },
}

export function selectOfficeArtifacts(owner: TurnTailOwnerProps): readonly ProducedOfficeArtifact[] | null {
  const data = owner.turn.data.get('e-mate-office-artifacts')
  if (data === undefined) return null
  const artifacts = data.artifacts.filter(item => item.seq <= owner.seq)
  return artifacts.length === 0 ? null : artifacts
}

function readableBytes(value: number): string {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`
  return `${(value / (1024 * 1024)).toFixed(1)} MiB`
}

interface OfficeArtifactsProps {
  readonly matched: readonly ProducedOfficeArtifact[]
  readonly canDownload: boolean
}

export function OfficeArtifacts({ matched, canDownload }: OfficeArtifactsProps) {
  return (
    <section className={css.root} aria-label="文件与文档" data-emate-office-artifacts="">
      <div className={css.heading}>文件与文档</div>
      <div className={css.list}>
        {matched.map(artifact => (
          <div className={css.item} key={artifact.artifact_id}>
            <div className={css.copy}>
              <strong title={artifact.filename}>{artifact.filename}</strong>
              <span>{FAMILIES[artifact.family].label} · {readableBytes(artifact.size_bytes)}</span>
            </div>
            {canDownload
              ? <a className={css.download} href={artifact.download_url} download={artifact.filename}>下载</a>
              : <span className={css.unavailable}>仅可在本机下载</span>}
          </div>
        ))}
      </div>
    </section>
  )
}
