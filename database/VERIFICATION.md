# Tiger MCP verification

Executed against service `osjcwofoat` on 2026-09-12. Windows are UTC, end-exclusive, pinned to the demo date.

## connection

```sql
SELECT current_database() AS database,current_user AS role,current_setting('transaction_read_only') AS read_only,(SELECT extversion FROM pg_extension WHERE extname='timescaledb') AS timescaledb;
```

| database | role | read_only | timescaledb |
| --- | --- | --- | --- |
| tsdb | tsdbadmin | off | 2.30.0 |

## seed

```sql
SELECT count(*) AS events,min(time) AS first_event,max(time) AS last_event,sum(amount_cents) AS balance_cents FROM financial_events WHERE user_id='demo-user';
```

| events | first_event | last_event | balance_cents |
| --- | --- | --- | --- |
| 69 | 2026-08-13 00:00:00+00 | 2026-09-11 18:30:00+00 | 185000 |

## recent

```sql
SELECT time,merchant,category,event_type,amount_cents FROM financial_events WHERE user_id='demo-user' ORDER BY time DESC,event_id LIMIT 10;
```

| time | merchant | category | event_type | amount_cents |
| --- | --- | --- | --- | --- |
| 2026-09-11 18:30:00+00 | Campus Store | shopping | transaction | -1500 |
| 2026-09-11 12:15:00+00 | Campus Cafe | dining | transaction | -3000 |
| 2026-09-10 18:30:00+00 | Fuel & Transit | transportation | transaction | -1250 |
| 2026-09-10 12:15:00+00 | Neighborhood Market | groceries | transaction | -2500 |
| 2026-09-09 18:30:00+00 | Pharmacy | healthcare | transaction | -1000 |
| 2026-09-09 12:15:00+00 | Campus Cafe | dining | transaction | -2000 |
| 2026-09-08 18:30:00+00 | Cinema | entertainment | transaction | -750 |
| 2026-09-08 12:15:00+00 | Neighborhood Market | groceries | transaction | -1500 |
| 2026-09-07 18:30:00+00 | Campus Store | shopping | transaction | -500 |
| 2026-09-07 12:15:00+00 | Campus Cafe | dining | transaction | -1000 |

## totals

```sql
SELECT sum(spent_cents) FILTER(WHERE day >= '2026-09-05') AS last_7_cents,sum(spent_cents) AS last_30_cents,sum(forecast_spent_cents) AS forecast_30_cents FROM daily_spending WHERE user_id='demo-user' AND day >= '2026-08-13' AND day < '2026-09-12';
```

| last_7_cents | last_30_cents | forecast_30_cents |
| --- | --- | --- |
| 23250 | 216000 | 90000 |

## categories

```sql
SELECT category,sum(spent_cents) AS spent_cents FROM daily_spending WHERE user_id='demo-user' AND day >= '2026-08-13' AND day < '2026-09-12' GROUP BY category ORDER BY spent_cents DESC,category;
```

| category | spent_cents |
| --- | --- |
| housing | 110000 |
| dining | 30000 |
| groceries | 30000 |
| utilities | 14500 |
| transportation | 8250 |
| shopping | 7750 |
| healthcare | 7250 |
| entertainment | 6750 |
| subscriptions | 1500 |

## daily

```sql
SELECT day,sum(spent_cents) AS spent_cents FROM daily_spending WHERE user_id='demo-user' AND day >= '2026-09-05' AND day < '2026-09-12' GROUP BY day ORDER BY day;
```

| day | spent_cents |
| --- | --- |
| 2026-09-05 00:00:00+00 | 3750 |
| 2026-09-06 00:00:00+00 | 4500 |
| 2026-09-07 00:00:00+00 | 1500 |
| 2026-09-08 00:00:00+00 | 2250 |
| 2026-09-09 00:00:00+00 | 3000 |
| 2026-09-10 00:00:00+00 | 3750 |
| 2026-09-11 00:00:00+00 | 4500 |

## weekdays

```sql
WITH daily AS (SELECT d.day,COALESCE(sum(s.forecast_spent_cents),0) AS spending FROM generate_series(TIMESTAMP '2026-08-13',TIMESTAMP '2026-09-11',INTERVAL '1 day') d(day) LEFT JOIN daily_spending s ON s.user_id='demo-user' AND s.day=d.day AT TIME ZONE 'UTC' GROUP BY d.day) SELECT extract(isodow FROM day)::int AS weekday,round(avg(spending)) AS average_cents,count(*) AS sample_days FROM daily GROUP BY extract(isodow FROM day) ORDER BY weekday;
```

| weekday | average_cents | sample_days |
| --- | --- | --- |
| 1 | 3000 | 4 |
| 2 | 2813 | 4 |
| 3 | 2625 | 4 |
| 4 | 3000 | 5 |
| 5 | 3000 | 5 |
| 6 | 3375 | 4 |
| 7 | 3188 | 4 |

## cash

```sql
SELECT sum(total_inflow_cents) AS inflow_cents,sum(total_outflow_cents) AS outflow_cents,sum(net_cash_flow_cents) AS net_cents FROM daily_cash_flow WHERE user_id='demo-user' AND day >= '2026-08-13' AND day < '2026-09-12';
```

| inflow_cents | outflow_cents | net_cents |
| --- | --- | --- |
| 401000 | 216000 | 185000 |

## structure

```sql
SELECT hypertable_name FROM timescaledb_information.hypertables; SELECT view_name,materialized_only FROM timescaledb_information.continuous_aggregates; SELECT indexname FROM pg_indexes WHERE schemaname='public' AND tablename='financial_events'; SELECT count(*) AS unexpected_events FROM financial_events WHERE user_id='demo-user' AND event_type='unexpected_expense';
```

| hypertable_name |
| --- |
| financial_events |

| view_name | materialized_only |
| --- | --- |
| daily_spending | f |
| daily_cash_flow | f |

| indexname |
| --- |
| financial_events_identity |
| financial_events_time_idx |
| financial_events_user_time |
| financial_events_category_time |
| financial_events_type_time |
| financial_events_account_time |

| unexpected_events |
| --- |
| 0 |



## Repeatability and final checks

- Schema reapplied successfully; create_hypertable returned `(1,f)` (already exists).
- Aggregate definitions/policies reapplied without duplicates.
- Seed rerun returned `INSERT 0 0`; count remains 69.
- Raw events reconcile to spending and cash-flow aggregates.
- Two aggregate refresh policies; zero duplicate event identities.
- Temporary MCP write-test table is absent.
- 46/46 tests pass; TypeScript, ESLint and production build pass.

## Direct application connection

MCP database verification succeeded. A separate read through the application's pg client failed with `SELF_SIGNED_CERT_IN_CHAIN`, including a retry outside the sandbox and with Node's system CA store. No application-to-cloud success is claimed. Configure a trusted Tiger certificate chain for this environment (for example a verified CA PEM via `NODE_EXTRA_CA_CERTS`) before enabling live application reads. TLS certificate verification was not disabled; credentials were not printed or changed.
