/* eslint-disable @typescript-eslint/no-require-imports -- Metro loads this configuration in Node. */
const { isBuiltin } = require("node:module");
const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
const serverDirectories = [
  "src/app",
  "src/lib/server",
  "src/lib/nessie",
  "src/lib/integrations",
  "src/lib/financial-providers",
  "database",
  "db",
];
const serverPackages =
  /^(?:pg(?:-[^/]+)?|postgres|argon2|backboard-sdk|next|server-only)(?:\/|$)/;

// Check resolved paths as well as package names so aliases and barrels cannot
// bring backend implementations into the Expo client.
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const fail = () => {
    throw new Error(
      `Expo client cannot import server-only module "${moduleName}" from "${context.originModulePath}". Call the backend /api endpoint with fetch instead.`,
    );
  };
  if (
    isBuiltin(moduleName) ||
    moduleName.startsWith("node:") ||
    serverPackages.test(moduleName)
  )
    fail();
  // The mobile web preview does not render fonts on a Node server. Expo 57's
  // web font context imports async_hooks eagerly; use its native/browser-safe
  // no-op context instead, while keeping the Node dependency guard intact.
  if (
    platform === "web" &&
    moduleName === "./serverContext" &&
    context.originModulePath
      .split(path.sep)
      .join("/")
      .includes("/node_modules/expo-font/build/")
  ) {
    return {
      type: "sourceFile",
      filePath: path.join(
        path.dirname(context.originModulePath),
        "serverContext.js",
      ),
    };
  }
  const resolution = context.resolveRequest(context, moduleName, platform);
  if (resolution.type === "sourceFile") {
    const relative = path
      .relative(__dirname, resolution.filePath)
      .split(path.sep)
      .join("/");
    if (
      serverDirectories.some(
        (directory) =>
          relative === directory || relative.startsWith(`${directory}/`),
      )
    )
      fail();
    if (
      /(?:^|\/)node_modules\/(?:pg(?:-[^/]+)?|postgres|argon2|backboard-sdk|next|server-only)\//.test(
        relative,
      )
    )
      fail();
  }
  return resolution;
};

module.exports = config;
