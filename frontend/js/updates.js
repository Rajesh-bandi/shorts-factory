import { state, $, api } from "./core.js";
import { toast } from "./ui.js";

let updateToast = null;
let updateInfo = null;
let updateInstallBusy = false;

function openRelease() {
  if (!updateInfo || !updateInfo.release_url) return;
  if (window.shortsDesktop && window.shortsDesktop.openExternal) {
    window.shortsDesktop.openExternal(updateInfo.release_url);
  } else {
    window.open(updateInfo.release_url, "_blank", "noopener");
  }
}

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value >= 1073741824) return `${(value / 1073741824).toFixed(1)} GB`;
  if (value >= 1048576) return `${(value / 1048576).toFixed(1)} MB`;
  if (value >= 1024) return `${Math.round(value / 1024)} KB`;
  return `${value} B`;
}

function updateToastParts() {
  if (!updateToast || !updateToast.el || !updateToast.el.isConnected) return null;
  const el = updateToast.el;
  return {
    el,
    title: el.querySelector(".toast-copy > strong"),
    message: el.querySelector(".toast-copy > span"),
    button: el.querySelector(".toast-action.primary"),
  };
}

function updateToastState(status) {
  const parts = updateToastParts();
  if (!parts || !status) return;
  const { el, title, message, button } = parts;
  if (status.state === "downloading") {
    el.classList.remove("err");
    el.classList.add("ok");
    if (title) title.textContent = "Downloading update";
    if (message) {
      const percent = Number(status.percent);
      message.textContent = status.percent != null && Number.isFinite(percent)
        ? `${percent}%${status.total ? ` of ${formatBytes(status.total)}` : ""} — keep this window open.`
        : `Downloading ${formatBytes(status.received)}…`;
    }
    if (button) { button.disabled = true; button.textContent = "Downloading…"; }
  } else if (status.state === "installing") {
    if (title) title.textContent = "Installing update";
    if (message) message.textContent = "The app will restart in a moment.";
    if (button) { button.disabled = true; button.textContent = "Installing…"; }
  } else if (status.state === "error") {
    el.classList.remove("ok");
    el.classList.add("err");
    if (title) title.textContent = "Update failed";
    if (message) message.textContent = status.message || "The update could not be installed.";
    if (button) { button.disabled = false; button.textContent = "Retry"; }
    updateInstallBusy = false;
  }
}

async function installUpdate() {
  if (updateInstallBusy) return;
  if (!window.shortsDesktop || !window.shortsDesktop.installUpdate) {
    openRelease();
    return;
  }
  if (!updateInfo || !updateInfo.asset) {
    openRelease();
    return;
  }
  updateInstallBusy = true;
  updateToastState({ state: "downloading", received: 0, total: updateInfo.asset.size || 0, percent: 0 });
  try {
    await window.shortsDesktop.installUpdate({
      url: updateInfo.asset.url,
      name: updateInfo.asset.name,
      size: updateInfo.asset.size,
      version: updateInfo.latest_version,
    });
  } catch (err) {
    updateToastState({ state: "error", message: (err && err.message) || "The update could not be installed." });
  }
}

function showUpdateToast(info) {
  if (updateToast && updateToast.el && updateToast.el.isConnected) return;
  updateInfo = info;
  const canInstall = !!(window.shortsDesktop && window.shortsDesktop.installUpdate && info.asset);
  updateToast = toast(
    `Version ${info.latest_version} is available.`,
    "ok",
    info.latest_tag ? `${info.latest_tag} available` : "Update available",
    {
      actions: [{
        label: canInstall ? "Install update" : "View release",
        primary: true,
        run: canInstall ? installUpdate : openRelease,
      }],
      timeout: 0,
      className: "update-toast",
    }
  );
}

async function checkForUpdates() {
  if (!state.appStarted) return;
  try {
    const info = await api("/update");
    if (info && info.current_version) {
      const version = $("#appVersion");
      if (version) version.textContent = `v${info.current_version}`;
    }
    if (info && info.available) showUpdateToast(info);
  } catch (_) {
    /* Updates are best-effort; never interrupt the studio for a network error. */
  }
}

export { checkForUpdates, updateToastState };
