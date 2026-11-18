"use strict";

/*
 * Omniroute integration helpers.
 *
 * The app runs its own Omniroute instance from an app-owned copy of the
 * Omniroute data directory. Credentials never enter the repository: the copy
 * lives under the app's private data folder, and snapshot refreshes are staged
 * there for the next launch.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const isWindows = process.platform === "win32";

function isFile(file) {
  try {
    return fs.statSync(file).isFile();
  } catch (_) {
    return false;
  }
}

function isDirectory(dir) {
  try {
    return fs.statSync(dir).isDirectory();
  } catch (_) {
    return false;
  }
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function versionDirs(root) {
  if (!isDirectory(root)) return [];
  try {
    return fs.readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  } catch (_) {
    return [];
  }
}

function cliCandidates() {
  const candidates = [];
  const add = (value) => { if (value) candidates.push(value); };
  const binName = isWindows ? "omniroute.cmd" : "omniroute";
  const mjsName = "omniroute.mjs";

  add(process.env.OMNIROUTE_BIN);

  if (process.resourcesPath) {
    add(path.join(process.resourcesPath, "omniroute-runtime", "lib", "node_modules", "omniroute", "bin", mjsName));
    add(path.join(process.resourcesPath, "omniroute", "bin", mjsName));
    add(path.join(process.resourcesPath, "omniroute", "bin", binName));
    add(path.join(process.resourcesPath, "omniroute", binName));
  }

  // Local desktop builds (`npm run dist:dir`) keep the runtime in build/.
  add(path.join(__dirname, "..", "build", "omniroute-runtime", "lib", "node_modules", "omniroute", "bin", mjsName));

  for (const dir of String(process.env.PATH || "").split(path.delimiter)) {
    if (dir) add(path.join(dir, binName));
  }

  const home = os.homedir();
  const miseNode = path.join(home, ".local", "share", "mise", "installs", "node");
  for (const version of versionDirs(miseNode)) {
    add(path.join(miseNode, version, "bin", binName));
    add(path.join(miseNode, version, "lib", "node_modules", "omniroute", "bin", mjsName));
  }
  for (const version of versionDirs(path.join(home, ".nvm", "versions", "node"))) {
    add(path.join(home, ".nvm", "versions", "node", version, "bin", binName));
  }

  add(path.join(home, ".local", "bin", binName));
  add(path.join(home, ".bun", "bin", binName));
  add(path.join("/usr/local/bin", binName));
  add(path.join("/opt/homebrew/bin", binName));
  add(path.join("/usr/bin", binName));

  const npmRoots = [
    path.join(home, ".npm-global", "lib", "node_modules"),
    "/usr/local/lib/node_modules",
    "/usr/lib/node_modules",
    "/opt/homebrew/lib/node_modules",
  ];
  if (isWindows) {
    const npmPrefix = process.env.APPDATA
      ? path.join(process.env.APPDATA, "npm")
      : path.join(home, "AppData", "Roaming", "npm");
    add(path.join(npmPrefix, binName));
    add(path.join(npmPrefix, "node_modules", "omniroute", "bin", mjsName));
  }
  for (const root of npmRoots) {
    add(path.join(root, "omniroute", "bin", mjsName));
    add(path.join(root, "omniroute", "bin", "omniroute"));
  }

  return unique(candidates);
}

function findCli() {
  for (const candidate of cliCandidates()) {
    if (!isFile(candidate)) continue;
    try {
      return fs.realpathSync(candidate);
    } catch (_) {
      return candidate;
    }
  }
  return null;
}

function cliRunner(cli) {
  if (isWindows && /\.cmd$/i.test(cli)) {
    return {
      command: process.env.ComSpec || "cmd.exe",
      prefix: ["/d", "/s", "/c", `"${cli}"`],
      env: {},
    };
  }
  if (/\.(?:mjs|cjs|js)$/i.test(cli)) {
    // In Electron, process.execPath is the app binary. ELECTRON_RUN_AS_NODE
    // makes it a Node runtime for both the CLI and the server it spawns.
    return {
      command: process.execPath,
      prefix: [cli],
      env: { ELECTRON_RUN_AS_NODE: "1" },
    };
  }
  return { command: cli, prefix: [], env: {} };
}

function runCli(cli, args, options = {}) {
  const runner = cliRunner(cli);
  return spawnSync(runner.command, [...runner.prefix, ...args], {
    cwd: options.cwd,
    env: { ...process.env, ...runner.env, ...(options.env || {}) },
    encoding: "utf8",
    windowsHide: true,
    timeout: options.timeout || 120_000,
    maxBuffer: 10 * 1024 * 1024,
  });
}

function stripAnsi(value) {
  return String(value || "").replace(/\u001b\[[0-9;]*m/g, "");
}

function stageSnapshot({ source, destination, cli = findCli(), timeout = 120_000 }) {
  source = path.resolve(source);
  destination = path.resolve(destination);
  if (!cli) {
    throw new Error("Omniroute was not found. Install it or set OMNIROUTE_BIN.");
  }
  if (!isFile(path.join(source, "storage.sqlite"))) {
    throw new Error(`No Omniroute database found at ${source}`);
  }
  if (!isFile(path.join(source, ".env"))) {
    throw new Error(`No Omniroute .env found at ${source}; it contains the storage key.`);
  }

  const name = `shorts-factory-${Date.now()}`;
  const result = runCli(cli, ["backup", "create", "--name", name], {
    env: { DATA_DIR: source },
    timeout,
  });
  if (result.error) throw new Error(`Omniroute backup failed: ${result.error.message}`);
  if (result.status !== 0) {
    const detail = stripAnsi(`${result.stderr || ""}\n${result.stdout || ""}`).trim().split("\n").slice(-3).join(" ");
    throw new Error(`Omniroute backup failed${detail ? `: ${detail}` : ""}`);
  }

  const output = stripAnsi(`${result.stdout || ""}\n${result.stderr || ""}`);
  const match = output.match(/Backup saved to\s+(.+?)\s*$/m);
  const fallback = path.join(source, "backups", `omniroute-backup-${name}`);
  const backupDir = match ? match[1].trim() : fallback;
  if (!isFile(path.join(backupDir, "storage.sqlite"))) {
    throw new Error("Omniroute completed the backup but its database copy was not found.");
  }
  // The backup command writes plaintext data. Restrict it immediately and
  // remove it after copying.
  try {
    fs.chmodSync(backupDir, 0o700);
    fs.chmodSync(path.join(backupDir, "storage.sqlite"), 0o600);
  } catch (_) { /* Windows */ }

  const temp = `${destination}.tmp-${process.pid}`;
  fs.rmSync(temp, { recursive: true, force: true });
  fs.mkdirSync(temp, { recursive: true, mode: 0o700 });
  const privateFile = (file) => {
    try { fs.chmodSync(file, 0o600); } catch (_) { /* Windows */ }
  };
  try {
    fs.copyFileSync(path.join(backupDir, "storage.sqlite"), path.join(temp, "storage.sqlite"));
    privateFile(path.join(temp, "storage.sqlite"));
    if (isFile(path.join(backupDir, "backup-info.json"))) {
      fs.copyFileSync(path.join(backupDir, "backup-info.json"), path.join(temp, "backup-info.json"));
      privateFile(path.join(temp, "backup-info.json"));
    }
    fs.copyFileSync(path.join(source, ".env"), path.join(temp, ".env"));
    privateFile(path.join(temp, ".env"));
    fs.writeFileSync(
      path.join(temp, "snapshot.json"),
      `${JSON.stringify({
        created_at: new Date().toISOString(),
        source,
        omniroute: "Omniroute",
      }, null, 2)}\n`,
      { mode: 0o600 }
    );
    privateFile(path.join(temp, "snapshot.json"));
    const bytes = fs.statSync(path.join(temp, "storage.sqlite")).size;

    fs.rmSync(destination, { recursive: true, force: true });
    fs.renameSync(temp, destination);
    try { fs.chmodSync(destination, 0o700); } catch (_) { /* Windows */ }

    // The source backup was only a consistent copy for us; remove it so the
    // user's Omniroute backup folder is not polluted with app snapshots.
    try {
      if (path.dirname(backupDir) === path.join(source, "backups")) {
        fs.rmSync(backupDir, { recursive: true, force: true });
      }
    } catch (_) { /* best effort */ }

    return { destination, bytes };
  } catch (err) {
    fs.rmSync(temp, { recursive: true, force: true });
    throw err;
  }
}

function hasSnapshot(dir) {
  return isFile(path.join(dir, "storage.sqlite")) && isFile(path.join(dir, ".env"));
}

function activatePending(root) {
  const pending = path.join(root, "pending");
  const current = path.join(root, "current");
  if (!hasSnapshot(pending)) return false;

  const previous = path.join(root, "previous");
  fs.rmSync(previous, { recursive: true, force: true });
  if (isDirectory(current)) fs.renameSync(current, previous);
  fs.renameSync(pending, current);
  try { fs.chmodSync(current, 0o700); } catch (_) { /* Windows */ }
  return true;
}

function seedFromSource(root, source) {
  const current = path.join(root, "current");
  if (hasSnapshot(current)) return false;
  source = path.resolve(source || defaultSourceDir());
  if (!isFile(path.join(source, "storage.sqlite"))) return false;
  if (path.resolve(current) === source) return false;

  const pending = path.join(root, "pending");
  fs.rmSync(pending, { recursive: true, force: true });
  stageSnapshot({ source, destination: pending });
  return activatePending(root);
}

function defaultSourceDir() {
  if (process.env.OMNIROUTE_DATA_DIR) return path.resolve(process.env.OMNIROUTE_DATA_DIR);
  const legacy = path.join(os.homedir(), ".omniroute");
  if (isFile(path.join(legacy, "storage.sqlite"))) return legacy;
  if (isWindows) {
    // Omniroute uses %APPDATA%\omniroute when the legacy dot-folder is absent.
    return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "omniroute");
  }
  return legacy;
}

function defaultAppDataDir() {
  if (process.env.SF_DATA_DIR) return path.resolve(process.env.SF_DATA_DIR);
  if (isWindows) {
    return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "shorts-factory");
  }
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "shorts-factory");
  }
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "shorts-factory");
}

function snapshotRoot(appData = defaultAppDataDir()) {
  return path.join(path.resolve(appData), "data", "omniroute");
}

module.exports = {
  findCli,
  cliRunner,
  runCli,
  stageSnapshot,
  activatePending,
  seedFromSource,
  hasSnapshot,
  defaultSourceDir,
  defaultAppDataDir,
  snapshotRoot,
  isFile,
  isDirectory,
};
