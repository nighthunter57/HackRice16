# Nessie integration

`Expo → /api/analyze → FinancialDataProvider → Nessie → normalized state → Tiger analytics → financial engine → FutureMe / Safe Date`.

Nessie is an actual remote sandbox API, not a connection to a person's real bank. The primary provider uses the returned account balances and completed banking history. Gemini only interprets products; Backboard only supplies semantic preferences. Neither calculates or stores authoritative banking balances.

## Configuration and commands

- `DEMO_MODE=false`, `NESSIE_API_KEY`, `NESSIE_BASE_URL=https://api.nessieisreal.com`, `NESSIE_CUSTOMER_ID` select the banking profile.
- `NESSIE_ACCOUNT_ID` identifies the checking account used by setup/seed scripts. The provider pools the customer's supported liquid accounts; credit cards are excluded.
- `NESSIE_SCHEDULE_PATH` optionally loads validated internal bills, expected income and goals for exactly that customer. `replaceNessieBills` must be explicit to substitute internal bills for the bank bill endpoint.
- `npm run nessie:setup` reuses the named Spendly demo customer/checking account. IDs are saved in `.env.local`. No startup provisioning.
- `npm run nessie:seed` reuses merchant names and stable transaction descriptions; its seed date is persisted. Rerunning it created zero additional transactions in live verification. It leaves existing banking balances and schedules intact.
- `npm run nessie:test` verifies customer/accounts/history, Tiger sync, summary amounts, and the mobile boundary.

The client centralizes GET/POST/PUT/DELETE, query-key authentication, validated JSON, TLS, timeout, rejected redirects and typed safe errors. Reads may retry once; writes never automatically retry. Metro blocks the entire Nessie directory, so provider code and keys cannot become native imports.

## Verified on September 12, 2026

The first successful request was authenticated `GET /accounts`: HTTP 200, empty array. `GET /customers` also returned an empty array. Setup then created one named customer and one checking account. The returned account balance was 1850 dollars, normalized to 185000 cents.

Seed and verification observed:

- 30 completed purchases, two executed historical deposits, five pending future deposits and six merchants.
- 32 posted events in Tiger; a repeat ingestion retained 32 total rows and 32 distinct event IDs.
- Current spendable cash 185000 cents; a 24900-cent proposed purchase leaves 160100 cents immediately.
- With the configured recurring internal bills and spending history, the 60-day forecast minimum was -50951 cents and the Safe Date was null. No output is forced to match a presentation example.
- The shared mobile parser recomputed the same analysis as the server.

Accounts/customers/purchases/deposits/withdrawals returned plain arrays with no pagination metadata in the verified responses. Merchant listing also returned an array; the seed reader additionally accepts the official older SDK's `data` wrapper. Unsupported response shapes fail validation rather than silently dropping pages.

## API differences and limitations

The current interactive documentation routes `/`, `/docs`, `/documentation` and `/openapi.json` could not be fetched from this environment (403). Official SDK resource examples were inspected, then request/response shapes were verified against the running API. Sources: [official Nessie site](https://api.nessieisreal.com/) and [official SDK resource tests](https://github.com/nessieisreal/nessie-javascript-sdk/tree/master/lib/tests).

Observed differences from older examples:

- Merchant creation requires a category string, not an array.
- Purchase creation accepts `completed`, not `executed`. Deposits accept `executed` and `pending`.
- Decimal purchase amounts such as 17.99 were returned as 17. The provider uses the returned amount, never reconstructs cents from seed intent, and never replaces the returned balance with a calculated ledger balance.
- An account with no transfers returned HTTP 404. The provider treats only this resource's 404 as an empty transfer list; other failures remain failures.
- Four bill POSTs succeeded, but both account and customer bill GETs returned HTTP 400, reporting missing `recurring_date` and `upcoming_payment_date`. Those remote records were preserved. The seed script no longer creates bills; the known rent, phone, insurance and subscriptions are stored as explicitly configured internal monthly obligations. A zero-saved Japan goal is internal configuration, not a bank fact.

Internal transfers produce two stable event IDs (debit and credit) so Tiger's cash-flow totals balance. External outgoing transfers are obligations, not recurring everyday-spending estimates. Posted events are not debited again from the current snapshot; pending payments remain scheduled and are not ingested as completed history.

Fallback returns `dataSource: demo` and a mild refresh message. Never label this result as Nessie. The development-only pending withdrawal action is available when `NESSIE_DEMO_EXPENSE_ENABLED=true`. The demo/Tiger repair scenario remains available when using demo data. See [financial setup and verification](financial-setup.md).

## Result contract

The analysis response includes the existing full `profile` and `analysis`, plus a `PurchaseAnalysis` summary: `dataSource`, `currentBalanceCents`, `purchasePriceCents`, `immediateBalanceAfterPurchaseCents`, `projectedMinimumBalanceCents`, `safetyBufferCents`, `bufferDifferenceCents`, lowercase `verdict`, `safeDate`, `waitDays`, `reasons`, and `goalImpacts`. All amounts originate in the integer-cent engine. No probabilistic result is fabricated.

The running authenticated `POST /api/analyze` endpoint also returned HTTP 200 with `dataSource: nessie`, current balance 185000 cents and immediate balance 160100 cents. Nessie and Tiger both reported live. The iOS/Android export was scanned for the configured Nessie key: all 38 files were clear. Physical-phone rendering and a successful Gemini scan were not verified by these checks.
