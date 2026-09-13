import type { PoolConfig } from 'pg';

/** Shared server/migration configuration; always verifies certificate and hostname. */
export function tigerPoolConfig(env: Record<string, string | undefined> = process.env): PoolConfig | undefined {
  const raw = env.DATABASE_URL || env.TIGER_DATABASE_URL;
  if (!raw) return undefined;
  const url = new URL(raw);
  url.searchParams.set('sslmode', 'verify-full');
  url.searchParams.delete('uselibpqcompat');
  if (env.TIGER_CA_CERT_PATH) url.searchParams.set('sslrootcert', env.TIGER_CA_CERT_PATH);
  return { connectionString: url.toString(), max: 4, connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 10_000, statement_timeout: 10_000 };
}
