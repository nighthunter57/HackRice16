-- All negative non-transfer events are spending. Positive income/refunds are not.
CREATE MATERIALIZED VIEW IF NOT EXISTS public.daily_spending
WITH (timescaledb.continuous, timescaledb.materialized_only=false) AS
SELECT time_bucket(INTERVAL '1 day',time) AS day,user_id,category,
 sum(-amount_cents) AS spent_cents,count(*) AS event_count,
 COALESCE(sum(-amount_cents) FILTER (WHERE event_type IN ('transaction','purchase','discretionary')),0) AS forecast_spent_cents
FROM public.financial_events WHERE amount_cents<0 AND event_type<>'transfer'
GROUP BY time_bucket(INTERVAL '1 day',time),user_id,category WITH NO DATA;
CREATE MATERIALIZED VIEW IF NOT EXISTS public.daily_cash_flow
WITH (timescaledb.continuous, timescaledb.materialized_only=false) AS
SELECT time_bucket(INTERVAL '1 day',time) AS day,user_id,
 sum(CASE WHEN amount_cents>0 THEN amount_cents ELSE 0 END) AS total_inflow_cents,
 sum(CASE WHEN amount_cents<0 THEN -amount_cents ELSE 0 END) AS total_outflow_cents,
 sum(amount_cents) AS net_cash_flow_cents
FROM public.financial_events GROUP BY time_bucket(INTERVAL '1 day',time),user_id WITH NO DATA;
SELECT add_continuous_aggregate_policy('public.daily_spending',start_offset=>INTERVAL '90 days',end_offset=>INTERVAL '1 hour',schedule_interval=>INTERVAL '1 hour',if_not_exists=>TRUE);
SELECT add_continuous_aggregate_policy('public.daily_cash_flow',start_offset=>INTERVAL '90 days',end_offset=>INTERVAL '1 hour',schedule_interval=>INTERVAL '1 hour',if_not_exists=>TRUE);
