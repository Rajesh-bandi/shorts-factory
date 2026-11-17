"use strict";

const { app, BrowserWindow, Menu, dialog, ipcMain, session, shell } = require("electron");
const fs = require("fs");
const http = require("http");
const path = require("path");
const { spawn } = require("child_process");
const { Readable, Transform } = require("stream");
const { pipeline } = require("stream/promises");

const PORT = Number(process.env.SF_PORT) || 8787;
const APP_URL = `http://127.0.0.1:${PORT}`;
const UPDATE_REPO = "Rajesh-bandi/shorts-factory";
const isWindows = process.platform === "win32";
const isMac = process.platform === "darwin";
const backendName = isWindows ? "shorts-factory-backend.exe" : "shorts-factory-backend";

let mainWindow = null;
let backendProcess = null;
let ownsBackend = false;
let shuttingDown = false;
let backendLog = null;
let updateInstallInProgress = false;

function logPath() {
  const dir = path.join(app.getPath("userData"), "logs");
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, "backend.log");
}

function dataPath() {
  if (process.env.SF_DATA_DIR) return path.resolve(process.env.SF_DATA_DIR);
  if (!app.isPackaged) return path.join(app.getAppPath(), "data");
  return path.join(app.getPath("userData"), "data");
}

function binaryPath() {
  const dir = path.join(process.resourcesPath, "bin");
  return {
    dir,
    ffmpeg: path.join(dir, isWindows ? "ffmpeg.exe" : "ffmpeg"),
    ffprobe: path.join(dir, isWindows ? "ffprobe.exe" : "ffprobe"),
    ytdlp: path.join(dir, isWindows ? "yt-dlp.exe" : "yt-dlp"),
  };
}

function probe() {
  return new Promise((resolve) => {
    const req = http.get(
      { host: "127.0.0.1", port: PORT, path: "/healthz", timeout: 900 },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => { body += chunk; });
        res.on("end", () => {
          let parsed = null;
          try { parsed = JSON.parse(body); } catch (_) { /* not ours */ }
          resolve({ status: res.statusCode, body: parsed });
        });
      }
    );
    req.on("timeout", () => { req.destroy(); resolve(null); });
    req.on("error", () => resolve(null));
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function updateStatus(sender, data) {
  if (sender && !sender.isDestroyed()) sender.send("shorts-desktop:update-status", data);
}

function validateUpdatePayload(payload) {
  if (!payload || typeof payload !== "object") throw new Error("Invalid update request");
  if (process.platform !== "win32" && process.platform !== "linux") {
    throw new Error("Automatic updates are supported on Windows and Linux only");
  }
  const name = String(payload.name || "");
  const assetName = path.basename(name);
  if (!assetName || assetName !== name) throw new Error("Invalid update asset name");
  const expected = process.platform === "win32" ? ".exe" : ".appimage";
  if (!assetName.toLowerCase().endsWith(expected)) throw new Error("Unexpected update file type");

  let url;
  try { url = new URL(String(payload.url || "")); } catch (_) { throw new Error("Invalid update URL"); }
  if (
    url.protocol !== "https:" ||
    url.hostname !== "github.com" ||
    !url.pathname.startsWith(`/${UPDATE_REPO}/releases/download/`)
  ) {
    throw new Error("Update download is not from the official release");
  }
  return { url: url.toString(), assetName, size: Number(payload.size) || 0 };
}

async function downloadUpdate(url, destination, expectedSize, sender) {
  if (typeof fetch !== "function") throw new Error("This Electron version cannot download updates");
  const response = await fetch(url, {
    redirect: "follow",
    headers: { "User-Agent": "Shorts-Factory-Updater" },
  });
  if (!response.ok) throw new Error(`Update download failed (HTTP ${response.status})`);
  if (!response.body) throw new Error("Update download was empty");

  const total = Number(response.headers.get("content-length")) || Number(expectedSize) || 0;
  await fs.promises.mkdir(path.dirname(destination), { recursive: true });
  await fs.promises.rm(destination, { force: true });
  let received = 0;
  let last = 0;
  const meter = new Transform({
    transform(chunk, _encoding, callback) {
      received += chunk.length;
      const now = Date.now();
      if (now - last > 220) {
        last = now;
        updateStatus(sender, {
          state: "downloading",
          received,
          total,
          percent: total ? Math.min(100, Math.round((received / total) * 100)) : null,
        });
      }
      callback(null, chunk);
    },
  });
  try {
    await pipeline(Readable.fromWeb(response.body), meter, fs.createWriteStream(destination));
  } catch (err) {
    await fs.promises.rm(destination, { force: true });
    throw err;
  }
  if (received < 1_000_000) {
    await fs.promises.rm(destination, { force: true });
    throw new Error("Downloaded update is too small to be valid");
  }
  if (expectedSize && Math.abs(received - expectedSize) > 1024) {
    await fs.promises.rm(destination, { force: true });
    throw new Error("Downloaded update is incomplete");
  }
  updateStatus(sender, { state: "downloading", received, total: total || received, percent: 100 });
  return received;
}

async function verifyMagic(file, magic) {
  const handle = await fs.promises.open(file, "r");
  try {
    const found = Buffer.alloc(magic.length);
    await handle.read(found, 0, magic.length, 0);
    return found.equals(Buffer.from(magic));
  } finally {
    await handle.close();
  }
}

async function installLinuxUpdate(sender, update) {
  const target = process.env.APPIMAGE ? path.resolve(process.env.APPIMAGE) : "";
  if (!target) throw new Error("Automatic install is available in the AppImage build only");
  const directory = path.dirname(target);
  await fs.promises.access(directory, fs.constants.W_OK);
  const staged = path.join(directory, `.${path.basename(target)}.update-${process.pid}`);
  try {
    await downloadUpdate(update.url, staged, update.size, sender);
    if (!(await verifyMagic(staged, [0x7f, 0x45, 0x4c, 0x46]))) {
      throw new Error("Downloaded file is not a valid AppImage");
    }
    await fs.promises.chmod(staged, 0o755);
    const backup = `${target}.old`;
    await fs.promises.rm(backup, { force: true });
    await fs.promises.rename(target, backup);
    try {
      await fs.promises.rename(staged, target);
    } catch (err) {
      await fs.promises.rename(backup, target);
      throw err;
    }
    updateStatus(sender, { state: "installing" });
    const script = [
      `while kill -0 ${process.pid} 2>/dev/null; do sleep 0.2; done`,
      `rm -f ${shellQuote(backup)}`,
      `exec ${shellQuote(target)}`,
    ].join("; ");
    const child = spawn("/bin/sh", ["-c", script], { detached: true, stdio: "ignore" });
    child.unref();
    setTimeout(() => app.quit(), 400);
  } catch (err) {
    await fs.promises.rm(staged, { force: true });
    throw err;
  }
}

async function installWindowsUpdate(sender, update) {
  const destination = path.join(
    app.getPath("temp"),
    "shorts-factory-updates",
    `${Date.now()}-${update.assetName}`
  );
  await downloadUpdate(update.url, destination, update.size, sender);
  if (!(await verifyMagic(destination, [0x4d, 0x5a]))) {
    await fs.promises.rm(destination, { force: true });
    throw new Error("Downloaded file is not a Windows installer");
  }
  updateStatus(sender, { state: "installing" });
  const child = spawn(destination, [], { detached: true, stdio: "ignore", windowsHide: false });
  child.on("error", (err) => updateStatus(sender, { state: "error", message: err.message }));
  child.unref();
  setTimeout(() => app.quit(), 550);
}

async function installUpdate(sender, payload) {
  if (updateInstallInProgress) throw new Error("An update is already being installed");
  const update = validateUpdatePayload(payload);
  updateInstallInProgress = true;
  updateStatus(sender, { state: "downloading", received: 0, total: update.size, percent: 0 });
  try {
    if (process.platform === "win32") await installWindowsUpdate(sender, update);
    else await installLinuxUpdate(sender, update);
    return { ok: true };
  } catch (err) {
    updateInstallInProgress = false;
    updateStatus(sender, { state: "error", message: String(err.message || err) });
    throw err;
  }
}

function startBackend() {
  const existing = probe();
  return existing.then(async (running) => {
    if (running) {
      if (running.body && running.body.service === "shorts-factory") return;
      throw new Error(`Port ${PORT} is already used by another application. Close it and relaunch Shorts Factory.`);
    }

    const bin = binaryPath();
    const data = dataPath();
    fs.mkdirSync(data, { recursive: true });
    const packagedBackend = path.join(process.resourcesPath, "backend", backendName);
    const devPython = path.join(app.getAppPath(), ".venv", isWindows ? "Scripts/python.exe" : "bin/python");
    const usePackaged = app.isPackaged && fs.existsSync(packagedBackend);
    let command;
    let args;
    let cwd;

    if (usePackaged) {
      command = packagedBackend;
      args = [];
      cwd = path.dirname(packagedBackend);
    } else {
      command = process.env.SF_PYTHON || (fs.existsSync(devPython) ? devPython : (isWindows ? "python" : "python3"));
      args = ["-m", "uvicorn", "backend.main:app", "--host", "127.0.0.1", "--port", String(PORT)];
      cwd = app.getAppPath();
    }

    const env = {
      ...process.env,
      APP_MODE: "local",
      APP_VERSION: app.getVersion(),
      APP_BASE_URL: APP_URL,
      OAUTH_REDIRECT_URI: `${APP_URL}/api/auth/callback`,
      DATA_DIR: data,
      PORT: String(PORT),
      SERVE_FRONTEND: "true",
      PYTHONUNBUFFERED: "1",
      PATH: `${bin.dir}${path.delimiter}${process.env.PATH || ""}`,
    };
    if (fs.existsSync(bin.ytdlp)) env.YTDLP_BIN = bin.ytdlp;
    if (app.isPackaged) {
      env.HF_HOME = path.join(app.getPath("userData"), "models", "huggingface");
      fs.mkdirSync(env.HF_HOME, { recursive: true });
    }

    fs.mkdirSync(path.dirname(logPath()), { recursive: true });
    backendLog = fs.createWriteStream(logPath(), { flags: "a" });
    backendLog.write(`\n\n[desktop] starting ${command} ${args.join(" ")}\n[desktop] data ${data}\n`);
    backendProcess = spawn(command, args, {
      cwd,
      env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    ownsBackend = true;
    backendProcess.stdout.pipe(backendLog);
    backendProcess.stderr.pipe(backendLog);
    backendProcess.on("error", (err) => {
      if (backendLog) backendLog.write(`[desktop] spawn error: ${err.message}\n`);
    });
    backendProcess.on("exit", (code, signal) => {
      if (backendLog) backendLog.end();
      backendLog = null;
      backendProcess = null;
      ownsBackend = false;
      if (!shuttingDown && mainWindow && !mainWindow.isDestroyed()) {
        dialog.showErrorBox(
          "Shorts Factory backend stopped",
          `The local studio stopped unexpectedly (${signal || code}). See:\n${logPath()}`
        );
        app.quit();
      }
    });

    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
      const health = await probe();
      if (health && health.body && health.body.service === "shorts-factory") return;
      if (!backendProcess) break;
      await sleep(450);
    }
    throw new Error(`The local backend did not start. See:\n${logPath()}`);
  });
}

function appMenu() {
  const template = [
    ...(isMac ? [{ role: "appMenu" }] : []),
    {
      label: "Shorts Factory",
      submenu: [
        { label: "Open data folder", click: () => shell.openPath(dataPath()) },
        { label: "Open logs folder", click: () => shell.openPath(path.dirname(logPath())) },
        { type: "separator" },
        { role: isMac ? "close" : "quit" },
      ],
    },
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    { role: "windowMenu" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function external(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      shell.openExternal(parsed.toString());
      return true;
    }
  } catch (_) { /* ignore malformed URLs */ }
  return false;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 980,
    minHeight: 680,
    show: false,
    backgroundColor: "#0b0714",
    title: "Shorts Factory",
    autoHideMenuBar: true,
    icon: path.join(__dirname, "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
    },
  });

  mainWindow.loadFile(path.join(__dirname, "loading.html"));
  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.on("closed", () => { mainWindow = null; });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    external(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(APP_URL)) {
      event.preventDefault();
      external(url);
    }
  });
  mainWindow.webContents.on("will-attach-webview", (event) => event.preventDefault());
}

function stopBackend() {
  if (!ownsBackend || !backendProcess) return;
  try { backendProcess.kill("SIGTERM"); } catch (_) { /* already gone */ }
  backendProcess = null;
  ownsBackend = false;
}

function installIpc() {
  ipcMain.handle("shorts-desktop:open-external", (_event, url) => external(String(url || "")));
  ipcMain.handle("shorts-desktop:data-path", () => dataPath());
  ipcMain.handle("shorts-desktop:choose-folder", async (_event, startPath) => {
    const requested = String(startPath || "").trim();
    const defaultPath = path.isAbsolute(requested) && fs.existsSync(requested)
      ? requested
      : app.getPath("videos");
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Choose where rendered clips are stored",
      defaultPath,
      properties: ["openDirectory", "createDirectory"],
    });
    return result.canceled ? null : result.filePaths[0] || null;
  });
  ipcMain.handle("shorts-desktop:install-update", (event, payload) => installUpdate(event.sender, payload));
}

async function boot() {
  app.setName("Shorts Factory");
  installIpc();
  await app.whenReady();
  appMenu();
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  createWindow();

  try {
    await startBackend();
    if (!mainWindow || mainWindow.isDestroyed()) return;
    await mainWindow.loadURL(APP_URL);
  } catch (err) {
    dialog.showErrorBox("Shorts Factory could not start", String(err.message || err));
    app.quit();
  }
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
  app.on("web-contents-created", (_event, contents) => {
    contents.on("will-attach-webview", (event) => event.preventDefault());
  });
  app.on("before-quit", () => {
    shuttingDown = true;
    stopBackend();
  });
  app.on("window-all-closed", () => app.quit());
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
      mainWindow.loadURL(APP_URL);
    }
  });
  boot().catch((err) => {
    dialog.showErrorBox("Shorts Factory could not start", String(err.message || err));
    app.quit();
  });
}
