# Financial setup and connected demo

Open **Financial setup** from Home or **Edit goals & priorities** from Goals. Select spending accounts, set the reserve, add/edit/remove bills and expected income, and edit goal targets, reserved savings, deadlines and allowed delays. Goal order determines allocation priority. Apply an entry, then save the setup to recalculate the active purchase, FutureMe and Safe Date.

Settings are validated and stored in AsyncStorage on this device, scoped by financial source and user ID. They are sent to `/api/analyze` as planning overrides (`settings`, or `settingsProfiles` for source changes). The service selects the settings matching the provider source and user returned by the refresh, including demo fallback. Balances are never accepted as settings: they remain provider-owned. Edits replace scheduled entries by stable ID; excluded entries stay excluded on refresh. Bank-scheduled income retains its account association. Internal obligations apply to the selected spending pool. Tiger estimates whole-user spending behavior, even when only some accounts are selected; it does not assume spending disappears with an excluded account.

The response includes `planningProfile` (normalized state before device overrides), `accountChoices`, `refreshedAt`, and `developmentExpenseEnabled`. The financial engine validates the final merged state and computes all cents and dates. Backboard remains preference memory, not the settings or banking database.

**Refresh finances** fetches new provider data for the same purchase. A network failure preserves the existing result and displays a mild message. A provider fallback explicitly displays Demo. Saved history stays immutable; refreshing a saved result creates a new active result, and Save plan creates a new history entry. Last-refreshed time is distinct from a local settings recalculation.

**Why wait?** uses the first reserve breach in the deterministic timeline and shows up to three largest bills due by that point, including recurring occurrences and mandatory pending banking payments. It distinguishes positive immediate cash from unsafe future cash, and identifies goal constraints when the reserve itself is safe.

## Nessie expense action

Set server-only `NESSIE_DEMO_EXPENSE_ENABLED=true` in `.env.local`, with the configured Spendly demo customer/checking account. Production always disables the endpoint, regardless of the flag. Existing backend authorization and origin checks apply.

From FutureMe, **Schedule $430 Nessie demo expense** creates one **pending** withdrawal dated one UTC day after the request. It reads back the account's withdrawal list, normalizes the returned amount, inserts a stable `nessie-withdrawal-<id>` scheduled unexpected-expense event in Tiger, and refreshes the forecast. Pending status is retained as metadata. This scheduled event is not ordinary historical spending. The provider schedules it once and stops replaying it when Nessie reports it posted.

A pending withdrawal does not imply the bank balance has changed. The UI explains this. The current balance always comes from Nessie; no synthetic balance debit is applied. The readback uses the documented account list because the current sandbox rejected individual withdrawal GET with HTTP 403.

The action reuses the same record for the account and UTC day. An atomic local write-ahead marker in ignored `.local/nessie-expenses/` prevents repeating an uncertain POST across retries or restarts. Do not delete markers to bypass an uncertain result. This local locking is for the single-backend development demo, not distributed deployment. A readback failure preserves the marker. A fallback demo action is available after failure and explicitly changes the data source to Demo.

`npm run nessie:expense:test` explicitly creates/reuses the day's pending sandbox repair and verifies normalization, one Tiger event, exact forecast impact, and the mobile result parser. It is not run automatically during tests or startup.

## Verification on September 13, 2026 UTC

- Nessie pending repair ID `4e5a17e2-2f02-488b-bd86-5e92cba42559` was read back successfully. Repeated requests reused it; Tiger held one event.
- Returned balance: 185000 cents. A 24900-cent purchase leaves 160100 cents immediately.
- Counterfactual minimum without this pending repair: -46120 cents. With the repair: -89120 cents, exactly 43000 cents lower. This comparison removes only that pending event from the same observed state; it is not a claim that a new expense was created on each verification run.
- Safe Date is outside the horizon with and without the repair under the current schedule. No later date is fabricated. The deterministic demo regression separately verifies an expense moving a finite Safe Date later.
- Real authenticated `/api/analyze`: HTTP 200, source Nessie, refreshed timestamp and development action flag returned.
- The real Gemini price-tag scan returned HTTP 502 / `GEMINI_TIMEOUT` on two backend attempts; an independent direct Gemini call also timed out after 30 seconds. Successful live image recognition remains unverified; manual purchase input succeeded afterward.

## Repeatable checks

- `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`.
- `npm run mobile:export` builds iOS and Android bundles.
- `scripts/mobile_smoke.py`: purchase, history, scan candidate selection/reselection/rejection, manual fallback, loading locks, FutureMe, expense reversal, source labels and responsive widths.
- `scripts/settings_smoke.py`: setup validation, cents, recurring bills, income, goals and priority, persistence, edits/removal, failed-refresh preservation and configured results.
- Both browser scripts use installed Python Playwright/Chrome and an Expo web preview specified by `MOBILE_PREVIEW_URL`. They mock external responses; the financial engine remains real.
- `npm run mobile:verify-api -- /path/to/price-tag.png` calls the actual scan and analysis endpoints (default `http://127.0.0.1:3000`; override `VERIFY_API_URL`). It signs in with server-only `VERIFY_AUTH_EMAIL` and `VERIFY_AUTH_PASSWORD` for a dedicated linked verification account, reports safe metadata, and continues with manual input if scanning fails.

## Physical-device checks still required

Device discovery found only the Mac, with no connected iPhone or simulator. Native exports are not device tests. On a connected phone:

1. Open the Expo app with the backend's reachable LAN/HTTPS URL. Sign in to your linked app account, then refresh.
2. Deny camera permission; verify library/manual alternatives. Grant permission in Settings and retry.
3. Capture a real product and price tag; select a candidate, confirm cents and check the purchase.
4. Disconnect Wi-Fi during scanning and refreshing. Verify recovery text and preserved results, then reconnect and retry.
5. Background the app during a scan and a financial request; resume and verify no duplicate navigation or expense creation.
6. Save setup and a purchase decision; close and reopen the app. Verify settings and historical snapshots persist.
7. Verify the Nessie expense action once; a repeat must reuse the existing pending repair.
