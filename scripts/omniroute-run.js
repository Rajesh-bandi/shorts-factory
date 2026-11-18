#!/usr/bin/env node
"use strict";

/*
 * Start the built-in Omniroute instance for `./run.sh` (the browser entry
 * point). It uses the same app-owned snapshot and loopback port as the desktop
 * shell, and forwards termination to the whole Omniroute process group.
 */

const fs = require("fs");
const http = require("http");
const path = require("path");
const { spawn } = require("child_process");
const omniroute = require("../electron/omniroute");

const isWindows = process.platform === "win32";
const port = Number(process.env.SF_OMNIROUTE_PORT) || 20129;
const dataDir = process.env.SF_DATA_DIR
  ? path.resolve(process.env.SF_DATA_DIR)
  : path.resolve(__dirname, "..", "data");
const root = path.join(dataDir, "omniroute");
let child = null;
let stopping = false;
let wrotePid = false;

function probe() {
  return new Promise((resolve) => {
    const req = http.get(
      { host: "127.0.0.1", port, path: "/api/health", timeout: 900 },
      (res) => {
        res.resume();
        res.on("end", () => resolve(res.statusCode === 200));
      }
    );
    req.on("timeout", () => { req.destroy(); resolve(false); });
    req.on("error", () => resolve(false));
  });
}

function stopChild() {
  if (stopping) return;
  stopping = true;
  if (!child) return;
  try {
    if (isWindows) {
      spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    } else {
      process.kill(-child.pid, "SIGTERM");
    }
  } catch (_) { /* already gone */ }
  setTimeout(() => process.exit(0), 300).unref();
}

async function main() {
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(root, 0o700); } catch (_) { /* Windows */ }
  const pending = path.join(root, "pending");
  if (await probe()) {
    if (!omniroute.hasSnapshot(pending)) {
      console.log(`[omniroute] using already-running instance on ${port}`);
      return;
    }
    // Stop only the instance this runner recorded, then apply the snapshot.
    const pidFile = path.join(root, "omniroute.pid");
    let previousPid = 0;
    try { previousPid = Number(fs.readFileSync(pidFile, "utf8").trim()) || 0; } catch (_) { /* none */ }
    if (previousPid) {
      try { process.kill(-previousPid, "SIGTERM"); } catch (_) { /* already gone */ }
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline && await probe()) await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (await probe()) {
      console.error("[omniroute] port is occupied by an instance this runner does not own; snapshot left pending");
      return;
    }
  }
  if (omniroute.hasSnapshot(pending)) omniroute.activatePending(root);

  const current = path.join(root, "current");
  if (!omniroute.hasSnapshot(current)) {
    try {
      if (omniroute.seedFromSource(root, omniroute.defaultSourceDir())) {
        console.log(`[omniroute] seeded app data from ${omniroute.defaultSourceDir()}`);
      }
    } catch (err) {
      console.error(`[omniroute] seed failed: ${err.message}`);
    }
  }
  if (!omniroute.hasSnapshot(current)) {
    console.error("[omniroute] no login snapshot is available; built-in AI is offline");
    process.exitCode = 1;
    return;
  }

  const cli = omniroute.findCli();
  if (!cli) {
    console.error("[omniroute] CLI not found; install Omniroute or set OMNIROUTE_BIN");
    process.exitCode = 1;
    return;
  }

  const runner = omniroute.cliRunner(cli);
  const args = [
    ...runner.prefix,
    "serve",
    "--headless",
    "--no-open",
    "--no-tray",
    "--no-recovery",
    "--port",
    String(port),
  ];
  const env = {
    ...process.env,
    ...runner.env,
    DATA_DIR: current,
    PORT: String(port),
    HOSTNAME: "127.0.0.1",
    OMNIROUTE_SERVER_HOST: "127.0.0.1",
    REQUIRE_API_KEY: "false",
    OMNIROUTE_HEADLESS: "1",
    OMNIROUTE_READY_TIMEOUT_MS: "60000",
  };
  child = spawn(runner.command, args, {
    cwd: current,
    env,
    windowsHide: true,
    detached: !isWindows,
    stdio: "inherit",
  });
  if (child.pid) {
    try {
      fs.writeFileSync(path.join(root, "omniroute.pid"), String(child.pid), { mode: 0o600 });
      wrotePid = true;
    } catch (_) { /* best effort */ }
  }
  child.on("error", (err) => {
    console.error(`[omniroute] failed to start: ${err.message}`);
    process.exitCode = 1;
  });
  child.on("exit", (code, signal) => {
    child = null;
    if (!stopping) process.exitCode = code || (signal ? 1 : 0);
  });
  console.log(`[omniroute] starting on 127.0.0.1:${port}`);
}

process.on("SIGINT", stopChild);
process.on("SIGTERM", stopChild);
process.on("exit", () => {
  if (!wrotePid) return;
  try { fs.rmSync(path.join(root, "omniroute.pid"), { force: true }); } catch (_) { /* ignore */ }
});

main().catch((err) => {
  console.error(`[omniroute] ${err.message || err}`);
  process.exitCode = 1;
});
