# Architecture

One Next.js App Router service with strict TypeScript, React, Recharts, Zod, `pg` and a small plain-CSS visual system.

Expo Router uses `mobile/app`, explicitly configured in `app.json`. Its default `src/app` discovery would otherwise bundle Next.js API handlers as native screens. Metro rejects imports resolving into `src/app`, `src/lib/server`, `src/lib/integrations`, `src/lib/nessie`, `src/lib/financial-providers` and database directories, plus Node built-ins and server packages. This protects direct imports, aliases and transitive barrel exports without crypto polyfills. The integration barrel is server-only; `src/types`, `src/data`, `src/lib/display` and `src/lib/finance` remain shared and contain no provider credentials.

The native home refreshes its financial snapshot through the backend. Native financial features must follow `Expo → HTTP/fetch → Next.js /api → financial engine/providers`. Secret validation, database access and provider keys stay behind those existing API routes.

```text
Manual / Gemini product input → schema validation + user confirmation
Nessie / Demo provider → normalized FinancialState
Tiger financial_events → continuous daily_spending → 30-day spending estimate
                              ↓
Pure forecast → baseline + purchase futures → chronological Safe Date search
                                           → fixed-date price binary search
                              ↓
FutureMe ← typed financial results + separate Backboard semantic context
```

`src/lib/finance` imports no UI, network, database, clock or model code. Cents and intermediate sums are checked as safe integers. Dates are real UTC calendar days. Calculation assumptions live in [the engine README](../src/lib/finance/README.md).

`src/lib/server/dashboard.ts` coordinates providers, aggregates, analysis and context. Aggregation happens once before the optimizer, never inside its candidate loop. Posted transactions are not debited again from an account snapshot. A simulated repair is one future bill, not also an opening-balance debit.

Gemini receives only product input. Structured output is validated; missing prices stay null. Explanations currently use deterministic templates so all numerical statements originate in the engine. Backboard stores only supported semantic preferences and item/choice memories. Financial data stays in Tiger and the deterministic state.

Routes: `POST /api/analyze`, `/api/extract`, `/api/preferences`, `/api/decisions`. They enforce bounded JSON input, explicit allowed browser origins, and verified per-user access JWTs with active sessions. Identity comes only from the JWT. See [authentication](authentication.md). Provider failures hide credentials, apply timeouts and retry bounded reads only. Writes do not claim success on failure.

## Provider references

- [Nessie API](http://api.nessieisreal.com/)
- [Gemini structured outputs](https://ai.google.dev/gemini-api/docs/structured-output)
- [Backboard memories](https://docs.backboard.io/api-reference/memories/list)
- [Backboard memory concepts](https://docs.backboard.io/concepts/memory)
- [Tiger continuous aggregates](https://docs.tigerdata.com/use-timescale/latest/continuous-aggregates/)
- Installed Next.js guides: `node_modules/next/dist/docs/`.
