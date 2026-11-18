#!/usr/bin/env node
"use strict";

/*
 * Vendor the built-in Omniroute runtime.
 *
 * Friends should not have to install Node.js or the omniroute CLI. This step
 * installs the pinned package into build/omniroute-runtime with production
 * dependencies only, drops dashboard/docs payloads that headless mode never
 * serves, and checks that no credential file slipped into the bundle.
 *
 * The runtime is started with Electron's bundled Node (ELECTRON_RUN_AS_NODE),
 * so no separate Node installation is packaged.
 */

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const build = path.join(root, "build");
const target = path.join(build, "omniroute-runtime");
// electron-builder's extraResources filter skips a *root* node_modules, so the
// runtime lives one level down. Node resolves dependencies normally from here.
const prefix = path.join(target, "lib");
const nodeModules = path.join(prefix, "node_modules");
const packageDir = path.join(nodeModules, "omniroute");
const cli = path.join(packageDir, "bin", "omniroute.mjs");
const stampPath = path.join(target, ".runtime.json");
const isWindows = process.platform === "win32";

const VERSION = process.env.OMNIROUTE_RUNTIME_VERSION || "3.8.53";

// `--omit=optional` keeps the bundle small, but esbuild and SWC resolve their
// native helper packages through optionalDependencies. Install only the ones
// for the machine doing the build; CI builds each installer on its own OS.
const NATIVE = {
  "linux-x64": ["@esbuild/linux-x64", "@swc/core-linux-x64-gnu"],
  "linux-arm64": ["@esbuild/linux-arm64", "@swc/core-linux-arm64-gnu"],
  "darwin-x64": ["@esbuild/darwin-x64", "@swc/core-darwin-x64"],
  "darwin-arm64": ["@esbuild/darwin-arm64", "@swc/core-darwin-arm64"],
  "win32-x64": ["@esbuild/win32-x64", "@swc/core-win32-x64-msvc"],
  "win32-arm64": ["@esbuild/win32-arm64", "@swc/core-win32-arm64-msvc"],
};

// Verified against `serve --headless` on Electron's Node. These are dashboard
// and documentation payloads; the headless API server does not serve them.
const PRUNE = [
  "omniroute/dist/docs",
  "monaco-editor",
  "antd",
  "@ant-design",
  "@lobehub",
  "@emoji-mart",
  "mermaid",
  "lucide-react",
  "recharts",
  "fumadocs-core",
  "fumadocs-ui",
  "katex",
  "@dnd-kit",
  "@base-ui",
  "@rc-component",
  "@shikijs",
  "@mermaid-js",
  "cytoscape-fcose",
];

function fail(message) {
  console.error(`\n[omniroute-runtime] ${message}\n`);
  process.exit(1);
}

function log(message) {
  console.log(`[omniroute-runtime] ${message}`);
}

function stamp() {
  try {
    return JSON.parse(fs.readFileSync(stampPath, "utf8"));
  } catch (_) {
    return null;
  }
}

function packageVersion(name) {
  try {
    return JSON.parse(fs.readFileSync(path.join(nodeModules, name, "package.json"), "utf8")).version;
  } catch (_) {
    return "";
  }
}

function runNpm(args) {
  const result = spawnSync("npm", args, {
    cwd: root,
    stdio: "inherit",
    shell: isWindows,
    env: { ...process.env, npm_config_update_notifier: "false" },
  });
  if (result.error) fail(`npm could not run: ${result.error.message}`);
  if (result.status !== 0) fail(`npm exited with status ${result.status}`);
}

function hasCredentials(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (_) {
    return false;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      if (hasCredentials(full)) return true;
      continue;
    }
    if (entry.name !== ".env") continue;
    try {
      if (/^\s*STORAGE_ENCRYPTION_KEY\s*=\s*\S+/m.test(fs.readFileSync(full, "utf8"))) {
        return true;
      }
    } catch (_) {
      // Unreadable files are not credentials we can prove are absent.
      return true;
    }
  }
  return false;
}

function main() {
  const current = stamp();
  if (
    current
    && current.version === VERSION
    && current.platform === process.platform
    && current.arch === process.arch
    && fs.existsSync(cli)
    && process.env.SF_FORCE_OMNIROUTE_RUNTIME !== "1"
  ) {
    log(`using cached runtime ${VERSION} (${process.platform}/${process.arch})`);
    return;
  }

  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(prefix, { recursive: true });

  log(`installing omniroute@${VERSION}`);
  runNpm([
    "install",
    "--prefix", prefix,
    "--omit=optional",
    "--omit=dev",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    "--loglevel=error",
    `omniroute@${VERSION}`,
  ]);

  if (!fs.existsSync(cli)) fail("Omniroute installed without bin/omniroute.mjs");

  const native = NATIVE[`${process.platform}-${process.arch}`] || [];
  const esbuild = packageVersion("esbuild");
  const swc = packageVersion("@swc/core");
  const pinned = [];
  if (esbuild && native[0]) pinned.push(`${native[0]}@${esbuild}`);
  if (swc && native[1]) pinned.push(`${native[1]}@${swc}`);
  if (pinned.length) {
    log(`adding native helpers ${pinned.join(", ")}`);
    runNpm([
      "install",
      "--prefix", prefix,
      "--no-save",
      "--omit=optional",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--loglevel=error",
      ...pinned,
    ]);
  }

  for (const name of PRUNE) {
    fs.rmSync(path.join(nodeModules, name), { recursive: true, force: true });
  }
  fs.rmSync(path.join(nodeModules, ".bin"), { recursive: true, force: true });
  // Dependency fixture, not runtime configuration. Keep the bundle free of
  // stray .env files so a credential scan never has to make an exception.
  fs.rmSync(path.join(nodeModules, "bottleneck", ".env"), { force: true });
  fs.rmSync(path.join(prefix, "package-lock.json"), { force: true });

  const packageEnv = [path.join(packageDir, ".env"), path.join(packageDir, "dist", ".env")];
  if (packageEnv.some((file) => fs.existsSync(file)) || hasCredentials(target)) {
    fail("a credential .env file was found in the runtime bundle");
  }

  fs.writeFileSync(
    stampPath,
    `${JSON.stringify({
      version: VERSION,
      platform: process.platform,
      arch: process.arch,
      built_at: new Date().toISOString(),
    }, null, 2)}\n`
  );

  const license = path.join(packageDir, "LICENSE");
  if (fs.existsSync(license)) log("Omniroute license included");
  log(`runtime ready at ${path.relative(root, target)}`);
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    fail(err.stack || String(err));
  }
}

module.exports = { main, VERSION };
