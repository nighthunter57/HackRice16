# Authentication

The Expo app requires an account before displaying financial screens. Authentication is supporting infrastructure; the forecast engine remains deterministic and sponsor adapters remain server-side.

## Setup

1. Copy `.env.example` to ignored `.env.local`. Set `DATABASE_URL` and two independent random `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` values, each at least 32 bytes. Use a cryptographic secret generator; never reuse a password.
2. Run `npm run db:migrate`. The additive migration preserves existing demo history and creates users, sessions, hashed reset tokens, integration mappings, preferences, rate counters, and resumable deletion records.
3. Start the backend and Expo. Only `EXPO_PUBLIC_API_URL` belongs in the client environment. Register in the app; registration signs in automatically.
4. To use the existing Nessie demo customer for that account, run `npm run auth:link -- --email your-account@example.com --nessie-demo`. This validates checking-account ownership and persists an exclusive mapping. New users otherwise receive clearly labeled demo finances. No customer is created or shared automatically at registration.
5. Optionally link an assistant dedicated to that user with `npm run auth:link -- --email your-account@example.com --backboard-assistant-id <dedicated-id>`. Do not reuse an assistant containing another person's memory. Database uniqueness prevents assigning the same integration to multiple app users. Unmapped users store preferences in their own PostgreSQL rows and never use the global assistant.

Existing CLI sponsor setup tools retain their explicit development environment mapping. HTTP requests always derive ownership from the verified JWT. Logout preserves owned financial data; deleting an app account does not delete the underlying Nessie sandbox bank account.

## Flows and tokens

`POST /api/auth/register`, `/login`, `/refresh`, `/logout`, `/forgot-password`, `/reset-password`, and `/change-password` implement the account lifecycle. `GET /api/me` returns only id, name, email, and creation date; `PATCH` edits name; `DELETE` requires `{ "confirmation": "DELETE" }` and derives the account from authentication.

Passwords use Argon2id (64 MiB memory, three iterations). Access tokens are HS256 JWTs with a 15-minute default lifetime, subject, session identifier, issuer and audience. Every protected request checks both signature/expiry and the active database session, so logout/reset invalidates access immediately. Opaque 48-byte random refresh tokens rotate atomically and expire after seven days from session creation. Only purpose-separated keyed hashes of refresh/reset tokens are persisted. Password change revokes all old sessions and returns one new current session; reset revokes all sessions.

Native tokens use `expo-secure-store`. Web previews keep access tokens in memory and refresh credentials in an HttpOnly, SameSite=Strict cookie (Secure in production). No tokens are stored in AsyncStorage or browser localStorage. Startup completes refresh and `/api/me` before exposing protected routes; temporary startup network errors offer Retry. An expired access token triggers one refresh and one retry; other 401s clear the local session. Logout waits for server revocation; an offline logout shows a retryable connection error.

History/settings keys include the authenticated UUID. Switching accounts remounts financial state and cannot display the previous user's saved snapshots. Tiger queries, ingestion, preferences, decisions, and integration mappings use the authenticated UUID. An authenticated demo fallback does not ingest synthetic history into that user's real banking analytics.

## Password recovery

In explicit `NODE_ENV=development`, an unconfigured email adapter prints the reset URL to the backend console. It is never returned in an API response or logged in production. The default `spendly://reset-password` opens an installed development/native build. Expo Go may require opening Reset Password and pasting the code manually; a browser preview can use `/reset-password?token=<code>`.

For real email delivery set `EMAIL_PROVIDER=resend`, `EMAIL_FROM` to a verified sender, `EMAIL_API_KEY`, and `PASSWORD_RESET_URL` to your deployed HTTPS Expo reset page. The adapter implements Resend delivery with a timeout. Production without a provider does not deliver resets; the public response stays generic to avoid account enumeration. Delivery errors log safe status metadata. Reset tokens expire after 15 minutes, invalidate older links, and work once.

## Deployment and deletion

Use HTTPS. Set `AUTH_ALLOWED_ORIGINS` to exact web origins, comma separated; wildcard origins are rejected. Native requests without Origin are supported. Web frontend and API should be on the same site for the Strict refresh cookie. Only enable `AUTH_TRUST_PROXY=true` when a trusted proxy replaces incoming forwarded IP headers. Database rate limits protect auth routes across processes; without trusted IP forwarding a shared cap and per-email cap are used.

Deletion blocks concurrent financial operations for that user. It removes app-prefixed memories from the exclusively mapped assistant, deletes owned financial rows, refreshes Timescale aggregates, then deletes the user and dependent auth data. Timescale requires aggregate refresh outside a transaction, so durable cleanup bounds allow retry from Profile if cleanup fails. No success is returned until cleanup finishes. Account data remains unavailable to financial routes while deletion is pending.

## Verification

- `npm test`: deterministic tests, auth crypto/client and provider boundaries; database suite skips without explicit opt-in.
- `npm run auth:test`: actual migrated development PostgreSQL lifecycle tests, including expired/rotated/revoked tokens, reset single use, ownership rejection and account deletion. Creates unique `.invalid` fixture accounts and removes their rows; use an isolated development database.
- `python scripts/auth_smoke.py`: installed Python Playwright + Chrome, backend on port 3000, Expo web preview on 8084 (URLs configurable in the script). Exercises real signup/login/persistence/profile/change/logout/recovery UX/delete with an isolated account.
- `npm run typecheck`, `npm run lint`, `npm run build`, `npm run mobile:export`.

Hardware SecureStore and email deliverability still require device/deployment testing. The optional Next.js landing page starts with a public demo preview and offers email/password sign-in in Settings for connected requests. Its financial state remounts when the account changes. The complete account management experience lives in Expo (native or its web preview).

Verified locally on September 12, 2026: 103 regular tests passed and one opt-in database test was skipped in the regular command; the separate PostgreSQL suite passed all 13 checks. Expo auth/profile and optional Next sign-in passed real browser checks; purchase/FutureMe and settings smoke tests passed with isolated auth fixtures. Typecheck, lint, Next build, and iOS/Android/web exports passed. Exported client artifacts were checked against configured server secret values with no matches. A temporary authenticated account loaded the real Nessie checking balance of 185000 cents; two analyses retained 32 Tiger events without duplicate ingestion. Test accounts and their application rows were removed afterward. Email delivery was not exercised against a real inbox, and native keychain behavior was not tested on physical hardware.
