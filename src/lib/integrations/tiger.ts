import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { z } from 'zod';
import type { FinancialState, Transaction } from '../../types/finance';
import { validateState } from '../finance/validation';
import { addDays } from '../finance/dates';
import { centsSchema, utcDateSchema } from './http';
import { tigerPoolConfig } from './tiger-config';

/** Injectable query boundary; pg rows are validated before leaving this module. */
export interface Queryable { query(text: string, values?: unknown[]): Promise<{ rows: unknown[]; rowCount?: number | null }> }
export interface TigerOptions { db?: Queryable; userId?: string }
export type TigerResult<T> = { mode: 'live'; data: T } | { mode: 'unavailable'; data: null; reason: string };
const textSchema = z.string().trim().min(1).max(300);
const recurrence = z.enum(['once', 'weekly', 'biweekly', 'monthly']);
const timestampSchema = z.string().datetime();
export const transactionSchema = z.object({ id: textSchema, userId: textSchema, accountId: textSchema, timestamp: timestampSchema, amountCents: centsSchema, category: textSchema, merchant: textSchema, eventType: z.enum(['discretionary', 'income', 'bill', 'transfer']) });
const stateSchema = z.object({
  userId: textSchema, startDate: utcDateSchema, horizonDays: z.number().int().min(1).max(366), safetyBufferCents: centsSchema.nonnegative(),
  accounts: z.array(z.object({ id: textSchema, userId: textSchema, name: textSchema, type: z.enum(['checking', 'savings']), balanceCents: centsSchema })),
  transactions: z.array(transactionSchema),
  bills: z.array(z.object({ id: textSchema, userId: textSchema, name: textSchema, amountCents: centsSchema.nonnegative(), dueDate: utcDateSchema, recurrence, mandatory: z.boolean().optional() })),
  incomeEvents: z.array(z.object({ id: textSchema, userId: textSchema, accountId:textSchema.optional(), name: textSchema.optional(), amountCents: centsSchema.nonnegative(), expectedDate: utcDateSchema, recurrence: recurrence.optional() })),
  goals: z.array(z.object({ id: textSchema, userId: textSchema, name: textSchema, targetCents: centsSchema.nonnegative(), savedCents: centsSchema.nonnegative(), deadline: utcDateSchema.optional(), maxDelayDays: z.number().int().nonnegative().optional() })),
});
export const decisionRecordSchema = z.object({
  productName: textSchema, priceCents: centsSchema.nonnegative(),
  verdict: z.enum(['SAFE', 'CAUTION', 'NOT_RECOMMENDED']),
  safeDate: utcDateSchema.nullable(),
  action: z.enum(['buy', 'wait', 'skip', 'consider']),
  source: z.enum(['nessie', 'demo']),
}).strict();
export type DecisionRecord = z.infer<typeof decisionRecordSchema>;
export interface DailySpending { date: string; spendingCents: number }
let pool: Pool | undefined;
function database(options: TigerOptions): Queryable | undefined {
  if (options.db) return options.db;
  const config = tigerPoolConfig();
  if (!config) return undefined;
  pool ??= new Pool(config);
  return pool;
}
function user(options: TigerOptions): string { return textSchema.parse(options.userId ?? process.env.NESSIE_CUSTOMER_ID ?? 'demo-user'); }
export async function runTiger<T>(options: TigerOptions, action: (db: Queryable, userId: string) => Promise<T>): Promise<TigerResult<T>> {
  try {
  const db = database(options);
  if (!db) return { mode: 'unavailable', data: null, reason: 'Tiger database is not configured; no data was read or saved.' };
  return { mode: 'live', data: await action(db, user(options)) };
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : null;
    const reason = code === '28P01' ? 'Tiger rejected the database credentials. Update the server connection string.'
      : ['SELF_SIGNED_CERT_IN_CHAIN','UNABLE_TO_VERIFY_LEAF_SIGNATURE','CERT_HAS_EXPIRED'].includes(String(code))
        ? 'Tiger certificate verification failed. Configure a trusted certificate chain.'
        : 'Tiger operation failed. Check connectivity, migrations, and input validation; a write may already have persisted.';
    return { mode: 'unavailable', data: null, reason };
  }
}
const run = runTiger;
export async function closeTigerPool(): Promise<void> { if (pool) { await pool.end(); pool = undefined; } }

export async function insertFinancialEvents(events: Transaction[], options: TigerOptions = {}): Promise<TigerResult<{ insertedOrUpdated: number }>> {
  const parsed = z.array(transactionSchema).max(10_000).parse(events);
  return run(options, async (db, userId) => {
    if (parsed.some(event => event.userId !== userId)) throw new Error('User mismatch');
    if (!parsed.length) return { insertedOrUpdated: 0 };
    const unique = new Map(parsed.map(event => [`${event.id}\u0000${event.timestamp}`, event]));
    const result = await db.query(`INSERT INTO financial_events
      (time, user_id, event_id, amount_cents, category, merchant, event_type, account_id)
      SELECT x."timestamp"::timestamptz, $1, x.id, x."amountCents", x.category, x.merchant, x."eventType", x."accountId"
      FROM jsonb_to_recordset($2::jsonb) AS x("timestamp" text, id text, "amountCents" bigint, category text, merchant text, "eventType" text, "accountId" text)
      ON CONFLICT (user_id, event_id, time) DO UPDATE SET
        amount_cents = EXCLUDED.amount_cents, category = EXCLUDED.category,
        merchant = EXCLUDED.merchant, event_type = EXCLUDED.event_type, account_id = EXCLUDED.account_id`,
    [userId, JSON.stringify([...unique.values()])]);
    // Real-time aggregates do not repair older materialized buckets after backfills.
    // Refresh the ingested date range after the insert commits so reads see corrections.
    const dates = parsed.map(event => event.timestamp.slice(0, 10)).sort();
    await db.query("CALL refresh_continuous_aggregate('daily_spending', $1::timestamptz, $2::timestamptz)", [`${dates[0]}T00:00:00Z`, `${addDays(dates[dates.length - 1], 1)}T00:00:00Z`]);
    await db.query("CALL refresh_continuous_aggregate('daily_cash_flow', $1::timestamptz, $2::timestamptz)", [`${dates[0]}T00:00:00Z`, `${addDays(dates[dates.length - 1], 1)}T00:00:00Z`]);
    return { insertedOrUpdated: result.rowCount ?? unique.size };
  });
}

/** Inclusive UTC date range; absent days are zero, not dropped from the average. */
export async function readDailySpending(startDate: string, endDate: string, options: TigerOptions = {}): Promise<TigerResult<DailySpending[]>> {
  utcDateSchema.parse(startDate); utcDateSchema.parse(endDate);
  const span = (Date.parse(endDate) - Date.parse(startDate)) / 86_400_000;
  if (span < 0 || span > 365) throw new RangeError('Daily spending range must cover 1–366 days.');
  return run(options, async (db, userId) => {
    const result = await db.query(`SELECT to_char(days.day, 'YYYY-MM-DD') AS date,
      COALESCE(spending.spending_cents, 0)::text AS spending_cents
      FROM generate_series($2::date::timestamp, $3::date::timestamp, INTERVAL '1 day') AS days(day)
      LEFT JOIN (SELECT day, user_id, sum(forecast_spent_cents) AS spending_cents
        FROM daily_spending WHERE user_id=$1 GROUP BY day,user_id) spending ON spending.user_id = $1
        AND spending.day = days.day AT TIME ZONE 'UTC'
      ORDER BY days.day`, [userId, startDate, endDate]);
    const rows = z.array(z.object({ date: utcDateSchema, spending_cents: z.string().regex(/^\d+$/).transform(Number).pipe(centsSchema.nonnegative()) })).parse(result.rows);
    if (rows.length !== span + 1 || rows.some((row, index) => row.date !== addDays(startDate, index))) throw new Error('Incomplete daily series');
    return rows.map(row => ({ date: row.date, spendingCents: row.spending_cents }));
  });
}

export async function saveSnapshot(state: FinancialState, source: 'nessie' | 'demo', options: TigerOptions = {}): Promise<TigerResult<{ id: string }>> {
  const parsed = stateSchema.parse(state); validateState(parsed); z.enum(['nessie', 'demo']).parse(source);
  return run(options, async (db, userId) => {
    if (parsed.userId !== userId) throw new Error('User mismatch');
    const id = randomUUID();
    await db.query('INSERT INTO financial_snapshots (id, user_id, source, state) VALUES ($1, $2, $3, $4::jsonb)', [id, userId, source, JSON.stringify(parsed)]);
    return { id };
  });
}
export async function readSnapshots(limit = 10, options: TigerOptions = {}): Promise<TigerResult<{ id: string; createdAt: string; source: 'nessie' | 'demo'; state: FinancialState }[]>> {
  z.number().int().min(1).max(100).parse(limit);
  return run(options, async (db, userId) => {
    const result = await db.query("SELECT id, to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') AS created_at, source, state FROM financial_snapshots WHERE user_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2", [userId, limit]);
    const rows = z.array(z.object({ id: z.string().uuid(), created_at: timestampSchema, source: z.enum(['nessie', 'demo']), state: stateSchema })).parse(result.rows);
    return rows.map(row => { validateState(row.state); if (row.state.userId !== userId) throw new Error('User mismatch'); return { id: row.id, createdAt: row.created_at, source: row.source, state: row.state }; });
  });
}
export async function saveDecision(decision: DecisionRecord, options: TigerOptions = {}): Promise<TigerResult<{ id: string }>> {
  const parsed = decisionRecordSchema.parse(decision);
  return run(options, async (db, userId) => {
    const id = randomUUID();
    await db.query('INSERT INTO purchase_decisions (id, user_id, decision) VALUES ($1, $2, $3::jsonb)', [id, userId, JSON.stringify(parsed)]);
    return { id };
  });
}
export async function readDecisions(limit = 10, options: TigerOptions = {}): Promise<TigerResult<{ id: string; createdAt: string; decision: DecisionRecord }[]>> {
  z.number().int().min(1).max(100).parse(limit);
  return run(options, async (db, userId) => {
    const result = await db.query("SELECT id, to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') AS created_at, decision FROM purchase_decisions WHERE user_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2", [userId, limit]);
    return z.array(z.object({ id: z.string().uuid(), created_at: timestampSchema, decision: decisionRecordSchema })).parse(result.rows).map(row => ({ id: row.id, createdAt: row.created_at, decision: row.decision }));
  });
}
