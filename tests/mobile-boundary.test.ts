import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { z } from "zod";

const require = createRequire(import.meta.url);
type Resolution = { type: "sourceFile"; filePath: string };
type Context = {
  originModulePath: string;
  resolveRequest: (
    context: Context,
    name: string,
    platform: string,
  ) => Resolution;
};
const config: {
  resolver: {
    resolveRequest: (
      context: Context,
      name: string,
      platform: string,
    ) => Resolution;
  };
} = require("../metro.config.js");

test("Expo routes are isolated from the Next.js app directory", () => {
  const app = z
    .object({
      plugins: z.array(
        z.union([
          z.string(),
          z.tuple([z.string(), z.record(z.string(), z.unknown())]),
        ]),
      ),
    })
    .parse(JSON.parse(readFileSync("app.json", "utf8")));
  const router = app.plugins.find(
    (plugin) => Array.isArray(plugin) && plugin[0] === "expo-router",
  );
  assert.ok(Array.isArray(router));
  assert.equal(router[1].root, "./mobile/app");
  assert.ok(existsSync("mobile/app/_layout.tsx"));
  assert.ok(existsSync("mobile/app/(app)/index.tsx"));
  assert.equal(
    existsSync("app"),
    false,
    "A root app directory would shadow Next.js src/app",
  );
});

for (const platform of ["ios", "android", "web"]) {
  test(`Metro rejects backend dependencies including aliases and barrels on ${platform}`, () => {
    const context: Context = {
      originModulePath: path.resolve("mobile/app/(app)/index.tsx"),
      resolveRequest: () => ({
        type: "sourceFile",
        filePath: path.resolve("src/lib/display.ts"),
      }),
    };
    for (const name of [
      "node:crypto",
      "crypto",
      "fs",
      "fs/promises",
      "path",
      "http",
      "stream",
      "pg",
      "pg/lib/index.js",
      "postgres",
      "argon2",
      "backboard-sdk",
      "next/link",
      "server-only",
    ]) {
      assert.throws(
        () => config.resolver.resolveRequest(context, name, platform),
        /Call the backend \/api endpoint/,
      );
    }
    for (const file of [
      "src/app/api/analyze/route.ts",
      "src/lib/server/request.ts",
      "src/lib/server/auth/crypto.ts",
      "src/lib/server/dashboard.ts",
      "src/lib/integrations/index.ts",
      "src/lib/integrations/gemini.ts",
      "src/lib/integrations/backboard.ts",
      "src/lib/integrations/financial.ts",
      "src/lib/nessie/client.ts",
      "src/lib/nessie/provider.ts",
      "src/lib/financial-providers/schedule.ts",
      "src/lib/integrations/tiger.ts",
      "database/query.ts",
      "db/query.ts",
      "node_modules/pg/lib/index.js",
    ]) {
      context.resolveRequest = () => ({
        type: "sourceFile",
        filePath: path.resolve(file),
      });
      assert.throws(
        () =>
          config.resolver.resolveRequest(
            context,
            "@/alias-or-barrel",
            platform,
          ),
        /Expo client cannot import server-only module/,
      );
    }
    for (const file of [
      "src/lib/finance/index.ts",
      "src/lib/display.ts",
      "src/types/api.ts",
      "src/data/demo-profile.ts",
      "mobile/app/(app)/index.tsx",
      "node_modules/react/index.js",
    ]) {
      const resolution: Resolution = {
        type: "sourceFile",
        filePath: path.resolve(file),
      };
      context.resolveRequest = () => resolution;
      assert.equal(
        config.resolver.resolveRequest(context, "@/shared", platform),
        resolution,
      );
    }
  });
}

test("mobile web fonts use the browser-safe context without permitting Node imports", () => {
  const originModulePath = path.resolve(
    "node_modules/expo-font/build/server.js",
  );
  const context: Context = {
    originModulePath,
    resolveRequest: () => ({ type: "sourceFile", filePath: "default" }),
  };
  assert.equal(
    config.resolver.resolveRequest(context, "./serverContext", "web").filePath,
    path.resolve("node_modules/expo-font/build/serverContext.js"),
  );
  assert.equal(
    config.resolver.resolveRequest(context, "./serverContext", "ios").filePath,
    "default",
  );
  assert.throws(
    () => config.resolver.resolveRequest(context, "node:async_hooks", "web"),
    /Call the backend/,
  );
});
