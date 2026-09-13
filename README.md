# Spendly

**See your financial future before you spend.**

Live app: **https://64.177.45.109** (Vultr). See [deployment and operations](docs/deployment.md).

A HackRice 16 planning prototype that compares buying today with waiting, forecasts daily cash flow, finds the earliest safe purchase date, and computes a safe maximum spend. Gemini understands products; integer-cent TypeScript calculates financial outcomes.

## Run locally

Requires Node.js 22+ and npm. Tested here on Node.js 25.4.0.

```sh
npm ci
npm run dev
```

Open the printed Local URL, normally http://127.0.0.1:3000. No sponsor keys are needed for the deterministic demo. Copy `.env.example` to `.env.local` to configure integrations, then restart. Provider selection is server-side: `DEMO_MODE=true` or a missing Nessie key selects the demo provider; otherwise the validated Nessie adapter is used, with a labeled demo fallback if banking data cannot refresh. Never expose API keys through `NEXT_PUBLIC_` variables.

```sh
npx next typegen
npm test
npm run typecheck
npm run lint
npm run build
npm start
```

`next typegen` generates the ignored Next.js type files needed for type checking a fresh checkout. The repository includes source, runtime assets, database scripts, tests, deployment configuration, and the npm lockfile. Local credentials, build output, device logs, and input photos are excluded; `.env.example` contains configuration names without secrets.

Single test: `npx tsx --test tests/finance.test.ts`. Optional browser test: `python scripts/browser_smoke.py` with an existing Python Playwright installation, Google Chrome and a running dev server.

## Expo mobile

First configure the database and JWT secrets, run `npm run db:migrate`, then run `npx expo start --clear` for the native app. Create an account on the sign-up screen. Expo Router is explicitly rooted at `mobile/app` in `app.json`; `src/app` belongs to the Next.js backend/web app. Do not create a root `app` directory, which would shadow Next.js's `src/app`.

Verify native bundling with `npx expo export --platform ios --platform android --source-maps --output-dir /tmp/canibuyit-expo`. Metro rejects backend directories, provider adapters, database packages and Node built-ins in the Expo dependency graph.

The mobile interface has Home, History, Goals, and Profile tabs plus Scan, Result, and FutureMe stack screens. Run `npm run mobile` for a device, or `npm run mobile:web` for a browser preview. `npm run mobile:export` verifies both native bundles. With Python Playwright and Chrome installed, run `python scripts/mobile_smoke.py` against the web preview (override the URL using `MOBILE_PREVIEW_URL`). This checks navigation, verdicts, repair reversal, saved plans, goals, scan failure/manual fallback, and history after reload.

Mobile requests `/api/analyze` for Tiger-backed demo analysis, validates the returned financial state, and runs the shared deterministic engine on that state. If a purchase check fails, the existing result is preserved and the form offers retry or an explicit September 12, 2026 offline demo. Results show the purchase impact and a concise “Sample finances” label when sample data is used; integration diagnostics remain in server logs and API metadata. The offline $449 demo waits until September 17; adding the repair moves it to September 24. History stores the latest 50 checks with their financial snapshots on this device. Goals are prepopulated and read-only. A saved plan does not execute a purchase. Live bank-profile selection is not part of the mobile interface.

Start `npm run dev:lan` for the backend and `npm run mobile` in another terminal, with phone and computer on the same network. Leave `EXPO_PUBLIC_API_URL` blank for local development: native mobile follows the current Expo host at port 3000, and web follows the browser hostname so session cookies stay same-site. Set it explicitly for a deployed LAN/HTTPS backend. Avoid pinning a temporary Wi-Fi IP; it changes across networks. `npm run start` binds to localhost and is not the phone development server; use `npm run dev:lan`. For Expo web accessed over LAN, include its exact origin (for example `http://192.168.1.20:8081`) in `AUTH_ALLOWED_ORIGINS`. Restart Expo after changing that variable. Scanning calls `/api/extract`; configure Gemini for recognition. Sign in through the account screens; the authenticated API client authorizes both scanning and analysis. Recognition failure leaves manual entry available. Review recognized details before checking. Analysis times out after 25 seconds and offers retry or an explicit demo choice.

The web preview supports the offline demo and email/password sessions. Configure its exact origin in `AUTH_ALLOWED_ORIGINS` when using browser requests. Metro uses Expo's browser-safe font context for the preview and continues rejecting backend modules and Node built-ins. Never put provider keys or access tokens in `EXPO_PUBLIC_*`. Shared types, demo data and pure `src/lib/finance` functions are safe client imports; provider integrations must use authenticated backend endpoints.

## Implemented

- Account registration, login, rotating persistent sessions, password recovery/change, profile editing, and account deletion.
- Manual entry and Gemini image/camera or natural-language extraction, with confirmation before analysis.
- Baseline, buy-today and Safe Date futures, hard reserve checks, bill coverage, goal impact and exact-cent safe maximum.
- Interactive chart, daily-value table, cash-flow milestones, goal dates, decision history and preferences.
- Canonical $449 Sony demo: September 17 Safe Date; a $430 repair scheduled September 20 moves it to September 24.
- Nessie normalization of customers, accounts, purchases, merchants, bills, deposits, withdrawals and transfers.
- Tiger hypertable and continuous daily spending aggregate feeding the spending model, with stored snapshots and decision records.
- Backboard typed preferences and semantic purchase decisions, separate from monetary facts.

## Sponsor setup

| Service | Configuration | Fallback |
| --- | --- | --- |
| Nessie | `NESSIE_API_KEY`, `NESSIE_CUSTOMER_ID`, optional `NESSIE_BASE_URL` | Explicit canonical demo profile |
| Tiger Data | `DATABASE_URL`, then `npm run db:migrate` | Already-loaded transaction history |
| Gemini | `GEMINI_API_KEY`, optional `GEMINI_MODEL` | Manual product entry |
| Backboard | `BACKBOARD_API_KEY`, dedicated `BACKBOARD_ASSISTANT_ID` | Local/default preferences |

Use an isolated TimescaleDB 2.13+ database with permission to create the extension and continuous aggregate. The migration is additive and repeatable. It does not reset data. `TIGER_DATABASE_URL` remains a legacy alias; `DATABASE_URL` takes precedence. See [database setup and analytics](database/README.md) for deterministic seeding and verified queries.

Database connections and migrations enforce `sslmode=verify-full`. A private certificate authority can be supplied with the server-only `TIGER_CA_CERT_PATH`; never disable certificate verification. PostgreSQL error `28P01` means the connection string credentials were rejected: update `DATABASE_URL` locally with the correct Tiger credentials and restart the backend. MCP access uses separate credentials and does not validate the application's password.

The Next.js landing page is a public demo preview. The Expo app uses individual accounts and JWT-authenticated backend routes. Shared `APP_ACCESS_TOKEN` access has been removed. See [authentication setup](docs/authentication.md) for account flows, email delivery, and linking an app user to a dedicated Nessie customer and Backboard assistant. Nessie remains a sandbox source; future paychecks and goals are not inferred from old deposits.

## Limits and verification

Tests cover deterministic financial fixtures, API validation, and mocked provider HTTP/database boundaries. They do not certify live credentials or execute the migration on hosted TimescaleDB. Apply the migration and rehearse against your sponsor accounts before judging; check the API service metadata for actual demo/live/fallback status.

Default horizon is 60 days, adjustable to 30–90. Forecasts are estimates, not guarantees. Read the [financial assumptions](src/lib/finance/README.md) for event ordering, reserved assets and goal allocation. The banking demo computes $58.95 minimum buying today, $507.95 minimum waiting, and a $107.95 safe maximum today; numbers in the pitch are illustrative, not hard-coded outputs.

UI decision history is device-local, with Tiger persistence when available. Submitted decision summaries are records of user choices, never engine inputs. Web and mobile carry the prior snapshot ID into analysis. For the demo provider, stored upcoming unexpected expenses become forecast obligations; the engine compares the same purchase and settings across snapshots and reports bill and historical category changes. The repair toggle inserts one idempotent demo event; removing the scenario excludes that event without deleting it. Automatic bank polling and comparisons across different forecast start dates/settings are not implemented. Live Nessie goals are not inferred; Japan is a demo goal. Optional scoring, alternatives, extension, domain registration and GoDaddy work are not implemented.

See [architecture](docs/architecture.md) and the [two-minute demo](docs/demo.md).

## Provider-backed judging demo

`src/lib/financial-providers/` exposes the shared provider contract and factory. The Nessie client and normalization live in `src/lib/nessie/`; the factory selects Nessie once per request and the service handles a labeled fallback. `dataSource` in every analysis response identifies `demo` or `nessie`. The native home screen identifies Nessie or Demo data. The server selects one provider per request, and both providers use the same normalized transaction ingestion, Timescale aggregates and financial engine.

The runtime fixture is `src/data/banking-demo.ts`: 136 deterministic events over 60 days, $1,850 checking, $2,100 reserved emergency savings and $1,900 reserved Japan savings. Japan has first allocation priority. A fully funded emergency goal reserves that account under the existing engine model. Rent, phone, Netflix and insurance recur monthly. Payroll is $900 weekly starting five days after the pinned September 12 date. The smaller `demo-profile.ts` fixture remains for historical algorithm regression tests; the product uses the banking fixture.

With `DEMO_MODE=true` and a working `DATABASE_URL`, run `npm run demo:verify` to sync the history, verify live analytics, insert the idempotent $430 repair, compare saved snapshots, and restore the no-repair scenario. It leaves the demo repair event in Tiger; the normal scenario excludes that one event without deleting data. This action is available in development or an explicitly configured demo deployment. `npm run demo:seed-sql` regenerates `database/seed.sql` from the same fixture. Seeds upsert only their deterministic event identities; unrelated history is preserved.

Start `npm run dev:lan` and `npm run mobile` in separate terminals. Keep phone and computer on the same LAN (or configure a reachable HTTPS backend). Home refreshes from the backend; manual entry always works, and Gemini recognition remains available when configured. Sign in before using mobile financial features. A failed check preserves the existing result. Offline calculations require choosing the sample-finances demo and are not presented as live Tiger analytics.

Judging wording: “Nessie supplies account state and banking history. Tiger analyzes spending, and our deterministic engine calculates FutureMe, Safe Date, and Safe Spend.” Use this wording only when the result reports `dataSource: nessie` and Tiger reports `live`. Gemini and Backboard have independent service status.

### Progressive product scanning

The web dashboard and mobile Scan screen accept a product photo without a barcode, exact name, or price. `/api/extract` now returns `{ state, productFamily, candidates, warnings }`: Gemini first reads visible barcode/QR and model/SKU text, then suggests up to five identities using image understanding. Ambiguous photos request 3–5 candidates; fewer are returned when evidence is insufficient. Confidence is model-estimated, not a guarantee. Barcode reading is best-effort image interpretation, not a dedicated barcode decoder. QR URLs are never followed.

Users select a possible match (or “None of these”), then enter/confirm the total USD price before financial analysis. Missing price and no match are successful recognition outcomes, not service errors. Identification states are `BARCODE_MATCH`, `TEXT_MATCH`, `VISUAL_CANDIDATES`, and `NO_MATCH`; selection without a price is `PRODUCT_FOUND_PRICE_MISSING`, and confirmation completes `FULL_SUCCESS`.

Optional server-only `UPCITEMDB_API_KEY` enables [UPCitemdb barcode lookup](https://www.upcitemdb.com/wp/docs/main/development/getting-started/). Catalog failure leaves visual matches available. Visible USD price takes priority over catalog offers; multiple catalog offers appear as a range and are never automatically converted to a confirmed purchase price. Historical catalog prices are ignored. Without a sourced price, users enter one. Gemini never supplies an estimated price. eBay marketplace enrichment is not configured in this implementation. Photos are sent to Gemini; only detected barcode digits are sent to UPCitemdb. API keys stay on the server.


### Live Nessie setup and verification

Use `NESSIE_BASE_URL=https://api.nessieisreal.com`, a server-only key, and `DEMO_MODE=false`. Run `npm run nessie:setup` once to reuse/create the named demo customer and checking account and save their IDs in ignored `.env.local`. Run `npm run nessie:seed` explicitly to add missing demo banking history and save an internal schedule under ignored `.local/`. Neither script runs on app startup. Restart the backend after configuration changes.

`npm run nessie:test` checks authentication, customer/accounts, normalized history, Tiger ingestion idempotency, the forecast and mobile response contract. It writes only the requested analytics/snapshot records and reports IDs, counts and integer-cent balances, never keys. See [Nessie integration and observed API behavior](docs/nessie-integration.md).

A Nessie provider failure returns demo data with “Financial data couldn't refresh. Using demo data.” A phone-to-backend request failure still offers retry or an explicit local demo. Optional `NESSIE_SCHEDULE_PATH` points to a validated, customer-scoped JSON file containing `bills`, `incomeEvents`, `goals` and `replaceNessieBills`. The internal schedule is independent of bank history; it never overrides bank balances. The existing repair toggle remains a demo/Tiger scenario and does not create a Nessie withdrawal.

### Financial setup and refresh

The Expo app now includes **Financial setup** for spending accounts, the safety buffer, recurring bills, income and editable goals with deadlines and priority. Changes persist on the device and recalculate the shared financial engine. **Refresh finances** keeps the same purchase, shows source/refresh status and preserves saved history. Results explain the upcoming obligations behind **Why wait?**.

The optional **Nessie expense demo** is development-only and creates one pending $430 sandbox repair per UTC day; it retains the actual bank balance, syncs a stable Tiger event and refreshes FutureMe. See [setup, live verification and remaining phone checks](docs/financial-setup.md) before running `npm run nessie:expense:test`.

Payments are available from the mobile Home screen. Add a custom name, amount,
calendar due date, and a monthly, weekly, every-two-weeks, or one-time schedule.
Saving or removing a payment immediately recalculates the current forecast,
FutureMe, and Safe Date. Monthly schedules retain their original day and use the
last day of shorter months. Payment overrides use the existing per-user,
per-financial-source device settings and accompany subsequent analysis requests;
they do not change bank balances or schedule an actual bank transfer.
Run `python scripts/payments_smoke.py` against the Expo web preview to exercise
adding, editing, persistence, and removal (isolated authentication fixture).
