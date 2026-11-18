#!/usr/bin/env node
"use strict";

/*
 * Publish an encrypted Omniroute snapshot to a private GitHub release.
 *
 * The snapshot is staged through Omniroute's backup command, encrypted locally,
 * and uploaded as one rolling release asset. Plaintext never enters the repo or
 * the release. Friends download the asset with their own read-only token.
 */

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const {
  findCli,
  hasSnapshot,
  stageSnapshot,
  defaultSourceDir,
  defaultAppDataDir,
} = require("../electron/omniroute");

const DEFAULT_REPO = "Rajesh-bandi/shorts-factory-omniroute";
const DEFAULT_TAG = "snapshot";
const ASSET_NAME = "omniroute-snapshot.enc";
const MAGIC = Buffer.from("SFOS");
const VERSION = 1;
const SALT_LEN = 16;
const NONCE_LEN = 12;
const SCRYPT_N = 32768;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const MAX_PASSPHRASE_BYTES = 1024;

function usage() {
  console.log(`Usage: node scripts/omniroute-publish.js [options]

  --repo <owner/name>       Private GitHub repo (default: ${DEFAULT_REPO})
  --tag <tag>               Release tag (default: ${DEFAULT_TAG})
  --source <dir>            Omniroute data directory (default: ~/.omniroute)
  --passphrase-file <file>  Passphrase file (default: <app-data>/omniroute-sync-passphrase)
  --out <file>              Write the encrypted bundle instead of uploading
  --no-upload               Same as --out with a temporary path
  --help                    Show this help

The passphrase file is created with owner-only permissions if it does not exist.
The passphrase is never printed. Publish only builds a ciphertext release asset;
plaintext storage.sqlite and .env are never written into the repository.`);
}

function parseArgs(argv) {
  const out = { repo: process.env.OMNIROUTE_SYNC_REPO || DEFAULT_REPO, tag: DEFAULT_TAG };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") out.help = true;
    else if (arg === "--repo") out.repo = argv[++i];
    else if (arg === "--tag") out.tag = argv[++i];
    else if (arg === "--source") out.source = argv[++i];
    else if (arg === "--passphrase-file") out.passphraseFile = argv[++i];
    else if (arg === "--out") out.out = argv[++i];
    else if (arg === "--no-upload") out.noUpload = true;
    else if (arg.startsWith("--repo=")) out.repo = arg.slice("--repo=".length);
    else if (arg.startsWith("--tag=")) out.tag = arg.slice("--tag=".length);
    else if (arg.startsWith("--source=")) out.source = arg.slice("--source=".length);
    else if (arg.startsWith("--passphrase-file=")) out.passphraseFile = arg.slice("--passphrase-file=".length);
    else if (arg.startsWith("--out=")) out.out = arg.slice("--out=".length);
    else throw new Error(`Unknown option: ${arg}`);
  }
  return out;
}

function formatBytes(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}

function privateWrite(file, data) {
  fs.writeFileSync(file, data, { mode: 0o600 });
  try { fs.chmodSync(file, 0o600); } catch (_) { /* Windows */ }
}

function passphraseFrom(args) {
  if (process.env.OMNIROUTE_SYNC_PASSPHRASE) {
    const value = String(process.env.OMNIROUTE_SYNC_PASSPHRASE).trim();
    if (value.length < 12) throw new Error("OMNIROUTE_SYNC_PASSPHRASE must be at least 12 characters.");
    if (Buffer.byteLength(value, "utf8") > MAX_PASSPHRASE_BYTES) {
      throw new Error("OMNIROUTE_SYNC_PASSPHRASE is unexpectedly long.");
    }
    return { value, source: "OMNIROUTE_SYNC_PASSPHRASE" };
  }

  const file = path.resolve(
    args.passphraseFile
      || path.join(defaultAppDataDir(), "omniroute-sync-passphrase")
  );
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  let created = false;
  if (!fs.existsSync(file) || !fs.statSync(file).size) {
    const generated = crypto.randomBytes(48).toString("base64");
    privateWrite(file, generated);
    created = true;
  }
  try { fs.chmodSync(file, 0o600); } catch (_) { /* Windows */ }
  const value = fs.readFileSync(file, "utf8").trim();
  if (value.length < 12) throw new Error("The snapshot passphrase must be at least 12 characters.");
  if (Buffer.byteLength(value, "utf8") > MAX_PASSPHRASE_BYTES) {
    throw new Error("The snapshot passphrase is unexpectedly long.");
  }
  return { value, file, created };
}

function validateRepo(repo) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo || "")) {
    throw new Error("--repo must look like owner/repository.");
  }
  return repo;
}

function encryptBundle(payload, passphrase) {
  const plaintext = Buffer.from(JSON.stringify(payload), "utf8");
  const salt = crypto.randomBytes(SALT_LEN);
  const nonce = crypto.randomBytes(NONCE_LEN);
  const key = crypto.scryptSync(passphrase, salt, 32, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: 128 * 1024 * 1024,
  });
  const cipher = crypto.createCipheriv("aes-256-gcm", key, nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([MAGIC, Buffer.from([VERSION]), salt, nonce, ciphertext, tag]);
}

function gh(args) {
  const result = spawnSync("gh", args, { encoding: "utf8", windowsHide: true });
  if (result.error) {
    throw new Error("GitHub CLI (gh) was not found. Install it or run this from a machine with gh authenticated.");
  }
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || "").trim();
    throw new Error(detail || `gh exited with status ${result.status}`);
  }
  return result.stdout;
}

function ensureRelease(repo, tag) {
  try {
    gh(["release", "view", tag, "-R", repo, "--json", "tagName"]);
  } catch (_) {
    gh([
      "release", "create", tag,
      "-R", repo,
      "--title", "Omniroute snapshot",
      "--notes", "Encrypted Omniroute snapshot. Plaintext credentials are never committed.",
    ]);
  }
}

function uploadAsset(repo, tag, file) {
  ensureRelease(repo, tag);
  gh(["release", "upload", tag, file, "-R", repo, "--clobber"]);
  const raw = gh(["release", "view", tag, "-R", repo, "--json", "assets"]);
  const assets = JSON.parse(raw).assets || [];
  const asset = assets.find((item) => item.name === ASSET_NAME);
  if (!asset) throw new Error("The release upload succeeded but the snapshot asset was not found.");
  return asset;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    return;
  }
  const repo = validateRepo(args.repo);
  const tag = args.tag || DEFAULT_TAG;
  const source = path.resolve(args.source || defaultSourceDir());
  const pass = passphraseFrom(args);
  const cli = findCli();
  if (!cli) throw new Error("Omniroute was not found. Install it or set OMNIROUTE_BIN.");

  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "sf-omni-publish-"));
  const staged = path.join(temp, "snapshot");
  const encryptedPath = args.out
    ? path.resolve(args.out)
    : path.join(temp, ASSET_NAME);
  try {
    fs.chmodSync(temp, 0o700);
    if (args.out) fs.mkdirSync(path.dirname(encryptedPath), { recursive: true, mode: 0o700 });
    console.log(`[omniroute] staging ${source}`);
    const stagedResult = stageSnapshot({ source, destination: staged, cli });
    if (!hasSnapshot(staged)) throw new Error("Omniroute produced an incomplete snapshot.");
    const db = fs.readFileSync(path.join(staged, "storage.sqlite"));
    const env = fs.readFileSync(path.join(staged, ".env"), "utf8");
    if (!db.subarray(0, 16).equals(Buffer.from("SQLite format 3\u0000"))) {
      throw new Error("The staged database is not a SQLite file.");
    }
    if (!env.trim() || !/^STORAGE_ENCRYPTION_KEY=.+$/m.test(env)) {
      throw new Error("The staged snapshot has no STORAGE_ENCRYPTION_KEY.");
    }
    const payload = {
      format: 1,
      created_at: new Date().toISOString(),
      app: "shorts-factory",
      files: {
        "storage.sqlite": db.toString("base64"),
        ".env": env,
      },
    };
    const bundle = encryptBundle(payload, pass.value);
    privateWrite(encryptedPath, bundle);
    console.log(`[omniroute] staged ${formatBytes(stagedResult.bytes)}`);
    console.log(`[omniroute] encrypted ${formatBytes(bundle.length)}`);
    if (pass.created && pass.file) {
      console.log(`[omniroute] generated passphrase file: ${pass.file}`);
    } else if (pass.file) {
      console.log(`[omniroute] passphrase file: ${pass.file}`);
    }

    if (args.noUpload || args.out) {
      console.log(`[omniroute] dry run: wrote ${encryptedPath}`);
      return;
    }

    console.log(`[omniroute] publishing to ${repo} (${tag})`);
    const asset = uploadAsset(repo, tag, encryptedPath);
    console.log(`[omniroute] published asset ${asset.id || "?"} (${formatBytes(Number(asset.size) || bundle.length)})`);
    console.log("[omniroute] friends: enter the repo, their read-only token and the passphrase in Settings → AI → Snapshot sync.");
    console.log("[omniroute] restart Shorts Factory on each friend's machine to apply the staged snapshot.");
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(`[omniroute] ${err.message || err}`);
    process.exitCode = 1;
  }
}

module.exports = { encryptBundle, validateRepo };
