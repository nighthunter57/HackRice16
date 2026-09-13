import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { tigerPoolConfig } from '../src/lib/integrations/tiger-config';

async function migrate(): Promise<void> {
  const config = tigerPoolConfig();
  if (!config) throw new Error('Set TIGER_DATABASE_URL or DATABASE_URL before running migrations.');
  const sql = (await Promise.all(['schema.sql','aggregates.sql','auth.sql'].map(file=>readFile(resolve(process.cwd(),'database',file),'utf8')))).join('\n');
  const pool = new Pool({ ...config, max: 1, statement_timeout: 60_000 });
  try {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(74290113)');
      await client.query(sql);
      await client.query('COMMIT');
      console.log('Financial history migration completed.');
    } catch {
      await client.query('ROLLBACK');
      throw new Error('Migration failed. Verify database permissions and TimescaleDB >= 2.13.');
    } finally { client.release(); }
  } finally { await pool.end(); }
}
void migrate().catch(() => {
  console.error('Financial history migration failed. Check database configuration, connectivity, and TimescaleDB permissions.');
  process.exitCode = 1;
});
