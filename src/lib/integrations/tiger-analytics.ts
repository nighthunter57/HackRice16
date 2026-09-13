/** Server-side financial history features. No Safe Date calculation lives here. */
import { z } from 'zod';
import { addDays } from '../finance/dates';
import { centsSchema, utcDateSchema } from './http';
import { runTiger, type TigerOptions } from './tiger';
import { financialStateSchema } from '../../types/financial-state-schema';

const amount = z.string().regex(/^-?\d+$/).transform(Number).pipe(centsSchema);
const count = z.string().regex(/^\d+$/).transform(Number).pipe(centsSchema.nonnegative());
export const financialEventSchema = z.object({
  eventId:z.string().min(1).max(200),userId:z.string().min(1).max(200),time:z.string().datetime(),
  accountId:z.string().max(200).nullable(),amountCents:centsSchema,category:z.string().max(100).nullable(),
  merchant:z.string().max(200).nullable(),eventType:z.enum(['transaction','bill','income','purchase','subscription','refund','transfer','unexpected_expense','discretionary']),
  metadata:z.record(z.string(),z.unknown()).default({}),
}).strict();
export type FinancialEvent = z.infer<typeof financialEventSchema>;
const eventRow = z.object({event_id:z.string(),user_id:z.string(),time:z.string().datetime(),account_id:z.string().nullable(),amount_cents:amount,category:z.string().nullable(),merchant:z.string().nullable(),event_type:financialEventSchema.shape.eventType,metadata:z.record(z.string(),z.unknown()).nullable()});
const eventColumns = `event_id,user_id,to_char(time AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS time,account_id,amount_cents::text,category,merchant,event_type,metadata`;
function bounds(userId:string,days:number,asOf:string) {
  z.string().min(1).max(200).parse(userId);z.number().int().min(1).max(365).parse(days);utcDateSchema.parse(asOf);
  return [userId,addDays(asOf,-days),asOf];
}
const today = () => new Date().toISOString().slice(0,10);
/** Population standard deviation of daily ordinary spend, rounded to integer cents. */
export async function getSpendingVolatility(userId:string,asOf=today(),options:TigerOptions={}) {
  const parameters=bounds(userId,30,asOf);
  return runTiger({...options,userId},async db=>{
    const result=await db.query(`WITH daily AS (
      SELECT d.day,COALESCE(sum(s.forecast_spent_cents),0) AS spending
      FROM generate_series($2::date::timestamp,($3::date-1)::timestamp,INTERVAL '1 day') d(day)
      LEFT JOIN daily_spending s ON s.user_id=$1 AND s.day=d.day AT TIME ZONE 'UTC' GROUP BY d.day)
      SELECT round(COALESCE(stddev_pop(spending),0))::text AS volatility_cents FROM daily`,parameters);
    return z.array(z.object({volatility_cents:amount.pipe(centsSchema.nonnegative())})).length(1).parse(result.rows)[0].volatility_cents;
  });
}
export async function getCategoryForecastHistory(userId:string,asOf:string,options:TigerOptions={}) {
  const parameters=bounds(userId,30,asOf);
  return runTiger({...options,userId},async db=>{
    const rows=(await db.query(`SELECT to_char(day AT TIME ZONE 'UTC','YYYY-MM-DD') AS day,category,forecast_spent_cents::text AS spent_cents
      FROM daily_spending WHERE user_id=$1 AND day >= ($2::date::timestamp AT TIME ZONE 'UTC') AND day < ($3::date::timestamp AT TIME ZONE 'UTC') ORDER BY day,category`,parameters)).rows;
    return z.array(z.object({day:utcDateSchema,category:z.string().nullable(),spent_cents:amount.pipe(centsSchema.nonnegative())})).parse(rows);
  });
}
export async function readSnapshotById(id:string,options:TigerOptions={}) {
  z.string().uuid().parse(id);
  return runTiger(options,async(db,userId)=>{
    const row=(await db.query('SELECT state FROM financial_snapshots WHERE user_id=$1 AND id=$2',[userId,id])).rows[0];
    if (!row) return null;
    const state = z.object({state:financialStateSchema}).parse(row).state;
    if (state.userId !== userId) throw new Error('Snapshot user mismatch');
    return state;
  });
}
function mapEvents(rows:unknown[]):FinancialEvent[] {
  return z.array(eventRow).parse(rows).map(row=>({eventId:row.event_id,userId:row.user_id,time:row.time,accountId:row.account_id,amountCents:row.amount_cents,category:row.category,merchant:row.merchant,eventType:row.event_type,metadata:row.metadata??{}}));
}
export async function getRecentFinancialEvents(userId:string,days=30,asOf=today(),options:TigerOptions={}) {
  const parameters=bounds(userId,days,asOf);
  return runTiger({...options,userId},async db=>mapEvents((await db.query(`SELECT ${eventColumns} FROM financial_events WHERE user_id=$1 AND time >= ($2::date::timestamp AT TIME ZONE 'UTC') AND time < ($3::date::timestamp AT TIME ZONE 'UTC') ORDER BY time DESC,event_id LIMIT 500`,parameters)).rows));
}
export async function getDailySpending(userId:string,days=30,asOf=today(),options:TigerOptions={}) {
  const parameters=bounds(userId,days,asOf);
  return runTiger({...options,userId},async db=>{
    const rows=(await db.query(`WITH totals AS (SELECT day,sum(spent_cents) AS spent_cents,sum(event_count) AS event_count FROM daily_spending WHERE user_id=$1 AND day >= ($2::date::timestamp AT TIME ZONE 'UTC') AND day < ($3::date::timestamp AT TIME ZONE 'UTC') GROUP BY day)
      SELECT to_char(d.day,'YYYY-MM-DD') AS day,COALESCE(t.spent_cents,0)::text AS spent_cents,COALESCE(t.event_count,0)::text AS event_count
      FROM generate_series($2::date::timestamp,($3::date-1)::timestamp,INTERVAL '1 day') d(day)
      LEFT JOIN totals t ON t.day=d.day AT TIME ZONE 'UTC' ORDER BY d.day`,parameters)).rows;
    return z.array(z.object({day:utcDateSchema,spent_cents:amount,event_count:count})).parse(rows).map(row=>({day:row.day,spentCents:row.spent_cents,eventCount:row.event_count}));
  });
}
export async function getSpendingByCategory(userId:string,days=30,asOf=today(),options:TigerOptions={}) {
  const parameters=bounds(userId,days,asOf);
  return runTiger({...options,userId},async db=>{
    const rows=(await db.query(`SELECT category,sum(spent_cents)::text AS spent_cents FROM daily_spending WHERE user_id=$1 AND day >= ($2::date::timestamp AT TIME ZONE 'UTC') AND day < ($3::date::timestamp AT TIME ZONE 'UTC') GROUP BY category ORDER BY sum(spent_cents) DESC,category`,parameters)).rows;
    return z.array(z.object({category:z.string().nullable(),spent_cents:amount})).parse(rows).map(row=>({category:row.category??'other',spentCents:row.spent_cents}));
  });
}
export async function getRecentCashFlow(userId:string,days=30,asOf=today(),options:TigerOptions={}) {
  const parameters=bounds(userId,days,asOf);
  return runTiger({...options,userId},async db=>{
    const rows=(await db.query(`SELECT to_char(day AT TIME ZONE 'UTC','YYYY-MM-DD') AS day,total_inflow_cents::text,total_outflow_cents::text,net_cash_flow_cents::text FROM daily_cash_flow WHERE user_id=$1 AND day >= ($2::date::timestamp AT TIME ZONE 'UTC') AND day < ($3::date::timestamp AT TIME ZONE 'UTC') ORDER BY day`,parameters)).rows;
    return z.array(z.object({day:utcDateSchema,total_inflow_cents:amount,total_outflow_cents:amount,net_cash_flow_cents:amount})).parse(rows).map(row=>({day:row.day,incomeCents:row.total_inflow_cents,outflowCents:row.total_outflow_cents,netCashFlowCents:row.net_cash_flow_cents}));
  });
}
export async function getDayOfWeekAverages(userId:string,asOf=today(),options:TigerOptions={}) {
  const parameters=bounds(userId,30,asOf);
  return runTiger({...options,userId},async db=>{
    const rows=(await db.query(`WITH daily AS (
      SELECT d.day,COALESCE(sum(s.forecast_spent_cents),0) AS spending
      FROM generate_series($2::date::timestamp,($3::date-1)::timestamp,INTERVAL '1 day') d(day)
      LEFT JOIN daily_spending s ON s.user_id=$1 AND s.day=d.day AT TIME ZONE 'UTC' GROUP BY d.day)
      SELECT extract(isodow FROM day)::int AS weekday,round(avg(spending))::text AS average_cents,count(*)::text AS sample_days
      FROM daily GROUP BY extract(isodow FROM day) ORDER BY weekday`,parameters)).rows;
    return z.array(z.object({weekday:z.number().int().min(1).max(7),average_cents:amount,sample_days:count})).parse(rows).map(row=>({weekday:row.weekday,averageCents:row.average_cents,sampleDays:row.sample_days}));
  });
}
export async function getForecastInputs(userId:string,asOf=today(),options:TigerOptions={}) {
  const parameters=bounds(userId,30,asOf);
  return runTiger({...options,userId},async db=>{
    const rows=(await db.query(`SELECT COALESCE(sum(forecast_spent_cents),0)::text AS rolling_30_cents,
      COALESCE(sum(forecast_spent_cents) FILTER (WHERE day >= (($3::date-7)::timestamp AT TIME ZONE 'UTC')),0)::text AS rolling_7_cents,
      round(COALESCE(sum(forecast_spent_cents),0)/30)::text AS average_daily_cents
      FROM daily_spending WHERE user_id=$1 AND day >= ($2::date::timestamp AT TIME ZONE 'UTC') AND day < ($3::date::timestamp AT TIME ZONE 'UTC')`,parameters)).rows;
    const row=z.array(z.object({rolling_30_cents:amount,rolling_7_cents:amount,average_daily_cents:amount})).length(1).parse(rows)[0];
    return {rolling30Cents:row.rolling_30_cents,rolling7Cents:row.rolling_7_cents,averageDailyCents:row.average_daily_cents};
  });
}
export async function insertFinancialEvent(event:FinancialEvent,options:TigerOptions={}) {
  const parsed=financialEventSchema.parse(event);
  if(options.userId && options.userId!==parsed.userId) throw new Error('User mismatch');
  return runTiger({...options,userId:parsed.userId},async db=>{
    const result=await db.query(`INSERT INTO financial_events(time,event_id,user_id,account_id,amount_cents,category,merchant,event_type,metadata)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb) ON CONFLICT(user_id,event_id,time) DO NOTHING`,
      [parsed.time,parsed.eventId,parsed.userId,parsed.accountId,parsed.amountCents,parsed.category,parsed.merchant,parsed.eventType,JSON.stringify(parsed.metadata)]);
    const start=parsed.time.slice(0,10);const end=addDays(start,1);
    for(const name of ['daily_spending','daily_cash_flow']) await db.query(`CALL refresh_continuous_aggregate('${name}',$1::timestamptz,$2::timestamptz)`,[`${start}T00:00:00Z`,`${end}T00:00:00Z`]);
    return {inserted:result.rowCount===1};
  });
}
export async function getUnexpectedExpenses(userId:string,days=7,asOf=today(),options:TigerOptions={}) {
  const parameters=bounds(userId,days,asOf);
  return runTiger({...options,userId},async db=>mapEvents((await db.query(`SELECT ${eventColumns} FROM financial_events WHERE user_id=$1 AND time >= ($2::date::timestamp AT TIME ZONE 'UTC') AND time < ($3::date::timestamp AT TIME ZONE 'UTC') AND amount_cents<0 AND event_type='unexpected_expense' ORDER BY time,event_id`,parameters)).rows));
}
/** Baselines are supplied by the prior app forecast, never reconstructed by an LLM. */
export async function compareSpendingToExpectation(userId:string,asOf:string,expected:Record<string,number>,options:TigerOptions={}) {
  z.record(z.string(),centsSchema.nonnegative()).parse(expected);
  const result=await getSpendingByCategory(userId,1,asOf,options);
  if(result.mode!=='live') return result;
  return {mode:'live' as const,data:result.data.map(row=>({category:row.category,actualCents:row.spentCents,expectedCents:expected[row.category]??null,aboveBaselineCents:expected[row.category]===undefined?null:Math.max(0,row.spentCents-expected[row.category])}))};
}
