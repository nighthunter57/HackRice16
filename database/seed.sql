-- Pinned 30-day history: Aug 13 through Sep 11, 2026, evaluated as of Sep 12.
-- 90,000 cents ordinary spending / 30 days = 3,000 cents per day.
-- 41,000 opening funding + 360,000 paychecks - 216,000 spending = 185,000.
WITH days AS (
 SELECT i, DATE '2026-08-13'+i AS day, (1500+(i%5)*750)::bigint AS total FROM generate_series(0,29) i
), ordinary AS (
 SELECT (day+TIME '12:15') AT TIME ZONE 'UTC' AS time,'demo-history-v1-food-'||i AS event_id,
 'demo-user'::text AS user_id,'checking'::text AS account_id,-(total*2/3) AS amount_cents,
 CASE WHEN i%2=0 THEN 'groceries' ELSE 'dining' END AS category,
 CASE WHEN i%2=0 THEN 'Neighborhood Market' ELSE 'Campus Cafe' END AS merchant,'transaction'::text AS event_type
 FROM days
 UNION ALL
 SELECT (day+TIME '18:30') AT TIME ZONE 'UTC','demo-history-v1-other-'||i,
 'demo-user','checking',-(total-total*2/3),
 CASE i%4 WHEN 0 THEN 'transportation' WHEN 1 THEN 'shopping' WHEN 2 THEN 'entertainment' ELSE 'healthcare' END,
 CASE i%4 WHEN 0 THEN 'Fuel & Transit' WHEN 1 THEN 'Campus Store' WHEN 2 THEN 'Cinema' ELSE 'Pharmacy' END,'transaction' FROM days
), fixed AS (
 SELECT * FROM (VALUES
 ('2026-08-13 00:00+00'::timestamptz,'demo-history-v1-opening','demo-user','checking',41000::bigint,'other','Opening demo funding','transfer'),
 ('2026-08-14 08:00+00'::timestamptz,'demo-history-v1-pay-1','demo-user','checking',90000::bigint,'income','Weekly paycheck','income'),
 ('2026-08-21 08:00+00'::timestamptz,'demo-history-v1-pay-2','demo-user','checking',90000::bigint,'income','Weekly paycheck','income'),
 ('2026-08-28 08:00+00'::timestamptz,'demo-history-v1-pay-3','demo-user','checking',90000::bigint,'income','Weekly paycheck','income'),
 ('2026-09-04 08:00+00'::timestamptz,'demo-history-v1-pay-4','demo-user','checking',90000::bigint,'income','Weekly paycheck','income'),
 ('2026-08-13 09:00+00'::timestamptz,'demo-history-v1-rent','demo-user','checking',-110000::bigint,'housing','Monthly rent','bill'),
 ('2026-08-14 09:00+00'::timestamptz,'demo-history-v1-phone','demo-user','checking',-8000::bigint,'utilities','Phone plan','bill'),
 ('2026-08-20 09:00+00'::timestamptz,'demo-history-v1-power','demo-user','checking',-6500::bigint,'utilities','Electric utility','bill'),
 ('2026-08-22 09:00+00'::timestamptz,'demo-history-v1-stream','demo-user','checking',-1500::bigint,'subscriptions','Streaming','subscription')
 ) AS f(time,event_id,user_id,account_id,amount_cents,category,merchant,event_type)
)
INSERT INTO public.financial_events(time,event_id,user_id,account_id,amount_cents,category,merchant,event_type,metadata)
SELECT *,jsonb_build_object('source','canibuyit-demo','seed_version',1) FROM (SELECT * FROM ordinary UNION ALL SELECT * FROM fixed) all_events
ON CONFLICT(user_id,event_id,time) DO NOTHING;
-- Run refresh calls separately (outside explicit BEGIN/COMMIT).
CALL refresh_continuous_aggregate('public.daily_spending',TIMESTAMPTZ '2026-08-13 00:00+00',TIMESTAMPTZ '2026-09-12 00:00+00');
CALL refresh_continuous_aggregate('public.daily_cash_flow',TIMESTAMPTZ '2026-08-13 00:00+00',TIMESTAMPTZ '2026-09-12 00:00+00');
