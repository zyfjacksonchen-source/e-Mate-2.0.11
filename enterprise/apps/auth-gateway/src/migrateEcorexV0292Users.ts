import { createHash, randomUUID } from 'node:crypto';
import {
  AUTH_CREDENTIAL_SCHEMA_SQL,
  AUTH_CREDENTIAL_SOURCE_VERSION_MIGRATION_SQL,
  normalizeLoginIdentifier,
} from '@e-mate/auth-credential';
import { Pool, type PoolClient } from 'pg';
import type { DatabaseSync } from 'node:sqlite';

const expectedSourceTotal = 40;
const expectedActiveTotal = 39;
const expectedDisabledTotal = 1;
const expectedSkippedTotal = 1;
const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const encodedHashPattern = /^pbkdf2_sha256\$180000\$[A-Za-z0-9+/]{22}==\$[A-Za-z0-9+/]{43}=$/;

type SourceUser = {
  accountId: string;
  displayName: string;
  loginIdentifier: string;
  status: 'ACTIVE' | 'SUSPENDED';
  encodedHash: string;
  sourceVersion: '0.2.9.2' | 'admin';
  sourceRecordSha256: Buffer;
};

type MigrationMode = 'apply' | 'dry-run';

export type MigrationOptions = {
  mode: MigrationMode;
  sourceAdminDatabase: string;
  sourceControlDatabase: string;
  tenantId: string;
  databaseUrl: string;
};

type ExistingState = {
  user_exists: boolean;
  current_count: string;
  current_exact: string;
  legacy_count: string;
  legacy_exact: string;
  source_record_sha256: Buffer | null;
  legacy_encoded_hash: string | null;
};

function argument(arguments_: string[], name: string): string {
  const position = arguments_.indexOf(name);
  const value = position >= 0 ? arguments_[position + 1] : undefined;
  if (!value || value.startsWith('--')) throw new Error('Invalid migration arguments');
  return value;
}

function parseOptions(arguments_: string[], environment: NodeJS.ProcessEnv): MigrationOptions {
  const dryRun = arguments_.includes('--dry-run');
  const apply = arguments_.includes('--apply');
  const databaseUrl = environment.E_MATE_MIGRATION_DATABASE_URL;
  if (dryRun === apply || !databaseUrl) throw new Error('Invalid migration arguments');
  const tenantId = argument(arguments_, '--tenant-id');
  if (!identifierPattern.test(tenantId)) throw new Error('Invalid migration arguments');
  return {
    mode: dryRun ? 'dry-run' : 'apply',
    sourceAdminDatabase: argument(arguments_, '--source-admin-db'),
    sourceControlDatabase: argument(arguments_, '--source-control-db'),
    tenantId,
    databaseUrl,
  };
}

function sourceRecordSha256(user: Omit<SourceUser, 'sourceRecordSha256'>): Buffer {
  return createHash('sha256')
    .update(user.accountId, 'utf8')
    .update('\0')
    .update(user.loginIdentifier, 'utf8')
    .update('\0')
    .update(user.displayName, 'utf8')
    .update('\0')
    .update(user.status, 'ascii')
    .update('\0')
    .update(user.encodedHash, 'ascii')
    .digest();
}

async function openReadOnlyDatabase(path: string): Promise<DatabaseSync> {
  if ('bun' in process.versions) {
    const bunSqlite = 'bun:sqlite';
    const { Database } = await import(bunSqlite);
    return new Database(path, { readonly: true }) as unknown as DatabaseSync;
  }
  const { DatabaseSync: NodeDatabaseSync } = await import('node:sqlite');
  return new NodeDatabaseSync(path, { readOnly: true });
}

async function loadSource(migrationOptions: MigrationOptions): Promise<{ users: SourceUser[]; skipped: number }> {
  const control = await openReadOnlyDatabase(migrationOptions.sourceControlDatabase);
  const admin = await openReadOnlyDatabase(migrationOptions.sourceAdminDatabase);
  try {
    const credentials = control
      .prepare(
        `SELECT account_id, algorithm, source_version
           FROM admin_ops_password_credentials
          WHERE source_version IN ('0.2.9.2', 'admin')
          ORDER BY account_id`
      )
      .all() as Array<{ account_id: string; algorithm: string; source_version: '0.2.9.2' | 'admin' }>;
    const currentUser = admin.prepare(
      `SELECT id, name, email, role, status, password_hash, deleted_at
         FROM users
        WHERE id = ?`
    );
    let skipped = 0;
    const users = credentials.flatMap((credential): SourceUser[] => {
      const row = currentUser.get(credential.account_id) as
        | {
            id: string;
            name: string;
            email: string;
            role: string;
            status: string;
            password_hash: string;
            deleted_at: string | null;
          }
        | undefined;
      if (credential.algorithm !== 'pbkdf2_sha256') {
        throw new Error('Source account set is not the approved v0.2.9.2 cohort');
      }
      if (!row) {
        if (credential.source_version !== 'admin') {
          throw new Error('Source account set is not the approved v0.2.9.2 cohort');
        }
        skipped += 1;
        return [];
      }
      if (
        row.role !== 'member' ||
        row.id !== credential.account_id ||
        !identifierPattern.test(row.id) ||
        typeof row.name !== 'string' ||
        !row.name.trim() ||
        row.name.length > 120 ||
        !encodedHashPattern.test(row.password_hash) ||
        !['active', 'disabled'].includes(row.status) ||
        !(
          (row.status === 'active' && row.deleted_at === null) ||
          (row.status === 'disabled' && row.deleted_at !== null)
        )
      ) {
        throw new Error('Source account set is not the approved v0.2.9.2 cohort');
      }
      const source = {
        accountId: row.id,
        displayName: row.name,
        loginIdentifier: normalizeLoginIdentifier(row.email),
        status: row.status === 'active' ? ('ACTIVE' as const) : ('SUSPENDED' as const),
        encodedHash: row.password_hash,
        sourceVersion: credential.source_version,
      };
      return [
        {
          accountId: source.accountId,
          displayName: source.displayName,
          loginIdentifier: source.loginIdentifier,
          status: source.status,
          encodedHash: source.encodedHash,
          sourceVersion: source.sourceVersion,
          sourceRecordSha256: sourceRecordSha256(source),
        },
      ];
    });
    const active = users.filter((user) => user.status === 'ACTIVE').length;
    const disabled = users.filter((user) => user.status === 'SUSPENDED').length;
    if (
      users.length !== expectedSourceTotal ||
      credentials.length !== expectedSourceTotal + expectedSkippedTotal ||
      skipped !== expectedSkippedTotal ||
      active !== expectedActiveTotal ||
      disabled !== expectedDisabledTotal ||
      new Set(users.map((user) => user.accountId)).size !== users.length ||
      new Set(users.map((user) => user.loginIdentifier)).size !== users.length
    ) {
      throw new Error('Source account set is not the approved v0.2.9.2 cohort');
    }
    return { users, skipped };
  } finally {
    admin.close();
    control.close();
  }
}

async function existingState(client: PoolClient, tenantId: string, source: SourceUser): Promise<ExistingState> {
  const result = await client.query<ExistingState>(
    `
    SELECT
      EXISTS (
        SELECT 1 FROM e_mate_tenant_user WHERE tenant_id = $1 AND user_id = $2
      ) AS user_exists,
      (
        SELECT count(*) FROM e_mate_auth_password_credential
         WHERE tenant_id = $1 AND (user_id = $2 OR login_identifier_normalized = $3)
      )::text AS current_count,
      (
        SELECT count(*) FROM e_mate_auth_password_credential
         WHERE tenant_id = $1 AND user_id = $2 AND login_identifier_normalized = $3
      )::text AS current_exact,
      (
        SELECT count(*) FROM e_mate_auth_legacy_password_credential
         WHERE tenant_id = $1 AND (user_id = $2 OR login_identifier_normalized = $3)
      )::text AS legacy_count,
      (
        SELECT count(*) FROM e_mate_auth_legacy_password_credential
         WHERE tenant_id = $1 AND user_id = $2 AND login_identifier_normalized = $3
      )::text AS legacy_exact,
      (
        SELECT source_record_sha256 FROM e_mate_auth_credential_migration
         WHERE tenant_id = $1 AND user_id = $2 AND source_version = $4
      ) AS source_record_sha256,
      (
        SELECT encoded_hash FROM e_mate_auth_legacy_password_credential
         WHERE tenant_id = $1 AND user_id = $2 AND login_identifier_normalized = $3
      ) AS legacy_encoded_hash
  `,
    [tenantId, source.accountId, source.loginIdentifier, source.sourceVersion]
  );
  const state = result.rows[0];
  if (!state) throw new Error('Target preflight failed');
  return state;
}

async function importUser(client: PoolClient, tenantId: string, source: SourceUser): Promise<'existing' | 'inserted'> {
  const state = await existingState(client, tenantId, source);
  const currentCount = Number(state.current_count);
  const currentExact = Number(state.current_exact);
  const legacyCount = Number(state.legacy_count);
  const legacyExact = Number(state.legacy_exact);
  if (state.source_record_sha256) {
    const exactEvidence =
      state.source_record_sha256.byteLength === source.sourceRecordSha256.byteLength &&
      state.source_record_sha256.equals(source.sourceRecordSha256);
    const exactCredential =
      (currentCount === 1 && currentExact === 1 && legacyCount === 0) ||
      (currentCount === 0 &&
        legacyCount === 1 &&
        legacyExact === 1 &&
        state.legacy_encoded_hash === source.encodedHash);
    if (!state.user_exists || !exactEvidence || !exactCredential) throw new Error('Target migration conflict');
    return 'existing';
  }
  if (state.user_exists || currentCount !== 0 || legacyCount !== 0) throw new Error('Target migration conflict');
  await client.query(
    `INSERT INTO e_mate_tenant_user (
       tenant_id, user_id, display_name, roles, status, token_limit
     ) VALUES ($1, $2, $3, ARRAY['MEMBER']::text[], $4, NULL)`,
    [tenantId, source.accountId, source.displayName, source.status]
  );
  await client.query(
    `INSERT INTO e_mate_auth_credential_migration (
       tenant_id, user_id, source_version, source_record_sha256
     ) VALUES ($1, $2, $3, $4)`,
    [tenantId, source.accountId, source.sourceVersion, source.sourceRecordSha256]
  );
  await client.query(
    `INSERT INTO e_mate_auth_legacy_password_credential (
       credential_id, tenant_id, user_id, login_identifier_normalized,
       algorithm, encoded_hash, source_version, source_record_sha256
     ) VALUES ($1, $2, $3, $4, 'pbkdf2_sha256', $5, $6, $7)`,
    [
      randomUUID(),
      tenantId,
      source.accountId,
      source.loginIdentifier,
      source.encodedHash,
      source.sourceVersion,
      source.sourceRecordSha256,
    ]
  );
  return 'inserted';
}

export async function migrateEcorexV0292Users(migrationOptions: MigrationOptions): Promise<{
  mode: MigrationMode;
  sourceTotal: number;
  active: number;
  disabled: number;
  inserted: number;
  wouldInsert: number;
  existing: number;
  skipped: number;
}> {
  const { users, skipped } = await loadSource(migrationOptions);
  const pool = new Pool({ connectionString: migrationOptions.databaseUrl, max: 1 });
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('e-mate-ecorex-v0292-user-migration'))`);
    const tenant = await client.query<{ exists: boolean }>(
      'SELECT EXISTS (SELECT 1 FROM e_mate_tenant_user WHERE tenant_id = $1) AS exists',
      [migrationOptions.tenantId]
    );
    if (tenant.rows[0]?.exists !== true) throw new Error('Target tenant is unavailable');
    await client.query(AUTH_CREDENTIAL_SCHEMA_SQL);
    await client.query(AUTH_CREDENTIAL_SOURCE_VERSION_MIGRATION_SQL);
    let inserted = 0;
    let existing = 0;
    for (const user of users) {
      // Imports stay ordered inside one transaction so the first conflict aborts the untouched remainder.
      // eslint-disable-next-line no-await-in-loop
      if ((await importUser(client, migrationOptions.tenantId, user)) === 'inserted') inserted += 1;
      else existing += 1;
    }
    await client.query(migrationOptions.mode === 'apply' ? 'COMMIT' : 'ROLLBACK');
    return {
      mode: migrationOptions.mode,
      sourceTotal: users.length,
      active: expectedActiveTotal,
      disabled: expectedDisabledTotal,
      inserted: migrationOptions.mode === 'apply' ? inserted : 0,
      wouldInsert: migrationOptions.mode === 'dry-run' ? inserted : 0,
      existing,
      skipped,
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]?.replaceAll('\\', '/')}`) {
  migrateEcorexV0292Users(parseOptions(process.argv.slice(2), process.env))
    .then((result) => console.log(JSON.stringify(result)))
    .catch(() => {
      console.error('Migration failed without applying changes');
      process.exitCode = 1;
    });
}
