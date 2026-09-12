-- CanIBuyIt: additive schema. Existing unrelated objects are never dropped.
CREATE EXTENSION IF NOT EXISTS timescaledb;
CREATE TABLE IF NOT EXISTS public.financial_events (
 time timestamptz NOT NULL, event_id text NOT NULL, user_id text NOT NULL,
 account_id text, amount_cents bigint NOT NULL, category text, merchant text,
 event_type text NOT NULL, metadata jsonb DEFAULT '{}'::jsonb
);
ALTER TABLE public.financial_events ALTER COLUMN metadata SET DEFAULT '{}'::jsonb;
CREATE UNIQUE INDEX IF NOT EXISTS financial_events_identity ON public.financial_events(user_id,event_id,time);
SELECT create_hypertable('public.financial_events', by_range('time', INTERVAL '7 days'), if_not_exists => TRUE, migrate_data => TRUE);
CREATE INDEX IF NOT EXISTS financial_events_user_time ON public.financial_events(user_id,time DESC);
CREATE INDEX IF NOT EXISTS financial_events_category_time ON public.financial_events(user_id,category,time DESC);
CREATE INDEX IF NOT EXISTS financial_events_type_time ON public.financial_events(user_id,event_type,time DESC);
CREATE INDEX IF NOT EXISTS financial_events_account_time ON public.financial_events(account_id,time DESC);
CREATE TABLE IF NOT EXISTS public.financial_snapshots (
 id uuid PRIMARY KEY, user_id text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 source text NOT NULL CHECK(source IN ('nessie','demo')), state jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS financial_snapshots_user_time ON public.financial_snapshots(user_id,created_at DESC);
CREATE TABLE IF NOT EXISTS public.purchase_decisions (
 id uuid PRIMARY KEY, user_id text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), decision jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS purchase_decisions_user_time ON public.purchase_decisions(user_id,created_at DESC);
