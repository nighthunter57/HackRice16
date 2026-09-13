import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
export default defineConfig([...nextVitals, ...nextTs,
  // The systemd bootstrap is explicitly CommonJS and loads runtime config before Next.
  {files:["deploy/start-backend.cjs"],rules:{"@typescript-eslint/no-require-imports":"off"}},
  globalIgnores([".next/**", "next-env.d.ts"])]);
