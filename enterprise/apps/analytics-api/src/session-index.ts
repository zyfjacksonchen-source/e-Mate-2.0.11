import { Pool } from 'pg';
import {
  parseSessionSummary,
  parseSessionSummaryIdentifier,
  parseSessionSummaryWrite,
  type SessionSummary,
  type SessionSummaryWrite,
} from '@e-mate/session-index-contract';
import type { RuntimeRegistryPrincipal } from './runtime-registry.ts';

const maxProjectIds = 1_000;
const principalPattern = /^[^\p{Cc}]{1,128}$/u;

export type SessionIndexSearch = {
  query: string;
  projectId?: string;
  includeArchived: boolean;
  limit: number;
};

export type SessionIndexWriteResult =
  | { status: 'OK'; summary: SessionSummary }
  | { status: 'CONFLICT' }
  | { status: 'DENIED' };

export type SessionSummaryStore = {
  write(
    principal: RuntimeRegistryPrincipal,
    sessionId: string,
    value: SessionSummaryWrite
  ): Promise<SessionIndexWriteResult>;
  get(principal: RuntimeRegistryPrincipal, sessionId: string): Promise<SessionSummary | null>;
  search(principal: RuntimeRegistryPrincipal, input: SessionIndexSearch): Promise<SessionSummary[]>;
};

type SummaryRow = {
  session_id: string;
  owner_id: string;
  title: string;
  summary: string;
  project_id: string | null;
  tags: string[];
  state: string;
  updated_at: Date;
  source_cursor: string;
};

function projectIds(principal: RuntimeRegistryPrincipal): string[] {
  const ids = principal.projectIds ?? [];
  if (
    ids.length > maxProjectIds ||
    new Set(ids).size !== ids.length ||
    ids.some((id) => {
      try {
        parseSessionSummaryIdentifier(id);
        return false;
      } catch {
        return true;
      }
    })
  ) {
    throw new Error('Invalid project authorization');
  }
  return ids;
}

function principalId(value: string, label: string): string {
  if (value.trim() !== value || !principalPattern.test(value)) {
    throw new Error(`Invalid ${label}`);
  }
  return value;
}

function canAccessProject(principal: RuntimeRegistryPrincipal, projectId: string): boolean {
  return projectIds(principal).includes(projectId);
}

function mapRow(row: SummaryRow): SessionSummary {
  const sourceCursor = Number(row.source_cursor);
  return parseSessionSummary({
    schemaVersion: 1,
    sessionId: row.session_id,
    ownerId: row.owner_id,
    title: row.title,
    summary: row.summary,
    ...(row.project_id ? { projectId: row.project_id } : {}),
    tags: row.tags,
    state: row.state,
    updatedAt: row.updated_at.toISOString(),
    sourceCursor,
  });
}

export class PostgresSessionSummaryStore implements SessionSummaryStore {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async initialize(): Promise<void> {
    await this.#pool.query(`
      CREATE TABLE IF NOT EXISTS e_mate_session_summary (
        tenant_id text NOT NULL,
        session_id text NOT NULL,
        owner_id text NOT NULL,
        title text NOT NULL,
        summary text NOT NULL,
        project_id text,
        tags text[] NOT NULL DEFAULT '{}',
        state text NOT NULL CHECK (state IN ('ACTIVE', 'ARCHIVED', 'DELETED')),
        updated_at timestamptz NOT NULL,
        source_cursor bigint NOT NULL CHECK (source_cursor > 0),
        PRIMARY KEY (tenant_id, session_id)
      );
      CREATE INDEX IF NOT EXISTS e_mate_session_summary_owner
        ON e_mate_session_summary (tenant_id, owner_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS e_mate_session_summary_project
        ON e_mate_session_summary (tenant_id, project_id, updated_at DESC)
        WHERE project_id IS NOT NULL;
    `);
  }

  async write(
    principal: RuntimeRegistryPrincipal,
    sessionIdInput: string,
    value: SessionSummaryWrite
  ): Promise<SessionIndexWriteResult> {
    const sessionId = parseSessionSummaryIdentifier(sessionIdInput);
    const input = parseSessionSummaryWrite(value);
    const tenantId = principalId(principal.tenantId, 'tenant id');
    const ownerId = principalId(principal.userId, 'owner id');
    const authorizedProjects = projectIds(principal);
    if (input.projectId && !canAccessProject(principal, input.projectId)) {
      return { status: 'DENIED' };
    }
    const values = [
      tenantId,
      sessionId,
      ownerId,
      input.title,
      input.summary,
      input.projectId ?? null,
      input.tags,
      input.state,
      input.updatedAt,
    ];
    const result =
      input.expectedSourceCursor === null
        ? await this.#pool.query<SummaryRow>(
            `
          INSERT INTO e_mate_session_summary (
            tenant_id, session_id, owner_id, title, summary, project_id,
            tags, state, updated_at, source_cursor
          )
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,1)
          ON CONFLICT DO NOTHING
          RETURNING session_id, owner_id, title, summary, project_id, tags,
                    state, updated_at, source_cursor
        `,
            values
          )
        : await this.#pool.query<SummaryRow>(
            `
          UPDATE e_mate_session_summary
             SET title = $4,
                 summary = $5,
                 project_id = $6,
                 tags = $7,
                 state = $8,
                 updated_at = $9,
                 source_cursor = source_cursor + 1
           WHERE tenant_id = $1
             AND session_id = $2
             AND owner_id = $3
             AND source_cursor = $10
             AND updated_at <= $9
             AND (project_id IS NULL OR project_id = ANY($11::text[]))
          RETURNING session_id, owner_id, title, summary, project_id, tags,
                    state, updated_at, source_cursor
        `,
            [...values, input.expectedSourceCursor, authorizedProjects]
          );
    let row = result.rows[0];
    if (!row && input.expectedSourceCursor === null && input.state === 'DELETED') {
      const existing = await this.#pool.query<SummaryRow>(
        `
        SELECT session_id, owner_id, title, summary, project_id, tags,
               state, updated_at, source_cursor
          FROM e_mate_session_summary
         WHERE tenant_id = $1
           AND session_id = $2
           AND owner_id = $3
           AND state = 'DELETED'
           AND (project_id IS NULL OR project_id = ANY($4::text[]))
         LIMIT 1
      `,
        [tenantId, sessionId, ownerId, authorizedProjects]
      );
      row = existing.rows[0];
    }
    return row ? { status: 'OK', summary: mapRow(row) } : { status: 'CONFLICT' };
  }

  async get(principal: RuntimeRegistryPrincipal, sessionIdInput: string): Promise<SessionSummary | null> {
    const result = await this.#pool.query<SummaryRow>(
      `
      SELECT session_id, owner_id, title, summary, project_id, tags,
             state, updated_at, source_cursor
        FROM e_mate_session_summary
       WHERE tenant_id = $1
         AND session_id = $2
         AND state <> 'DELETED'
         AND (
           (project_id IS NULL AND owner_id = $3) OR
           project_id = ANY($4::text[])
         )
       LIMIT 1
    `,
      [
        principalId(principal.tenantId, 'tenant id'),
        parseSessionSummaryIdentifier(sessionIdInput),
        principalId(principal.userId, 'owner id'),
        projectIds(principal),
      ]
    );
    return result.rows[0] ? mapRow(result.rows[0]) : null;
  }

  async search(principal: RuntimeRegistryPrincipal, input: SessionIndexSearch): Promise<SessionSummary[]> {
    if (
      input.query.length > 200 ||
      input.query.trim() !== input.query ||
      !Number.isSafeInteger(input.limit) ||
      input.limit < 1 ||
      input.limit > 50 ||
      (input.projectId && !canAccessProject(principal, input.projectId))
    ) {
      throw new Error('Invalid Session Index search');
    }
    const needle = `%${input.query.replace(/[!%_]/g, '!$&')}%`;
    const result = await this.#pool.query<SummaryRow>(
      `
      SELECT session_id, owner_id, title, summary, project_id, tags,
             state, updated_at, source_cursor
        FROM e_mate_session_summary
       WHERE tenant_id = $1
         AND state <> 'DELETED'
         AND ($5::boolean OR state = 'ACTIVE')
         AND (
           (project_id IS NULL AND owner_id = $2) OR
           project_id = ANY($3::text[])
         )
         AND ($4::text IS NULL OR project_id = $4)
         AND (
           $6 = '%%' OR
           title ILIKE $6 ESCAPE '!' OR
           summary ILIKE $6 ESCAPE '!' OR
           EXISTS (SELECT 1 FROM unnest(tags) AS tag WHERE tag ILIKE $6 ESCAPE '!')
         )
       ORDER BY updated_at DESC, session_id ASC
       LIMIT $7
    `,
      [
        principalId(principal.tenantId, 'tenant id'),
        principalId(principal.userId, 'owner id'),
        projectIds(principal),
        input.projectId ?? null,
        input.includeArchived,
        needle,
        input.limit,
      ]
    );
    return result.rows.map(mapRow);
  }
}

export async function openPostgresSessionSummaryStore(url: string): Promise<{
  store: PostgresSessionSummaryStore;
  close: () => Promise<void>;
}> {
  const parsed = new URL(url);
  const loopback = ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(parsed.hostname);
  const privateService = parsed.hostname === 'postgres';
  const queryValid =
    loopback || privateService
      ? !parsed.search
      : parsed.searchParams.size === 1 && parsed.searchParams.get('sslmode') === 'require';
  if (
    (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') ||
    !parsed.hostname ||
    parsed.hash ||
    !queryValid
  ) {
    throw new Error('PostgreSQL URL was invalid');
  }
  const pool = new Pool({
    connectionString: url,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    ...(loopback || privateService ? {} : { ssl: { rejectUnauthorized: true } }),
  });
  pool.on('error', () => undefined);
  const store = new PostgresSessionSummaryStore(pool);
  try {
    await store.initialize();
  } catch (error) {
    await pool.end().catch(() => undefined);
    throw error;
  }
  return { store, close: () => pool.end() };
}
