#!/usr/bin/env node
"use strict";

/*
 * Prepare the desktop bundle:
 *   1. freeze the FastAPI backend with PyInstaller (onedir)
 *   2. copy self-contained ffmpeg / ffprobe next to it
 *   3. cache a standalone yt-dlp binary
 *
 * Run through `npm run prepare:desktop`. Builds are platform-specific: run it
 * on the OS you want to package for (Linux AppImage, Windows NSIS, macOS DMG).
 */

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const build = path.join(root, "build");
const out = path.join(build, "backend");
const bin = path.join(build, "bin");
const cache = path.join(build, "cache");
const isWindows = process.platform === "win32";
const isMac = process.platform === "darwin";

function fail(message) {
  console.error(`\n[build] ${message}\n`);
  process.exit(1);
}

function python() {
  if (process.env.SF_PYTHON) return process.env.SF_PYTHON;
  const venv = isWindows
    ? path.join(root, ".venv", "Scripts", "python.exe")
    : path.join(root, ".venv", "bin", "python");
  if (fs.existsSync(venv)) return venv;
  return isWindows ? "python" : "python3";
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit", ...options });
  if (result.error) fail(`${command} could not run: ${result.error.message}`);
  if (result.status !== 0) fail(`${command} exited with status ${result.status}`);
}

function copyBinary(source, destination) {
  if (!source || !fs.existsSync(source)) fail(`Missing binary: ${source}`);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
  if (!isWindows) fs.chmodSync(destination, 0o755);
  const size = fs.statSync(destination).size;
  console.log(`[build] ${path.basename(destination)} (${(size / 1048576).toFixed(1)} MB)`);
}

async function ytdlp() {
  const name = isWindows
    ? "yt-dlp.exe"
    : isMac
      ? "yt-dlp_macos"
      : process.arch === "arm64"
        ? "yt-dlp_linux_aarch64"
        : "yt-dlp_linux";
  const destination = path.join(bin, isWindows ? "yt-dlp.exe" : "yt-dlp");
  if (fs.existsSync(destination) && fs.statSync(destination).size > 1_000_000) return;
  const cached = path.join(cache, name);
  if (!fs.existsSync(cached) || fs.statSync(cached).size < 1_000_000) {
    fs.mkdirSync(cache, { recursive: true });
    const url = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${name}`;
    console.log(`[build] downloading ${url}`);
    const res = await fetch(url, { redirect: "follow" });
    if (!res.ok) fail(`yt-dlp download failed: HTTP ${res.status}`);
    const data = Buffer.from(await res.arrayBuffer());
    if (data.length < 1_000_000) fail("yt-dlp download looked incomplete");
    fs.writeFileSync(cached, data);
  }
  copyBinary(cached, destination);
}

async function main() {
  const py = python();
  const version = spawnSync(py, ["-m", "PyInstaller", "--version"], { cwd: root, encoding: "utf8" });
  if (version.status !== 0) {
    fail("PyInstaller is not installed. Run: .venv/bin/pip install pyinstaller (or python -m pip install pyinstaller)");
  }

  const separator = isWindows ? ";" : ":";
  console.log(`[build] freezing backend with ${py}`);
  const googleDir = spawnSync(
    py,
    ["-c", "import googleapiclient, os; print(os.path.dirname(googleapiclient.__file__))"],
    { cwd: root, encoding: "utf8" }
  ).stdout.trim();
  const googleDocs = ["youtube.v3.json", "youtubeAnalytics.v2.json"].map((name) =>
    `${path.join(googleDir, "discovery_cache", "documents", name)}${separator}googleapiclient/discovery_cache/documents`
  );
  fs.rmSync(out, { recursive: true, force: true });
  fs.rmSync(path.join(build, "pyinstaller"), { recursive: true, force: true });
  fs.mkdirSync(build, { recursive: true });

  const args = [
    "-m", "PyInstaller",
    "--noconfirm",
    "--clean",
    "--onedir",
    "--name", "shorts-factory-backend",
    "--distpath", path.join(root, "dist", "desktop"),
    "--workpath", path.join(build, "pyinstaller"),
    "--specpath", build,
    "--add-data", `${path.join(root, "frontend")}${separator}frontend`,
    ...googleDocs.flatMap((entry) => ["--add-data", entry]),
    "--collect-all", "yt_dlp",
    "--collect-all", "faster_whisper",
    "--collect-all", "ctranslate2",
    "--collect-submodules", "uvicorn",
    "--hidden-import", "uvicorn.logging",
    "--hidden-import", "uvicorn.loops.auto",
    "--hidden-import", "uvicorn.protocols.http.auto",
    "--hidden-import", "uvicorn.protocols.websockets.auto",
    "--hidden-import", "uvicorn.lifespan.on",
    "--exclude-module", "nvidia",
    "--exclude-module", "psycopg",
    "--exclude-module", "psycopg_binary",
    "--exclude-module", "triton",
    "--exclude-module", "torch",
    "--exclude-module", "matplotlib",
    "--exclude-module", "IPython",
    "--exclude-module", "pytest",
    path.join(root, "desktop_entry.py"),
  ];
  run(py, args, { env: { ...process.env, PYTHONUTF8: "1" } });

  const frozen = path.join(root, "dist", "desktop", "shorts-factory-backend");
  if (!fs.existsSync(frozen)) fail("PyInstaller did not produce a backend folder");
  // PyInstaller's googleapiclient hook pulls every Google API discovery
  // document (100+ MB). The app only needs YouTube Data and Analytics.
  const discovery = path.join(frozen, "_internal", "googleapiclient", "discovery_cache", "documents");
  if (fs.existsSync(discovery)) {
    for (const file of fs.readdirSync(discovery)) {
      if (file !== "youtube.v3.json" && file !== "youtubeAnalytics.v2.json") {
        fs.rmSync(path.join(discovery, file), { force: true });
      }
    }
    console.log(`[build] pruned Google discovery cache -> ${path.basename(discovery)}`);
  }
  fs.rmSync(out, { recursive: true, force: true });
  fs.cpSync(frozen, out, { recursive: true });
  console.log(`[build] backend -> ${path.relative(root, out)}`);

  fs.rmSync(bin, { recursive: true, force: true });
  fs.mkdirSync(bin, { recursive: true });
  copyBinary(require("ffmpeg-static"), path.join(bin, isWindows ? "ffmpeg.exe" : "ffmpeg"));
  copyBinary(require("ffprobe-static").path, path.join(bin, isWindows ? "ffprobe.exe" : "ffprobe"));
  await ytdlp();
  console.log("[build] desktop runtime is ready");
}

main().catch((err) => fail(err.stack || String(err)));
