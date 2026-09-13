-- Additive authentication migration. Existing demo financial data is preserved.
CREATE TABLE IF NOT EXISTS public.users (
 id uuid PRIMARY KEY, name text NOT NULL, email text NOT NULL UNIQUE,
 password_hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(email=lower(email))
);
CREATE TABLE IF NOT EXISTS public.auth_sessions (
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
 refresh_token_hash text NOT NULL UNIQUE, expires_at timestamptz NOT NULL, revoked_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS auth_sessions_user ON public.auth_sessions(user_id);
CREATE TABLE IF NOT EXISTS public.password_reset_tokens (
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
 token_hash text NOT NULL UNIQUE, expires_at timestamptz NOT NULL, used_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS password_reset_user ON public.password_reset_tokens(user_id);
CREATE TABLE IF NOT EXISTS public.user_integrations (
 user_id uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
 nessie_customer_id text UNIQUE, nessie_checking_account_id text UNIQUE, backboard_assistant_id text UNIQUE,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.user_preferences (
 user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE, key text NOT NULL, value text NOT NULL,
 PRIMARY KEY(user_id,key)
);
CREATE TABLE IF NOT EXISTS public.auth_rate_limits (
 key_hash text PRIMARY KEY, attempts integer NOT NULL, resets_at timestamptz NOT NULL
);
-- Retain cleanup bounds if a Timescale refresh fails; deletion can safely resume.
CREATE TABLE IF NOT EXISTS public.account_deletion_requests (
 user_id uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
 history_start timestamptz, history_finish timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
