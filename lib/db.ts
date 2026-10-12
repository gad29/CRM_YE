// PostgreSQL access (Node runtime only).
//
// `sql()` runs on the current transaction when called inside `transaction()`,
// and on the shared pool otherwise — so store functions compose: deleteClient()
// can call deleteCase() and the whole cascade commits or rolls back together.
import { AsyncLocalStorage } from 'node:async_hooks';
import pg from 'pg';

// NUMERIC (money) and BIGINT (counts, sizes) arrive as strings by default.
pg.types.setTypeParser(1700, (value) => parseFloat(value));
pg.types.setTypeParser(20, (value) => Number(value));

type Queryable = pg.Pool | pg.PoolClient;

const globalForDb = globalThis as unknown as { crmyePool?: pg.Pool };
type TxContext = { client: pg.PoolClient; afterCommit: (() => void)[] };
const txStorage = new AsyncLocalStorage<TxContext>();

export function databaseUrl() {
  return process.env.DATABASE_URL || '';
}

export function hasDatabaseConfig() {
  return Boolean(databaseUrl());
}

function pool(): pg.Pool {
  if (!globalForDb.crmyePool) {
    const connectionString = databaseUrl();
    if (!connectionString) {
      throw new Error('DATABASE_URL is not set — CRM_YE needs a PostgreSQL database (see DEPLOY.md).');
    }
    globalForDb.crmyePool = new pg.Pool({
      connectionString,
      max: Number(process.env.DATABASE_POOL_MAX || 10),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
    globalForDb.crmyePool.on('error', (error) => {
      console.error('[CRM_YE DB] idle client error', error.message);
    });
  }
  return globalForDb.crmyePool;
}

function current(): Queryable {
  return txStorage.getStore()?.client ?? pool();
}

/** Run a parameterised query and return its rows. */
export async function sql<T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, params: unknown[] = []) {
  const result = await current().query<T>(text, params);
  return result.rows;
}

/** First row or undefined. */
export async function sqlOne<T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, params: unknown[] = []) {
  const rows = await sql<T>(text, params);
  return rows[0];
}

/** Rows affected by an UPDATE / DELETE. */
export async function sqlCount(text: string, params: unknown[] = []) {
  const result = await current().query(text, params);
  return result.rowCount ?? 0;
}

/**
 * Run `fn` in a transaction. Nested calls join the outer transaction, so a
 * helper that opens its own transaction is safe to call from inside another.
 */
export async function transaction<T>(fn: () => Promise<T>): Promise<T> {
  if (txStorage.getStore()) return fn();
  const client = await pool().connect();
  const context: TxContext = { client, afterCommit: [] };
  let result: T;
  try {
    await client.query('BEGIN');
    result = await txStorage.run(context, fn);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
  for (const hook of context.afterCommit) {
    try {
      hook();
    } catch (error) {
      console.error('[CRM_YE DB] after-commit hook failed', String(error));
    }
  }
  return result;
}

/**
 * Defer a side effect (e.g. deleting a file from disk) until the surrounding
 * transaction commits, so a rollback never leaves rows pointing at missing
 * files. Outside a transaction it runs immediately.
 */
export function afterCommit(hook: () => void) {
  const context = txStorage.getStore();
  if (context) context.afterCommit.push(hook);
  else hook();
}

/** Cheap liveness probe for /api/health. */
export async function pingDatabase() {
  await pool().query('SELECT 1');
}

// ── Row-mapping helpers ──────────────────────────────────────────────────────
// The domain model uses optional fields (absent, not null) and ISO strings.

/** NULL → undefined, so mapped records match the domain's optional fields. */
export function opt<T>(value: T | null | undefined): T | undefined {
  return value === null || value === undefined ? undefined : value;
}

/** timestamptz → ISO string. */
export function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

/** Nullable timestamptz → ISO string or undefined. */
export function isoOpt(value: Date | string | null | undefined): string | undefined {
  return value === null || value === undefined ? undefined : iso(value);
}

/** Domain optional → SQL parameter (undefined and '' become NULL). */
export function nul<T>(value: T | undefined | null | ''): T | null {
  return value === undefined || value === null || value === '' ? null : value;
}
