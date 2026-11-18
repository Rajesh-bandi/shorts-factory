#!/usr/bin/env node
"use strict";

/*
 * Stage a fresh snapshot of the local Omniroute login for Shorts Factory.
 *
 * Log in or repair the account in the local Omniroute dashboard first, then run
 * `npm run omniroute:snapshot`. The snapshot is written to the app's private
 * data directory and activated the next time Shorts Factory starts. It is never
 * written into the repository or a release asset.
 */

const fs = require("fs");
const path = require("path");
const {
  findCli,
  stageSnapshot,
  defaultSourceDir,
  defaultAppDataDir,
} = require("../electron/omniroute");

function usage() {
  console.log(`Usage: node scripts/omniroute-snapshot.js [options]

  --source <dir>    Omniroute data directory (default: ~/.omniroute)
  --app-data <dir>  Shorts Factory app-data directory
  --dest <dir>      Explicit destination (default: <app-data>/data/omniroute/pending)
  --help            Show this help

The snapshot contains provider credentials and the Omniroute storage key.
It stays in the app's private data folder with owner-only permissions.`);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") out.help = true;
    else if (arg === "--source") out.source = argv[++i];
    else if (arg === "--app-data") out.appData = argv[++i];
    else if (arg === "--dest") out.dest = argv[++i];
    else if (arg.startsWith("--source=")) out.source = arg.slice("--source=".length);
    else if (arg.startsWith("--app-data=")) out.appData = arg.slice("--app-data=".length);
    else if (arg.startsWith("--dest=")) out.dest = arg.slice("--dest=".length);
    else throw new Error(`Unknown option: ${arg}`);
  }
  return out;
}

function formatBytes(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}

function defaultDataDir() {
  if (process.env.SF_DATA_DIR) return path.resolve(process.env.SF_DATA_DIR);
  // Prefer an installed app's data once it exists. Otherwise fall back to the
  // source checkout used for development.
  const installed = path.join(defaultAppDataDir(), "data");
  if (fs.existsSync(path.join(installed, "shorts.db"))) return installed;
  const repoData = path.resolve(__dirname, "..", "data");
  if (fs.existsSync(path.join(repoData, "shorts.db"))) return repoData;
  return installed;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    return;
  }

  const source = path.resolve(args.source || defaultSourceDir());
  const dataDir = args.appData ? path.join(path.resolve(args.appData), "data") : defaultDataDir();
  const destination = args.dest
    ? path.resolve(args.dest)
    : path.join(dataDir, "omniroute", "pending");
  const cli = findCli();
  if (!cli) {
    throw new Error("Omniroute was not found. Install Omniroute or set OMNIROUTE_BIN.");
  }

  console.log(`[omniroute] source      ${source}`);
  console.log(`[omniroute] destination ${destination}`);
  const result = stageSnapshot({ source, destination, cli });
  console.log(`[omniroute] staged ${formatBytes(result.bytes)}`);
  console.log("[omniroute] Restart Shorts Factory to activate the refreshed login.");
}

try {
  main();
} catch (err) {
  console.error(`[omniroute] ${err.message || err}`);
  process.exitCode = 1;
}
