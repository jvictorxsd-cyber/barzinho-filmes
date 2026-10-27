import { mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { existsSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import postgres from 'postgres';

export interface QueryExecutor {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
}

export interface DB extends QueryExecutor {
  transaction<T>(operation: (tx: QueryExecutor) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export type Database = DB;

export interface DatabaseOptions {
  url?: string;
  /** Use ':memory:' for isolated tests. Never use in production. */
  dataDir?: string;
}

const migrations = ['001_initial.sql', '002_account_tokens.sql', '003_private_api_tables.sql'];

async function migrationSource(name:string) {
  const roots = [process.env.DB_MIGRATIONS_DIR,
    resolve(dirname(fileURLToPath(import.meta.url)), '../migrations'),
    resolve(process.cwd(), 'packages/db/migrations'),
    resolve(process.cwd(), '../../packages/db/migrations')].filter((root):root is string=>Boolean(root));
  const path = roots.map(root=>resolve(root,name)).find(path=>existsSync(path));
  if(!path) throw new Error(`Migração ausente no pacote de execução: ${name}`);
  return readFile(path,'utf8');
}

async function migrate(db: QueryExecutor, executeBatch: (sql: string) => Promise<void>): Promise<void> {
  await db.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now()
  )`);
  for (const name of migrations) {
    const applied = await db.query('SELECT name FROM schema_migrations WHERE name = $1', [name]);
    if (applied.length) continue;
    const source = await migrationSource(name);
    await executeBatch(source);
    await db.query('INSERT INTO schema_migrations(name) VALUES ($1)', [name]);
  }
}

export async function createDb(options: DatabaseOptions = {}): Promise<DB> {
  // An explicit test/local directory must never accidentally target an injected production URL.
  const url = options.url ?? (options.dataDir === undefined ? process.env.DATABASE_URL || process.env.POSTGRES_URL : undefined);
  if (url) {
    const sql = postgres(url, {
      max: process.env.VERCEL ? 3 : 10, prepare:false, idle_timeout:20, connect_timeout:15,
      // DB.query accepts encoded JSON strings, just like PGlite. Postgres.js otherwise
      // stringifies these strings again when PostgreSQL infers a JSON/JSONB parameter.
      types:{json:{to:114,from:[114,3802],serialize:(value:unknown)=>typeof value==='string'?value:JSON.stringify(value),parse:JSON.parse}},
    });
    const db: DB = {
      async query<T>(statement: string, params: unknown[] = []): Promise<T[]> {
        return Array.from(await sql.unsafe(statement, params as never[])) as T[];
      },
      async transaction<T>(operation: (tx: QueryExecutor) => Promise<T>): Promise<T> {
        return await sql.begin(async connection => operation({
          async query<R>(statement: string, params: unknown[] = []): Promise<R[]> {
            return Array.from(await connection.unsafe(statement, params as never[])) as R[];
          },
        })) as T;
      },
      async close() { await sql.end({ timeout: 5 }); },
    };
    try {
      await sql.begin(async connection => {
        // Serialize startup migrations across API replicas; lock releases on commit/rollback.
        await connection`SELECT pg_advisory_xact_lock(84426341)`;
        await migrate({
          async query<T>(statement: string, params: unknown[] = []): Promise<T[]> {
            return Array.from(await connection.unsafe(statement, params as never[])) as T[];
          },
        }, async statement => { await connection.unsafe(statement).simple(); });
      });
    } catch (error) {
      await db.close();
      throw error;
    }
    return db;
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('DATABASE_URL é obrigatória em produção. PGlite é destinado ao desenvolvimento local.');
  }
  const dataDir = options.dataDir ?? process.env.DATA_DIR ?? resolve(dirname(fileURLToPath(import.meta.url)), '../../../.data/barzinho');
  const memory = dataDir === ':memory:';
  if (!memory) await mkdir(resolve(dataDir), { recursive: true });
  const engine = new PGlite(memory ? undefined : resolve(dataDir));
  await engine.waitReady;
  const db: DB = {
    async query<T>(statement: string, params: unknown[] = []): Promise<T[]> {
      return (await engine.query<T>(statement, params)).rows;
    },
    async transaction<T>(operation: (tx: QueryExecutor) => Promise<T>): Promise<T> {
      return engine.transaction(async connection => operation({
        async query<R>(statement: string, params: unknown[] = []): Promise<R[]> {
          return (await connection.query<R>(statement, params)).rows;
        },
      }));
    },
    async close() { await engine.close(); },
  };
  try {
    await engine.transaction(async connection => {
      await migrate({
        async query<T>(statement: string, params: unknown[] = []): Promise<T[]> {
          return (await connection.query<T>(statement, params)).rows;
        },
      }, async statement => { await connection.exec(statement); });
    });
  } catch (error) {
    await db.close();
    throw error;
  }
  return db;
}
