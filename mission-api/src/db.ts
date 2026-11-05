import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

export type Pool = pg.Pool;

function migrationsDir(): string {
  const candidates = [process.env.MIGRATIONS_DIR, fileURLToPath(new URL('../migrations/', import.meta.url))].filter(Boolean) as string[];
  const dir = candidates.find((d) => existsSync(d));
  if (!dir) throw new Error(`migrations directory not found (tried ${candidates.join(', ')})`);
  return dir;
}

/** Create the node's database when it does not exist yet (local development: one Postgres, a database per node). */
async function ensureDatabase(url: string): Promise<void> {
  const u = new URL(url);
  const name = decodeURIComponent(u.pathname.replace(/^\//, ''));
  if (!/^[a-z_][a-z0-9_]*$/i.test(name)) throw new Error(`refusing to create database with unusual name "${name}"`);
  const admin = new URL(url);
  admin.pathname = '/postgres';
  const c = new pg.Client({ connectionString: admin.toString() });
  await c.connect();
  try {
    const r = await c.query('select 1 from pg_database where datname = $1', [name]);
    if (!r.rowCount) await c.query(`create database "${name}"`);
  } finally {
    await c.end();
  }
}

export async function openPool(url: string, create: boolean): Promise<Pool> {
  const pool = new pg.Pool({ connectionString: url, max: 5 });
  try {
    await pool.query('select 1');
  } catch (e) {
    if ((e as { code?: string }).code === '3D000' && create) {
      await pool.end();
      await ensureDatabase(url);
      return openPool(url, false);
    }
    throw e;
  }
  return pool;
}

export async function migrate(pool: Pool): Promise<string[]> {
  await pool.query('create table if not exists schema_migration (id text primary key, applied_at timestamptz not null default now())');
  const dir = migrationsDir();
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const applied = new Set((await pool.query<{ id: string }>('select id from schema_migration')).rows.map((r) => r.id));
  const ran: string[] = [];
  for (const f of files) {
    if (applied.has(f)) continue;
    const sql = readFileSync(join(dir, f), 'utf8');
    const c = await pool.connect();
    try {
      await c.query('begin');
      await c.query(sql);
      await c.query('insert into schema_migration (id) values ($1)', [f]);
      await c.query('commit');
      ran.push(f);
    } catch (e) {
      await c.query('rollback');
      throw e;
    } finally {
      c.release();
    }
  }
  return ran;
}
