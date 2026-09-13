# CanIBuyIt? time-series layer

Development service: `osjcwofoat` (`db-15045`, us-west-2), database `tsdb`, role `tsdbadmin`, TimescaleDB 2.30.0. Before setup, public contained only an empty, unindexed `financial_events` table; no hypertables or continuous aggregates existed. The MCP write test was created, verified and removed successfully. No unrelated data was changed.

## Recreate

Set the server-only `DATABASE_URL` in `.env.local` using the service's verified TLS configuration. `TIGER_DATABASE_URL` is a legacy fallback. Never put either variable behind a `NEXT_PUBLIC_` prefix. The application uses the existing `pg` adapter; no ORM is needed.

With the environment variable exported in your shell:

```sh
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f database/schema.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f database/aggregates.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f database/seed.sql
```

Alternatively `npm run db:migrate` loads `.env.local` and applies schema + aggregates; seeding is explicit. Run seed refresh CALLs separately when using MCP, outside an explicit transaction. Review existing object definitions first: `IF NOT EXISTS` preserves objects, it does not upgrade incompatible schemas. The legacy `db/001_financial_history.sql` is a psql include entrypoint for these same definitions.

## Storage and indexes

`financial_events` stores signed BIGINT cents and UTC timestamps, with 7-day hypertable chunks. Types remain text: transaction, bill, income, purchase, subscription, refund, transfer, unexpected_expense; `discretionary` is supported for existing normalized application events. Classify mandatory bills separately so forecasting does not double-count them. Metadata holds provenance, not calculated financial truth.

| Index | Purpose |
| --- | --- |
| user_id, event_id, time (unique) | Idempotent ingestion with a hypertable-compatible identity |
| user_id, time DESC | User history and time windows |
| user_id, category, time DESC | Category investigations |
| user_id, event_type, time DESC | Unexpected-expense investigations |
| account_id, time DESC | Account reconciliation; queries must still scope the user |
| time DESC (Timescale-created) | Time-range access and chunk operations |

`financial_snapshots` and `purchase_decisions` support the application's existing persistence functions. They each have a user/time index. No Safe Date calculation runs in SQL.

## Continuous aggregates

`daily_spending` groups by UTC day, user and category: positive `spent_cents` and `event_count` include negative non-transfer events only. Positive income/refunds are not spending. Additional `forecast_spent_cents` includes ordinary transaction/purchase/discretionary spending, excluding explicitly scheduled bills, subscriptions and shocks. Refunds are reported as inflows rather than netted against gross spending.

`daily_cash_flow` returns inflows, outflows and net cents, including transfers. Paired transfers between a user's accounts cancel in net cash flow but inflate gross flows; do not treat gross inflows as earned income. An unpaired opening transfer in the demo establishes initial funds.

Both aggregates refresh hourly over the last 90 days, ending one hour before now, with real-time reads enabled. Ingestion explicitly refreshes affected whole UTC days after writes to repair backfilled materialized buckets. A refresh failure is reported even if the insert already persisted; retries are safe by event identity.

## Deterministic demo

The runtime seed contains 136 events spanning 2026-07-14 through 2026-09-11. Use **asOf = 2026-09-12**. `npm run demo:seed-sql` generates the SQL from `src/data/banking-demo.ts`. Existing v1 event IDs are retained; reruns update only matching demo events without duplicating them or deleting unrelated rows.

The checking ledger reconciles to **185,000 cents**. Ordinary spending over the last 30 days is **97,218 cents**. Emergency savings ($2,100), Japan savings ($1,900), upcoming obligations and weekly payroll are normalized provider state. Both providers use `insertFinancialEvents` before querying the continuous aggregates. `getForecastInputs`, `getDayOfWeekAverages` and `getSpendingVolatility` expose zero-filled daily features with integer-cent rounded results; only application code calculates financial futures.

The seed contains no repair. To inject the demo shock deliberately, use `insertFinancialEvent` or execute:

```sql
INSERT INTO public.financial_events
 (time,event_id,user_id,account_id,amount_cents,category,merchant,event_type,metadata)
VALUES ('2026-09-20 00:00:00+00','demo-repair','demo-user','checking',-43000,
 'transportation','Auto Repair','unexpected_expense','{"source":"canibuyit-demo"}')
ON CONFLICT(user_id,event_id,time) DO NOTHING;
CALL refresh_continuous_aggregate('public.daily_spending',TIMESTAMPTZ '2026-09-20 00:00+00',TIMESTAMPTZ '2026-09-21 00:00+00');
CALL refresh_continuous_aggregate('public.daily_cash_flow',TIMESTAMPTZ '2026-09-20 00:00+00',TIMESTAMPTZ '2026-09-21 00:00+00');
```

This date matches the app's demo shock. It is a future scenario event relative to the pinned starting date, not historical spending. The existing repair UI runs the deterministic simulation and records this event; executing SQL alone does not push updates to a browser or invent a new Safe Date. Re-query financial state and rerun the engine to reflect changes. No automatic deletion/reset is provided.

## Application queries

Server functions live in `src/lib/integrations/tiger-analytics.ts`, reuse the existing pool, parameterize user inputs, validate database rows, and return `{mode:'live',data}` or an explicit unavailable result. BIGINT/numeric strings are validated as safe integer cents before conversion. Date windows include their start and exclude `asOf` (completed UTC days).

| Function | Returned feature |
| --- | --- |
| getRecentFinancialEvents(userId, days, asOf) | Latest 500 events within the window |
| getDailySpending(userId, days, asOf) | Zero-filled daily spending and counts; sum for 7/30-day totals |
| getSpendingByCategory(userId, days, asOf) | Gross outgoing spending by category |
| getDayOfWeekAverages(userId, asOf) | Ordinary spend, Monday=1 through Sunday=7, rounded cents and sample days |
| getRecentCashFlow(userId, days, asOf) | Daily inflow, outflow and net |
| getForecastInputs(userId, asOf) | Ordinary 7/30-day totals and rounded daily average |
| insertFinancialEvent(event) | Validated, idempotent insertion and both aggregate refreshes |
| getUnexpectedExpenses(userId, days, asOf) | Negative unexpected events with merchant/provenance |
| compareSpendingToExpectation(userId, asOf, expectedByCategory) | Previous day's actual vs supplied prior forecast, in cents |

Zero days count in averages. Unknown category expectations return null instead of a fabricated baseline. The application must retain prior expectations/snapshots and compare matching windows; shocks and category excess can overlap and must not be added twice. Changes explain observed differences, not an unsupported claim that a particular expense mathematically caused an exact date shift.

The existing `readDailySpending` feeds category-summed ordinary spending into the deterministic engine. Demo mode reads SQL seed history without ingesting a second copy of the lightweight offline fixture. If no history is present or Tiger fails, the local history remains available.

Nessie → normalized events → Tiger hypertable → time-series aggregates → deterministic forecast → FutureMe → Safe Date optimizer.

See [actual MCP queries and results](VERIFICATION.md) for count, latest 10 events, 7/30-day totals, category totals, daily history, weekday averages, cash-flow reconciliation and Timescale objects. Those SQL queries can be rerun directly; no financial values were produced by an LLM.

## Current connection limitation

Cloud setup and MCP verification are complete. The local Node PostgreSQL connection currently reports `SELF_SIGNED_CERT_IN_CHAIN`; using the OS CA store did not resolve it. A trusted certificate chain must be configured before the app can use live analytics. Keep TLS verification enabled; the existing demo fallback continues to work. See VERIFICATION.md for the separate cloud and application check results.

## Authentication tables

`npm run db:migrate` also applies the additive `auth.sql` migration. Users, rotating hashed refresh sessions, one-time hashed resets, exclusive sponsor mappings, preferences, rate counters, and resumable account-deletion records are separate from financial analytics. Application user UUIDs are stored in the existing financial tables' `user_id` text columns. Legacy demo rows remain unchanged. See [authentication setup and verification](../docs/authentication.md).
