/* Shorts Factory — event wiring and application startup. */
import { state, $, $$, VIEWS, api, API_BASE } from "./core.js";
import { paintIcons } from "./icons.js";
import {
  prefs, applyPrefsUI, renderTweaks, setPref, openTweaks, closeTweaks,
  toggleMode, resetPrefs
} from "./prefs.js";
import { trapTab } from "./focus.js";
import { go, closeRail } from "./router.js";
import { loadDashboard } from "./dashboard.js";
import { renderJobs, pollJobs, handleJobClick, handleJobInput } from "./jobs.js";
import { setCreateMode, queueBatch, startAnalyze, showCreateStep, renderManualCut } from "./create.js";
import {
  loadHistory, renderHistory, filteredHistory, openHistoryClip, openUploadModal,
  deleteHistory
} from "./history.js";
import { refreshAnalytics, exportCsv, renderVideoTable, toggleSort } from "./analytics.js";
import {
  loadSettings, saveSettings, switchTab, chooseOutputFolder, testAI, loadHealth,
  syncCaptionControls, updateCaptionPreview, applyCaptionPreset
} from "./settings.js";
import { checkAuth, startConnect, cancelConnect, disconnectYt } from "./youtube.js";
import { closeModal, copy, toast } from "./ui.js";
import { bindAudio, uiSound } from "./sounds.js";
import { openCmd, closeCmd, renderCmd, runCmd, showShortcuts } from "./commands.js";
import { checkForUpdates, updateToastState } from "./updates.js";
import { bindAuth, loadAuthConfig, loadAccount, setAuthMode } from "./auth.js";

let bound = false;

function markPressed(root, attr, value) {
  const container = $(root);
  if (!container) return;
  $$(`[${attr}]`, container).forEach((button) => {
    const key = attr.replace(/^data-/, "").replace(/-([a-z])/g, (_, char) => char.toUpperCase());
    const on = String(button.dataset[key]) === String(value);
    button.classList.toggle("on", on);
    button.setAttribute("aria-pressed", String(on));
  });
}

function syncSelectionControls() {
  markPressed("#jobFilters", "data-filter", state.filter);
  markPressed("#historyFilters", "data-history-filter", state.historyFilter);
  markPressed("#countPicker", "data-count", state.count);
  markPressed("#createModeTabs", "data-create-mode", state.createMode);
}

function openRail() {
  const rail = $("#rail");
  const opener = $("#railOpen");
  if (!rail) return;
  rail.classList.add("open");
  $("#railScrim").classList.add("show");
  if (opener) opener.setAttribute("aria-expanded", "true");
  requestAnimationFrame(() => {
    const first = $("#rail .nav-item");
    if (first) first.focus({ preventScroll: true });
  });
}

function bind() {
  if (bound) return;
  bound = true;

  syncSelectionControls();

  const skip = $(".skip-link");
  if (skip) skip.addEventListener("click", (e) => {
    e.preventDefault();
    const main = $("#mainContent");
    if (main) main.focus();
  });

  $$(".nav-item").forEach((n) => n.addEventListener("click", () => go(n.dataset.view)));

  document.addEventListener("click", (e) => {
    const g = e.target.closest("[data-go]");
    if (g) { go(g.dataset.go); if (g.dataset.tabTarget) switchTab(g.dataset.tabTarget); return; }
    if (e.target.closest("[data-tweaks]")) return openTweaks();
    const cf = e.target.closest("[data-copy-field]");
    if (cf) { const el = $(cf.dataset.copyField); if (el) copy(el.value); return; }
    const c = e.target.closest("[data-copy]");
    if (c) { copy(c.dataset.copy); return; }
    const oj = e.target.closest("[data-open-job]");
    if (oj) { state.jobOpen[Number(oj.dataset.openJob)] = true; go("jobs"); renderJobs(true); }
  });

  $("#railCollapse").addEventListener("click", () => setPref({ sidebar: !prefs.sidebar }));
  $("#railOpen").addEventListener("click", openRail);
  $("#railScrim").addEventListener("click", closeRail);
  $("#connCard").addEventListener("click", () => { go("settings"); switchTab("channel"); });
  $("#btnMode").addEventListener("click", toggleMode);
  $("#btnTweaks").addEventListener("click", openTweaks);
  $("#btnAppearance").addEventListener("click", openTweaks);
  $("#btnHelp").addEventListener("click", showShortcuts);
  $("#cmdTrigger").addEventListener("click", openCmd);
  $("#dashRefresh").addEventListener("click", () => { loadDashboard(true); pollJobs(true); });

  $("#createModeTabs").addEventListener("click", (e) => {
    const b = e.target.closest("[data-create-mode]");
    if (!b) return;
    setCreateMode(b.dataset.createMode);
    syncSelectionControls();
  });
  $("#btnBatch").addEventListener("click", queueBatch);
  $("#btnLogout").addEventListener("click", async () => {
    try { await api("/auth/logout", { method: "POST" }); } catch (_) { /* already signed out */ }
    location.reload();
  });
  $("#manualRender").addEventListener("click", (e) => renderManualCut(e.currentTarget));
  $("#manualOpenJob").addEventListener("click", (e) => {
    const id = Number(e.currentTarget.dataset.id);
    if (!id) return;
    state.jobOpen[id] = true;
    go("jobs");
  });

  $("#countPicker").addEventListener("click", (e) => {
    const chip = e.target.closest(".chip");
    if (!chip) return;
    state.count = Number(chip.dataset.count);
    syncSelectionControls();
  });
  $("#btnAnalyze").addEventListener("click", startAnalyze);
  $("#btnStartAnalysis").addEventListener("click", startAnalyze);
  [$("#btnBackSource"), $("#btnBackSource2")].forEach((button) => {
    if (!button) return;
    button.addEventListener("click", () => {
      showCreateStep(1);
      $("#urlInput").focus();
    });
  });
  $("#urlInput").addEventListener("keydown", (e) => { if (e.key === "Enter") startAnalyze(); });
  $("#btnPaste").addEventListener("click", async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        $("#urlInput").value = text.trim();
        $("#urlHint").hidden = true;
        $("#urlInput").classList.remove("bad");
      }
    } catch (_) { toast("Clipboard permission denied — paste manually", "warn"); }
  });

  $("#jobFilters").addEventListener("click", (e) => {
    const b = e.target.closest(".filter");
    if (!b) return;
    state.filter = b.dataset.filter;
    syncSelectionControls();
    renderJobs(true);
  });
  $("#jobSearch").addEventListener("input", (e) => {
    clearTimeout(state.searchTimer);
    state.searchTimer = setTimeout(() => { state.jobQuery = e.target.value; renderJobs(true); }, 140);
  });
  $("#jobsRefresh").addEventListener("click", () => pollJobs(true));
  $("#jobList").addEventListener("click", handleJobClick);
  $("#createActive").addEventListener("click", handleJobClick);
  [$("#jobList"), $("#createActive")].forEach((root) => {
    root.addEventListener("input", handleJobInput);
    root.addEventListener("change", handleJobInput);
  });

  $("#historyRefresh").addEventListener("click", loadHistory);
  $("#historySearch").addEventListener("input", (e) => {
    clearTimeout(state.historyTimer);
    state.historyTimer = setTimeout(() => { state.historyQuery = e.target.value; renderHistory(); }, 120);
  });
  $("#historyGrid").addEventListener("click", (e) => {
    const play = e.target.closest("[data-hist-play]");
    if (play) { e.preventDefault(); openHistoryClip(Number(play.dataset.histPlay)); return; }
    const up = e.target.closest("[data-hist-upload]");
    if (up) { openUploadModal(Number(up.dataset.histUpload)); return; }
    const job = e.target.closest("[data-hist-job]");
    if (job) { state.jobOpen[Number(job.dataset.histJob)] = true; go("jobs"); return; }
  });
  $("#historyGrid").addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const thumb = e.target.closest(".history-thumb[data-hist-play]");
    if (!thumb || e.target !== thumb) return;
    e.preventDefault();
    openHistoryClip(Number(thumb.dataset.histPlay));
  });
  $("#historyFilters").addEventListener("click", (e) => {
    const b = e.target.closest("[data-history-filter]");
    if (!b) return;
    state.historyFilter = b.dataset.historyFilter;
    syncSelectionControls();
    renderHistory();
  });
  $("#historyGrid").addEventListener("change", (e) => {
    const box = e.target.closest("[data-history-check]");
    if (!box) return;
    const id = Number(box.dataset.historyCheck);
    state.historySel[id] = box.checked;
    const card = box.closest(".history-card");
    if (card) card.classList.toggle("selected", box.checked);
    renderHistory();
  });
  $("#historySelectAll").addEventListener("click", () => {
    const list = filteredHistory();
    const allOn = list.length > 0 && list.every((c) => state.historySel[c.id]);
    list.forEach((c) => { state.historySel[c.id] = !allOn; });
    renderHistory();
  });
  $("#historyDeleteSelected").addEventListener("click", () => deleteHistory(false));
  $("#historyDeleteAll").addEventListener("click", () => deleteHistory(true));

  $("#btnRefresh").addEventListener("click", refreshAnalytics);
  $("#btnExport").addEventListener("click", exportCsv);
  $("#vidSearch").addEventListener("input", (e) => { state.vidQuery = e.target.value; renderVideoTable(); });
  $$("th.sortable").forEach((th) => th.addEventListener("click", () => toggleSort(th.dataset.sort)));

  $("#settingsTabs").addEventListener("click", (e) => {
    const b = e.target.closest(".tab");
    if (b) switchTab(b.dataset.tab);
  });
  $("#settingsTabs").addEventListener("keydown", (e) => {
    const tabs = $$("#settingsTabs .tab");
    const current = e.target.closest(".tab");
    const index = tabs.indexOf(current);
    if (index < 0) return;
    let next = null;
    if (e.key === "ArrowRight") next = tabs[(index + 1) % tabs.length];
    else if (e.key === "ArrowLeft") next = tabs[(index - 1 + tabs.length) % tabs.length];
    else if (e.key === "Home") next = tabs[0];
    else if (e.key === "End") next = tabs[tabs.length - 1];
    if (!next) return;
    e.preventDefault();
    next.focus();
    switchTab(next.dataset.tab);
  });
  $("#btnSave").addEventListener("click", () => saveSettings());
  if ($("#btnChooseOutput")) $("#btnChooseOutput").addEventListener("click", chooseOutputFolder);
  $("#btnTestAI").addEventListener("click", testAI);
  $("#btnHealth").addEventListener("click", () => loadHealth(true));
  $("#btnConnect").addEventListener("click", startConnect);
  $("#btnCancelAuth").addEventListener("click", cancelConnect);
  $("#btnDisconnect").addEventListener("click", disconnectYt);

  $("#capPresets").addEventListener("click", (e) => {
    const b = e.target.closest(".cap-preset");
    if (b) applyCaptionPreset(b.dataset.preset);
  });
  $("#capPosition").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-pos]");
    if (!b) return;
    $("#caption_position").value = b.dataset.pos;
    syncCaptionControls();
    updateCaptionPreview();
  });
  $("#capColors").addEventListener("click", (e) => {
    const b = e.target.closest("[data-color]");
    if (!b) return;
    $("#caption_color").value = b.dataset.color;
    syncCaptionControls();
    updateCaptionPreview();
  });
  ["caption_size", "caption_color", "caption_highlight", "caption_animation", "caption_uppercase", "caption_box", "capSample"].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    const sync = () => { syncCaptionControls(); updateCaptionPreview(); };
    el.addEventListener("input", sync);
    el.addEventListener("change", sync);
  });
  $("#short_length").addEventListener("input", syncCaptionControls);

  $("#twClose").addEventListener("click", closeTweaks);
  $("#twScrim").addEventListener("click", closeTweaks);
  $("#twReset").addEventListener("click", () => { resetPrefs(); toast("Appearance reset", "ok"); });
  $("#paletteGrid").addEventListener("click", (e) => {
    const b = e.target.closest("[data-palette]");
    if (!b) return;
    if (b.dataset.palette === "vice") {
      const firstTime = prefs.palette !== "vice";
      setPref({ palette: "vice" });
      if (firstTime) toast("Sunset radio online. Interface sounds enabled.", "ok", "Vice 6");
      return;
    }
    setPref({ palette: b.dataset.palette });
  });
  $("#accentSwatches").addEventListener("click", (e) => {
    const b = e.target.closest("[data-accent]");
    if (b) setPref({ accent: b.dataset.accent });
  });
  $("#accentCustom").addEventListener("input", (e) => setPref({ accent: e.target.value }));
  $("#twMode").addEventListener("click", (e) => { const b = e.target.closest("[data-mode]"); if (b) setPref({ mode: b.dataset.mode }); });
  $("#twFont").addEventListener("click", (e) => { const b = e.target.closest("[data-value]"); if (b) setPref({ font: b.dataset.value }); });
  $("#twRadius").addEventListener("click", (e) => { const b = e.target.closest("[data-value]"); if (b) setPref({ radius: b.dataset.value }); });
  $("#twDensity").addEventListener("click", (e) => { const b = e.target.closest("[data-value]"); if (b) setPref({ density: b.dataset.value }); });
  $("#twMotion").addEventListener("click", (e) => { const b = e.target.closest("[data-value]"); if (b) setPref({ motion: b.dataset.value }); });
  $("#tweaks").addEventListener("change", (e) => {
    const cb = e.target.closest("[data-effect]");
    if (!cb) return;
    setPref({ [cb.dataset.effect]: cb.checked });
    if (cb.dataset.effect === "sound" && cb.checked) uiSound("click");
  });

  document.addEventListener("visibilitychange", () => {
    document.documentElement.dataset.visibility = document.hidden ? "hidden" : "visible";
  });
  window.addEventListener("beforeunload", () => {
    if (!state.prefsDirty) return;
    try {
      navigator.sendBeacon(`${API_BASE}/api/prefs`, new Blob([JSON.stringify({ prefs })], { type: "application/json" }));
    } catch (_) { /* local copy is already saved */ }
  });

  $("#cmdInput").addEventListener("input", renderCmd);
  $("#cmdInput").addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); state.cmdIndex = Math.min(state.cmdItems.length - 1, state.cmdIndex + 1); renderCmd(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); state.cmdIndex = Math.max(0, state.cmdIndex - 1); renderCmd(); }
    else if (e.key === "Enter") { e.preventDefault(); runCmd(state.cmdIndex); }
  });
  $("#cmdList").addEventListener("click", (e) => { const b = e.target.closest("[data-i]"); if (b) runCmd(Number(b.dataset.i)); });
  $("#cmdOverlay").addEventListener("click", (e) => { if (e.target === $("#cmdOverlay")) closeCmd(); });
  $("#modalClose").addEventListener("click", closeModal);
  $("#modalOverlay").addEventListener("click", (e) => { if (e.target === $("#modalOverlay")) closeModal(); });

  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      if ($("#cmdOverlay").hidden) openCmd(); else closeCmd();
      return;
    }
    if (e.key === "Escape") {
      closeCmd();
      closeModal();
      closeTweaks();
      closeRail();
      return;
    }
    const modalOpen = !$("#modalOverlay").hidden;
    const cmdOpen = !$("#cmdOverlay").hidden;
    const rail = $("#rail");
    if (e.key === "Tab") {
      if (modalOpen) return trapTab(e, $("#modalBox"));
      if (cmdOpen) return trapTab(e, $("#cmdOverlay .cmdk"));
      if (rail && rail.classList.contains("open")) return trapTab(e, rail);
    }
    if (modalOpen || cmdOpen) return;
    const tag = (e.target.tagName || "").toLowerCase();
    if (["input", "textarea", "select"].includes(tag) || e.target.isContentEditable) return;
    if (["1", "2", "3", "4", "5", "6"].includes(e.key)) go(VIEWS[Number(e.key) - 1]);
    else if (e.key === "?" || (e.shiftKey && e.key === "/")) showShortcuts();
    else if (e.key.toLowerCase() === "n") { go("create"); setTimeout(() => $("#urlInput").focus(), 120); }
    else if (e.key.toLowerCase() === "t") toggleMode();
    else if (e.key.toLowerCase() === "r") {
      if (state.view === "analytics") refreshAnalytics();
      else if (state.view === "dashboard") loadDashboard(true);
      else pollJobs(true);
    }
  });

  document.addEventListener("pointermove", (e) => {
    const card = e.target.closest(".spot");
    if (!card) return;
    const rect = card.getBoundingClientRect();
    card.style.setProperty("--mx", `${e.clientX - rect.left}px`);
    card.style.setProperty("--my", `${e.clientY - rect.top}px`);
  }, { passive: true });

  document.addEventListener("click", (e) => {
    const b = e.target.closest(".btn");
    if (!b || prefs.motion !== "full") return;
    const rect = b.getBoundingClientRect();
    const span = document.createElement("span");
    span.className = "ripple";
    const size = Math.max(rect.width, rect.height);
    span.style.width = span.style.height = size + "px";
    span.style.left = e.clientX - rect.left - size / 2 + "px";
    span.style.top = e.clientY - rect.top - size / 2 + "px";
    b.appendChild(span);
    setTimeout(() => span.remove(), 600);
  });
}

function startApp() {
  bind();
  renderTweaks();
  applyPrefsUI();
  syncCaptionControls();
  if (window.shortsDesktop && window.shortsDesktop.onUpdateStatus) {
    window.shortsDesktop.onUpdateStatus(updateToastState);
  }
  loadHistory();
  const hash = location.hash.replace("#", "");
  go(VIEWS.includes(hash) || hash.startsWith("settings/") ? hash : "dashboard", false);
  loadSettings();
  checkAuth();
  pollJobs(true);
  if (state.view === "dashboard") loadDashboard();
  setInterval(() => { if (!document.hidden && state.appStarted) pollJobs(); }, 2500);
  setInterval(() => { if (!document.hidden && state.appStarted) checkAuth(); }, 20000);
  setTimeout(checkForUpdates, 1600);
  setInterval(() => { if (!document.hidden && state.appStarted) checkForUpdates(); }, 6 * 60 * 60 * 1000);
  window.addEventListener("hashchange", () => {
    const view = location.hash.slice(1);
    if ((VIEWS.includes(view) || view.startsWith("settings/")) && view !== state.view) go(view, false);
  });
}

async function boot() {
  paintIcons();
  bindAudio();
  bindAuth();
  await loadAuthConfig();
  if (!(state.authConfig && state.authConfig.local)) {
    setAuthMode(state.authConfig && state.authConfig.first_account ? "register" : "login");
  }
  const ok = await loadAccount();
  if (!ok) return;
  if (!state.appStarted) {
    state.appStarted = true;
    startApp();
  }
  const params = new URLSearchParams(location.search);
  if (params.get("youtube") === "connected") {
    toast("YouTube connected to this account", "ok");
    history.replaceState(null, "", location.pathname + location.hash);
  }
  if (params.get("youtube") === "error") {
    toast("YouTube connection failed — try again", "err");
    history.replaceState(null, "", location.pathname + location.hash);
  }
}

export { boot };
