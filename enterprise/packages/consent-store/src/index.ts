import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import {
  parseAdminConsentList,
  parseAdminConsentQuery,
  parseConsentAcceptance,
  parseConsentAcceptanceInput,
  parseConsentPolicy,
  parseConsentStatus,
  type AdminConsentList,
  type AdminConsentQuery,
  type ConsentAcceptance,
  type ConsentAcceptanceInput,
  type ConsentPolicy,
  type ConsentStatus,
} from '@e-mate/admin-contract';

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export type ConsentPrincipal = { tenantId: string; userId: string };

export type ConsentStore = {
  status(principal: ConsentPrincipal): Promise<ConsentStatus>;
  accept(principal: ConsentPrincipal, input: ConsentAcceptanceInput): Promise<ConsentAcceptance>;
  list(tenantId: string, query: AdminConsentQuery): Promise<AdminConsentList>;
};

export class ConsentStoreError extends Error {
  readonly code: 'POLICY_CHANGED';

  constructor() {
    super('Consent policy changed');
    this.code = 'POLICY_CHANGED';
  }
}

type StoredAcceptance = ConsentAcceptance & { tenantId: string };

type ConsentRow = {
  acceptance_id: string;
  user_id: string;
  agreement_id: string;
  agreement_version: string;
  disclaimer_version: string;
  content_hash: string;
  accepted_at: Date;
  client_version: string;
  locale: string;
};

function identifier(value: string, label: string): string {
  if (!identifierPattern.test(value)) throw new Error(`Invalid ${label}`);
  return value;
}

function policyKey(policy: ConsentPolicy): string {
  return [policy.agreementId, policy.agreementVersion, policy.disclaimerVersion, policy.contentHash].join('\0');
}

function acceptanceKey(tenantId: string, userId: string, policy: ConsentPolicy): string {
  return `${tenantId}\0${userId}\0${policyKey(policy)}`;
}

function samePolicy(input: ConsentPolicy, current: ConsentPolicy): boolean {
  return policyKey(input) === policyKey(current);
}

function publicAcceptance(value: StoredAcceptance): ConsentAcceptance {
  const { tenantId: _tenantId, ...acceptance } = value;
  return acceptance;
}

function acceptanceFromRow(row: ConsentRow): ConsentAcceptance {
  return parseConsentAcceptance({
    schemaVersion: 1,
    acceptanceId: row.acceptance_id,
    userId: row.user_id,
    agreementId: row.agreement_id,
    agreementVersion: row.agreement_version,
    disclaimerVersion: row.disclaimer_version,
    contentHash: row.content_hash,
    acceptedAt: row.accepted_at.toISOString(),
    clientVersion: row.client_version,
    locale: row.locale,
  });
}

export class InMemoryConsentStore implements ConsentStore {
  readonly #policy: ConsentPolicy;
  readonly #accepted = new Map<string, StoredAcceptance>();
  readonly #now: () => number;

  constructor(policy: ConsentPolicy, now: () => number = Date.now) {
    this.#policy = parseConsentPolicy(policy);
    this.#now = now;
  }

  async status(principal: ConsentPrincipal): Promise<ConsentStatus> {
    const tenantId = identifier(principal.tenantId, 'tenant id');
    const userId = identifier(principal.userId, 'user id');
    const stored = this.#accepted.get(acceptanceKey(tenantId, userId, this.#policy));
    return parseConsentStatus({
      schemaVersion: 1,
      policy: this.#policy,
      required: !stored,
      acceptance: stored ? publicAcceptance(stored) : null,
    });
  }

  async accept(principal: ConsentPrincipal, value: ConsentAcceptanceInput): Promise<ConsentAcceptance> {
    const tenantId = identifier(principal.tenantId, 'tenant id');
    const userId = identifier(principal.userId, 'user id');
    const input = parseConsentAcceptanceInput(value);
    if (!samePolicy(input, this.#policy)) throw new ConsentStoreError();
    const key = acceptanceKey(tenantId, userId, this.#policy);
    const existing = this.#accepted.get(key);
    if (existing) return publicAcceptance(existing);
    const acceptance = parseConsentAcceptance({
      ...this.#policy,
      acceptanceId: randomUUID(),
      userId,
      acceptedAt: new Date(this.#now()).toISOString(),
      clientVersion: input.clientVersion,
      locale: input.locale,
    });
    this.#accepted.set(key, { ...acceptance, tenantId });
    return acceptance;
  }

  async list(tenantIdInput: string, value: AdminConsentQuery): Promise<AdminConsentList> {
    const tenantId = identifier(tenantIdInput, 'tenant id');
    const query = parseAdminConsentQuery(value);
    const acceptances = [...this.#accepted.values()]
      .filter((acceptance) => acceptance.tenantId === tenantId)
      .filter((acceptance) => !query.userId || acceptance.userId === query.userId)
      .filter((acceptance) => !query.agreementVersion || acceptance.agreementVersion === query.agreementVersion)
      .filter((acceptance) => !query.disclaimerVersion || acceptance.disclaimerVersion === query.disclaimerVersion)
      .filter((acceptance) => !query.acceptedFrom || acceptance.acceptedAt >= query.acceptedFrom)
      .filter((acceptance) => !query.acceptedTo || acceptance.acceptedAt <= query.acceptedTo)
      .toSorted((left, right) => right.acceptedAt.localeCompare(left.acceptedAt))
      .slice(0, query.limit)
      .map(publicAcceptance);
    return parseAdminConsentList({ schemaVersion: 1, acceptances });
  }
}

export class PostgresConsentStore implements ConsentStore {
  readonly #pool: Pool;
  readonly #policy: ConsentPolicy;

  constructor(pool: Pool, policy: ConsentPolicy) {
    this.#pool = pool;
    this.#policy = parseConsentPolicy(policy);
  }

  async initialize(): Promise<void> {
    await this.#pool.query(`
      CREATE TABLE IF NOT EXISTS e_mate_consent_acceptance (
        tenant_id text NOT NULL,
        acceptance_id uuid NOT NULL,
        user_id text NOT NULL,
        agreement_id text NOT NULL,
        agreement_version text NOT NULL,
        disclaimer_version text NOT NULL,
        content_hash text NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
        accepted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
        client_version text NOT NULL CHECK (char_length(client_version) BETWEEN 1 AND 64),
        locale text NOT NULL CHECK (char_length(locale) BETWEEN 2 AND 35),
        PRIMARY KEY (tenant_id, acceptance_id),
        UNIQUE (
          tenant_id, user_id, agreement_id, agreement_version,
          disclaimer_version, content_hash
        )
      );
      CREATE INDEX IF NOT EXISTS e_mate_consent_acceptance_user_time
        ON e_mate_consent_acceptance (tenant_id, user_id, accepted_at DESC);
      CREATE INDEX IF NOT EXISTS e_mate_consent_acceptance_policy_time
        ON e_mate_consent_acceptance (
          tenant_id, agreement_version, disclaimer_version, accepted_at DESC
        );
    `);
  }

  async status(principal: ConsentPrincipal): Promise<ConsentStatus> {
    const tenantId = identifier(principal.tenantId, 'tenant id');
    const userId = identifier(principal.userId, 'user id');
    const result = await this.#pool.query<ConsentRow>(
      `
      SELECT acceptance_id, user_id, agreement_id, agreement_version,
             disclaimer_version, content_hash, accepted_at, client_version, locale
        FROM e_mate_consent_acceptance
       WHERE tenant_id = $1 AND user_id = $2 AND agreement_id = $3
         AND agreement_version = $4 AND disclaimer_version = $5 AND content_hash = $6
       LIMIT 1
    `,
      [
        tenantId,
        userId,
        this.#policy.agreementId,
        this.#policy.agreementVersion,
        this.#policy.disclaimerVersion,
        this.#policy.contentHash,
      ]
    );
    const acceptance = result.rows[0] ? acceptanceFromRow(result.rows[0]) : null;
    return parseConsentStatus({
      schemaVersion: 1,
      policy: this.#policy,
      required: acceptance === null,
      acceptance,
    });
  }

  async accept(principal: ConsentPrincipal, value: ConsentAcceptanceInput): Promise<ConsentAcceptance> {
    const tenantId = identifier(principal.tenantId, 'tenant id');
    const userId = identifier(principal.userId, 'user id');
    const input = parseConsentAcceptanceInput(value);
    if (!samePolicy(input, this.#policy)) throw new ConsentStoreError();
    let result = await this.#pool.query<ConsentRow>(
      `
      INSERT INTO e_mate_consent_acceptance (
        tenant_id, acceptance_id, user_id, agreement_id, agreement_version,
        disclaimer_version, content_hash, client_version, locale
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      ON CONFLICT (
        tenant_id, user_id, agreement_id, agreement_version,
        disclaimer_version, content_hash
      ) DO NOTHING
      RETURNING acceptance_id, user_id, agreement_id, agreement_version,
                disclaimer_version, content_hash, accepted_at, client_version, locale
    `,
      [
        tenantId,
        randomUUID(),
        userId,
        input.agreementId,
        input.agreementVersion,
        input.disclaimerVersion,
        input.contentHash,
        input.clientVersion,
        input.locale,
      ]
    );
    if (!result.rows[0]) {
      result = await this.#pool.query<ConsentRow>(
        `
        SELECT acceptance_id, user_id, agreement_id, agreement_version,
               disclaimer_version, content_hash, accepted_at, client_version, locale
          FROM e_mate_consent_acceptance
         WHERE tenant_id = $1 AND user_id = $2 AND agreement_id = $3
           AND agreement_version = $4 AND disclaimer_version = $5 AND content_hash = $6
         LIMIT 1
      `,
        [tenantId, userId, input.agreementId, input.agreementVersion, input.disclaimerVersion, input.contentHash]
      );
    }
    const row = result.rows[0];
    if (!row) throw new Error('Consent acceptance was not returned');
    return acceptanceFromRow(row);
  }

  async list(tenantIdInput: string, value: AdminConsentQuery): Promise<AdminConsentList> {
    const tenantId = identifier(tenantIdInput, 'tenant id');
    const query = parseAdminConsentQuery(value);
    const result = await this.#pool.query<ConsentRow>(
      `
      SELECT acceptance_id, user_id, agreement_id, agreement_version,
             disclaimer_version, content_hash, accepted_at, client_version, locale
        FROM e_mate_consent_acceptance
       WHERE tenant_id = $1
         AND ($2::text IS NULL OR user_id = $2)
         AND ($3::text IS NULL OR agreement_version = $3)
         AND ($4::text IS NULL OR disclaimer_version = $4)
         AND ($5::timestamptz IS NULL OR accepted_at >= $5)
         AND ($6::timestamptz IS NULL OR accepted_at <= $6)
       ORDER BY accepted_at DESC, acceptance_id DESC
       LIMIT $7
    `,
      [
        tenantId,
        query.userId ?? null,
        query.agreementVersion ?? null,
        query.disclaimerVersion ?? null,
        query.acceptedFrom ?? null,
        query.acceptedTo ?? null,
        query.limit,
      ]
    );
    return parseAdminConsentList({ schemaVersion: 1, acceptances: result.rows.map(acceptanceFromRow) });
  }
}

function postgresUrl(value: string): string {
  const url = new URL(value);
  const loopback = ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname);
  const privateService = url.hostname === 'postgres';
  const queryValid =
    loopback || privateService
      ? !url.search
      : url.searchParams.size === 1 && url.searchParams.get('sslmode') === 'require';
  if ((url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') || !url.hostname || url.hash || !queryValid) {
    throw new Error('PostgreSQL URL was invalid');
  }
  return url.toString();
}

export async function openPostgresConsentStore(
  url: string,
  policy: ConsentPolicy
): Promise<{ store: PostgresConsentStore; close: () => Promise<void> }> {
  const connectionString = postgresUrl(url);
  const hostname = new URL(connectionString).hostname;
  const loopback = ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(hostname);
  const privateService = hostname === 'postgres';
  const pool = new Pool({
    connectionString,
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    ...(loopback || privateService ? {} : { ssl: { rejectUnauthorized: true } }),
  });
  pool.on('error', () => undefined);
  const store = new PostgresConsentStore(pool, policy);
  try {
    await store.initialize();
  } catch (error) {
    await pool.end().catch(() => undefined);
    throw error;
  }
  return { store, close: () => pool.end() };
}
