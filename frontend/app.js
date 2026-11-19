/* Shorts Factory — frontend application */
(() => {
  "use strict";
  const T = window.YTMTheme;
  let prefs = T.load();
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const VIEWS = ["dashboard", "create", "jobs", "history", "analytics", "settings"];
  const state = {
    view: "dashboard", jobs: [], jobOpen: {}, edit: {}, editSig: {}, logs: {}, logCursor: {}, logBusy: {},
    prevStatus: {}, settings: {}, settingsLoaded: false, auth: null, analytics: null, advisor: null,
    health: null, healthLoaded: false, filter: "all", jobQuery: "", vidQuery: "",
    sort: { key: "views", dir: "desc" }, count: 2, polling: false, jobSig: "",
    cmdItems: [], cmdIndex: 0, confirmResolve: null, authTimer: null, warned: false,
    createMode: "auto", manualJobId: null, manualInputJob: null, capTimer: null, capTick: 0,
    history: [], historyLoaded: false, historySel: {}, historyQuery: "", historyFilter: "all",
    account: null, accountMode: "login", authConfig: null, appStarted: false, historyPoll: null,
    localMode: false, prefsTimer: null, prefsDirty: false
  };

  const ICONS = {
    dashboard: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    create: '<path d="M12 3l1.7 4.3L18 9l-4.3 1.7L12 15l-1.7-4.3L6 9l4.3-1.7L12 3z"/><path d="M18.4 15.4l.7 1.8 1.9.8-1.9.8-.7 1.8-.7-1.8-1.9-.8 1.9-.8.7-1.8z"/>',
    layers: '<path d="M12 3l9 5-9 5-9-5 9-5z"/><path d="M3 12l9 5 9-5"/><path d="M3 16l9 5 9-5"/>',
    chart: '<path d="M3 20h18"/><path d="M6 20v-6"/><path d="M11 20V8"/><path d="M16 20v-9"/><path d="M21 20V4"/>',
    sliders: '<path d="M4 7h9"/><path d="M17 7h3"/><circle cx="15" cy="7" r="2"/><path d="M4 17h3"/><path d="M11 17h9"/><circle cx="9" cy="17" r="2"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.6-3.6"/>',
    menu: '<path d="M4 7h16"/><path d="M4 12h16"/><path d="M4 17h16"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4"/>',
    moon: '<path d="M20 14.5A8.5 8.5 0 019.5 4a8.5 8.5 0 1010.5 10.5z"/>',
    palette: '<path d="M12 3a9 9 0 100 18h1.5a2 2 0 001.4-3.4 2 2 0 011.4-3.4H18a3 3 0 003-3A9 9 0 0012 3z"/><circle cx="7.5" cy="10.5" r="1"/><circle cx="12" cy="7.5" r="1"/><circle cx="16.5" cy="10.5" r="1"/>',
    keyboard: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6 10h.01M9 10h.01M12 10h.01M15 10h.01M18 10h.01M7 14h10"/>',
    users: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20a6 6 0 0112 0"/><path d="M16 5.5a3 3 0 010 5.5"/><path d="M18 20a6 6 0 00-3-5.2"/>',
    eye: '<path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6z"/><circle cx="12" cy="12" r="2.6"/>',
    film: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4"/>',
    scissors: '<circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><path d="M8 8l12 10M20 6L8 16"/>',
    bolt: '<path d="M13 2L4 14h6l-1 8 9-12h-6l1-8z"/>',
    "arrow-right": '<path d="M5 12h14"/><path d="M13 6l6 6-6 6"/>',
    "chevron-right": '<path d="M9 6l6 6-6 6"/>',
    "chevron-down": '<path d="M6 9l6 6 6-6"/>',
    link: '<path d="M10 14a5 5 0 007 0l2-2a5 5 0 00-7-7l-1 1"/><path d="M14 10a5 5 0 00-7 0l-2 2a5 5 0 007 7l1-1"/>',
    youtube: '<rect x="2.5" y="5.5" width="19" height="13" rx="4"/><path d="M10 9.5l5 2.5-5 2.5z"/>',
    clipboard: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1"/><path d="M9 10h6M9 14h4"/>',
    refresh: '<path d="M20 11a8 8 0 10-2.3 6.3"/><path d="M20 4v7h-7"/>',
    download: '<path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M4 20h16"/>',
    database: '<ellipse cx="12" cy="5.5" rx="8" ry="3"/><path d="M4 5.5v13c0 1.7 3.6 3 8 3s8-1.3 8-3v-13"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
    check: '<path d="M4 12.5l5 5L20 6.5"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    rotate: '<path d="M3 12a9 9 0 109-9"/><path d="M3 4v8h8"/>',
    panel: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
    alert: '<path d="M12 3l9 17H3L12 3z"/><path d="M12 9v5M12 17h.01"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
    play: '<path d="M8 5.5l11 6.5-11 6.5z"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a1 1 0 01-1-1V4a1 1 0 011-1h10a1 1 0 011 1v1"/>',
    external: '<path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M19 14v4a2 2 0 01-2 2H6a2 2 0 01-2-2V7a2 2 0 012-2h4"/>',
    trash: '<path d="M4 7h16"/><path d="M9 7V5h6v2"/><path d="M6 7l1 13h10l1-13"/><path d="M10 11v6M14 11v6"/>',
    spark: '<path d="M12 3l1.7 4.3L18 9l-4.3 1.7L12 15l-1.7-4.3L6 9l4.3-1.7L12 3z"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    terminal: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9l3 3-3 3M13 15h4"/>',
    cpu: '<rect x="5" y="5" width="14" height="14" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3"/>',
    monitor: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    folder: '<path d="M3 6a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>',
    wand: '<path d="M4 20L16 8"/><path d="M14 4l1 2 2 1-2 1-1 2-1-2-2-1 2-1 1-2z"/><path d="M19 12l.6 1.4L21 14l-1.4.6L19 16l-.6-1.4L17 14l1.4-.6L19 12z"/>'
  };
  const icon = (name, cls = "") => `<svg class="ico ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ICONS.spark}</svg>`;
  const paintIcons = () => $$("[data-icon]").forEach((el) => { if (!el.dataset.painted) { el.innerHTML = icon(el.dataset.icon); el.dataset.painted = "1"; } });

  const esc = (v) => String(v ?? "").replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmt = (n) => {
    if (n === null || n === undefined || n === "") return "—";
    n = Number(n);
    if (!Number.isFinite(n)) return "—";
    if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, "") + "B";
    if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
    if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, "") + "K";
    return String(n);
  };
  const fmtBytes = (b) => {
    if (!b) return "0 B";
    const u = ["B", "KB", "MB", "GB"];
    let i = 0, n = b;
    while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
    return `${n.toFixed(n > 9 ? 0 : 1)} ${u[i]}`;
  };
  const elapsedLabel = (ts) => {
    if (!ts) return "";
    const s = Math.max(0, Math.floor(Date.now() / 1000 - ts));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return h ? `${h}h ${m}m` : m ? `${m}m ${sec}s` : `${sec}s`;
  };
  const shortEta = (seconds) => {
    const s = Math.max(0, Number(seconds) || 0);
    if (s < 90) return "under 2m";
    const m = Math.round(s / 60);
    if (m < 60) return `~${m}m`;
    const h = Math.floor(m / 60), rem = m % 60;
    return rem ? `~${h}h ${rem}m` : `~${h}h`;
  };
  const etaClock = (ts) => ts ? new Date(ts * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "";
  function jobEta(j) {
    if (!j) return null;
    const seconds = Number(j.eta_seconds);
    if (j.status === "queued") {
      const pos = Number(j.queue_position);
      return {
        label: `${pos > 0 ? `#${pos} in queue · ` : ""}${seconds > 0 ? `ETA ${shortEta(seconds)}` : "waiting"}`,
        title: seconds > 0 ? `Estimated finish around ${etaClock(j.eta_at)}` : "Waiting for a worker"
      };
    }
    if (j.status === "running") {
      return {
        label: seconds > 0 ? `ETA ${shortEta(seconds)} left` : "estimating ETA…",
        title: seconds > 0 ? `Estimated finish around ${etaClock(j.eta_at)}` : "ETA appears once progress stabilizes"
      };
    }
    return null;
  }
  const timeAgo = (ts) => {
    if (!ts) return "";
    const s = Math.max(0, Date.now() / 1000 - ts);
    if (s < 60) return "just now";
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    if (s < 604800) return `${Math.floor(s / 86400)}d ago`;
    return new Date(ts * 1000).toLocaleDateString();
  };
  const truthy = (v) => v === true || v === "true" || v === 1 || v === "1";
  const jobOpt = (j, key, fallback) => {
    if (j && j.options && Object.prototype.hasOwnProperty.call(j.options, key) && j.options[key] !== null && j.options[key] !== "") return j.options[key];
    if (state.settings && Object.prototype.hasOwnProperty.call(state.settings, key) && state.settings[key] !== null && state.settings[key] !== "") return state.settings[key];
    return fallback;
  };
  const optionsHtml = (list, current) => list.map(([v, l]) => `<option value="${v}"${String(v) === String(current) ? " selected" : ""}>${l}</option>`).join("");
  const isoDate = (ts) => new Date(ts * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric" });

  async function api(path, opts = {}) {
    const res = await fetch(`/api${path}`, { headers: { "Content-Type": "application/json" }, ...opts });
    const text = await res.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch (_) { body = text; }
    if (res.status === 401 && !state.localMode && !path.startsWith("/auth/login") && !path.startsWith("/auth/register")) lockApp();
    if (!res.ok) throw new Error((body && body.detail) || res.statusText || "Request failed");
    return body;
  }

  /* ---------- account gate ---------- */
  function finishBoot() {
    const splash = $("#bootSplash");
    if (!splash) return;
    splash.classList.add("done");
    setTimeout(() => splash.remove(), 450);
  }
  function lockApp() {
    if (state.localMode) return;
    document.body.classList.add("auth-locked");
    const gate = $("#authGate");
    if (gate) gate.classList.remove("hidden");
  }
  function unlockApp() {
    document.body.classList.remove("auth-locked");
    const gate = $("#authGate");
    if (gate) gate.classList.add("hidden");
    finishBoot();
  }
  function setAuthMode(mode) {
    state.accountMode = mode === "register" ? "register" : "login";
    $$("#authTabs .tab").forEach((b) => b.classList.toggle("active", b.dataset.authTab === state.accountMode));
    const cfg = state.authConfig || {};
    const first = !!cfg.first_account;
    $("#authTabs [data-auth-tab=\"login\"]").hidden = first;
    $("#authTabs [data-auth-tab=\"register\"]").hidden = cfg.registration_open === false;
    $("#authNameField").hidden = state.accountMode !== "register";
    $("#authInviteField").hidden = state.accountMode !== "register" || first || !cfg.invite_required;
    $("#authSubmitLabel").textContent = state.accountMode === "register" ? "Create account" : "Sign in";
    $("#authPassword").autocomplete = state.accountMode === "register" ? "new-password" : "current-password";
    $("#authError").hidden = true;
  }
  function bindAuth() {
    $("#authTabs").addEventListener("click", (e) => { const b = e.target.closest("[data-auth-tab]"); if (b) setAuthMode(b.dataset.authTab); });
    $("#authForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const err = $("#authError"), btn = $("#authSubmit");
      err.hidden = true; btn.disabled = true; btn.classList.add("loading");
      const payload = {
        email: $("#authEmail").value.trim(), password: $("#authPassword").value,
        display_name: $("#authName").value.trim(), invite: $("#authInvite").value.trim()
      };
      try {
        const body = await api(`/auth/${state.accountMode}`, { method: "POST", body: JSON.stringify(payload) });
        state.account = body.user;
        unlockApp();
        toast(`Welcome, ${body.user.display_name || body.user.email}`, "ok", "Signed in");
        location.reload();
      } catch (ex) {
        err.textContent = ex.message; err.hidden = false;
      } finally { btn.disabled = false; btn.classList.remove("loading"); }
    });
  }
  async function loadAuthConfig() {
    try { state.authConfig = await api("/auth/config"); }
    catch (_) { state.authConfig = null; }
    return state.authConfig;
  }
  async function loadAccount() {
    try {
      const me = await api("/auth/me");
      state.account = me.user;
      state.accountStats = me;
      state.localMode = !!me.local;
      document.body.classList.toggle("local-mode", state.localMode);
      if (me.prefs && typeof me.prefs === "object" && Object.keys(me.prefs).length) {
        prefs = T.set(me.prefs, prefs);
      }
      const name = me.user.display_name || me.user.email;
      $("#accountName").textContent = name;
      $("#accountEmail").textContent = state.localMode ? "local workspace" : me.user.email;
      $("#accountAvatar").textContent = (name || "?").slice(0, 2);
      $("#accountChip").title = state.localMode ? "Local workspace — everything stays on this computer" : "Signed-in account";
      $("#btnLogout").hidden = state.localMode;
      $("#btnLogout").style.display = state.localMode ? "none" : "";
      unlockApp();
      if (!state.appStarted) { state.appStarted = true; startApp(); }
      return true;
    } catch (_) {
      finishBoot();
      lockApp();
      return false;
    }
  }

  /* ---------- appearance ---------- */
  function applyPrefsUI() {
    const modeBtn = $("#btnMode");
    const resolvedMode = document.documentElement.dataset.mode || prefs.mode;
    if (modeBtn) modeBtn.innerHTML = icon(resolvedMode === "dark" ? "sun" : "moon");
    const box = $("#modalBox");
    if (box) box.classList.remove("wide");
    const view = state.view || "dashboard";
    document.title = `${view[0].toUpperCase() + view.slice(1)} · ${prefs.palette === "vice" ? "Vice 6 · Shorts Factory" : "Shorts Factory"}`;
  }
  function setPref(patch) {
    const next = { ...patch };
    if (next.palette === "vice" && prefs.palette !== "vice") next.sound = true;
    prefs = T.set(next, prefs);
    applyPrefsUI();
    renderTweaks();
    schedulePrefsSave();
  }
  let prefsSaveTimer = null;
  function applyServerPrefs() {
    if (!state.appStarted) return;
    const snapshot = { ...prefs };
    fetch("/api/prefs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prefs: snapshot }),
      keepalive: true,
    }).then(() => { state.prefsDirty = false; }).catch(() => { /* offline — local copy is still saved */ });
  }
  function schedulePrefsSave() {
    if (!state.appStarted) return;
    state.prefsDirty = true;
    clearTimeout(prefsSaveTimer);
    prefsSaveTimer = setTimeout(applyServerPrefs, 420);
  }
  function renderTweaks() {
    const pals = T.PALETTES;
    const active = pals[prefs.palette] || pals.gruvbox;
    const colors = prefs.mode === "light" ? active.light : active.dark;
    const grid = $("#paletteGrid");
    if (grid) grid.innerHTML = Object.entries(pals).map(([key, p]) => {
      const c = prefs.mode === "light" ? p.light : p.dark;
      return `<button class="palette-card${key === prefs.palette ? " on" : ""}" data-palette="${key}">
        <span class="pal-swatches">${[c.bg, c.panel2, c.accent, c.green, c.purple].map((x) => `<i style="background:${x}"></i>`).join("")}</span>
        <span class="pal-name">${p.name}${key === "vice" ? '<em class="pal-new">new</em>' : ""}</span><small>${p.tag}</small></button>`;
    }).join("");
    const soundLabel = $("#soundLabel");
    if (soundLabel) soundLabel.textContent = prefs.palette === "vice" ? "Vice 6 interface sounds" : "Interface sounds";
    const sw = $("#accentSwatches");
    if (sw) {
      const seen = new Set();
      const list = [colors.accent, colors.orange, colors.yellow, colors.green, colors.aqua, colors.blue, colors.purple, colors.red]
        .filter((c) => { c = String(c).toLowerCase(); if (seen.has(c)) return false; seen.add(c); return true; });
      sw.innerHTML = `<button class="swatch${prefs.accent ? "" : " on"}" data-accent="" title="Palette default" style="--sw:${colors.accent};background:linear-gradient(135deg,${colors.accent},${colors.accent2})"></button>` +
        list.map((c) => `<button class="swatch${prefs.accent.toLowerCase() === c.toLowerCase() ? " on" : ""}" data-accent="${c}" title="${c}" style="--sw:${c};background:${c}"></button>`).join("");
    }
    const custom = $("#accentCustom");
    if (custom) custom.value = prefs.accent || colors.accent;
    const mark = (sel, attr, val) => $$(sel + " [" + attr + "]").forEach((b) => b.classList.toggle("on", String(b.dataset[attr.replace("data-", "").replace(/-([a-z])/g, (_, c) => c.toUpperCase())]) === String(val)));
    mark("#twMode", "data-mode", prefs.mode);
    mark("#twFont", "data-value", prefs.font);
    mark("#twRadius", "data-value", prefs.radius);
    mark("#twDensity", "data-value", prefs.density);
    mark("#twMotion", "data-value", prefs.motion);
    $$("#tweaks [data-effect]").forEach((cb) => { cb.checked = !!prefs[cb.dataset.effect]; });
    const cursor = $("#twCursor");
    if (cursor) cursor.checked = prefs.cursor !== false;
  }
  function openTweaks() {
    $("#tweaks").classList.add("open");
    $("#tweaks").setAttribute("aria-hidden", "false");
    $("#twScrim").classList.add("show");
  }
  function closeTweaks() {
    $("#tweaks").classList.remove("open");
    $("#tweaks").setAttribute("aria-hidden", "true");
    $("#twScrim").classList.remove("show");
  }
  const toggleMode = () => setPref({ mode: (document.documentElement.dataset.mode || prefs.mode) === "dark" ? "light" : "dark" });
  function cyclePalette() {
    const keys = Object.keys(T.PALETTES);
    setPref({ palette: keys[(keys.indexOf(prefs.palette) + 1) % keys.length] });
  }

  /* ---------- routing ---------- */
  const closeRail = () => { $("#rail").classList.remove("open"); $("#railScrim").classList.remove("show"); };
  function go(view, push = true) {
    let sub = null;
    if (String(view).startsWith("settings/")) { sub = String(view).split("/")[1]; view = "settings"; }
    if (!VIEWS.includes(view)) view = "dashboard";
    state.view = view;
    $$(".view").forEach((v) => v.classList.toggle("active", v.id === `view-${view}`));
    $$(".nav-item").forEach((n) => n.classList.toggle("active", n.dataset.view === view));
    $("#crumbView").textContent = view;
    document.title = `${view[0].toUpperCase() + view.slice(1)} · ${prefs.palette === "vice" ? "Vice 6 · Shorts Factory" : "Shorts Factory"}`;
    if (push) history.replaceState(null, "", `#${view}`);
    closeRail();
    if (view === "dashboard") loadDashboard();
    if (view === "jobs" || view === "create") { renderJobs(true); pollJobs(true); }
    if (view === "history") loadHistory();
    if (view === "analytics") loadAnalytics();
    if (view === "settings") { if (!state.settingsLoaded) loadSettings(); if (sub) switchTab(sub, false); }
    if (view === "create") updateCaptionPreview();
    else stopCaptionPreview();
    window.scrollTo({ top: 0, behavior: prefs.motion === "full" ? "smooth" : "auto" });
  }

  /* ---------- dashboard ---------- */
  async function loadDashboard(showErrors = false) {
    try {
      const an = await api("/analytics").catch(() => null);
      if (an) state.analytics = an;
      renderDashboard();
    } catch (e) { if (showErrors) toast(e.message, "err"); }
  }
  function setStat(sel, value, format = fmt) {
    const el = $(sel);
    if (!el) return;
    if (value === null || value === undefined) { el.textContent = "—"; el.dataset.v = ""; return; }
    const to = Number(value), from = Number(el.dataset.v || 0);
    el.dataset.v = String(to);
    if (prefs.motion !== "full" || !Number.isFinite(to) || from === to) { el.textContent = format(to); return; }
    const t0 = performance.now(), dur = 620;
    const step = (t) => {
      const p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 3);
      el.textContent = format(Math.round(from + (to - from) * e));
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  function renderDashboard() {
    const d = state.analytics || {};
    const ch = d.channel || (state.auth && state.auth.channel) || null;
    setStat("#stSubs", ch ? ch.subs : null);
    setStat("#stViews", ch ? ch.views : null);
    setStat("#stVideos", ch ? ch.video_count : null);
    setStat("#stUploads", d.clips_made ?? 0);
    $("#stSubsFoot").textContent = ch ? "from YouTube" : "connect a channel";
    $("#stViewsFoot").textContent = ch ? "channel lifetime" : "connect a channel";
    $("#stVideosFoot").textContent = ch ? "published" : "connect a channel";
    $("#stUploadsFoot").textContent = "clips rendered";
    renderChannelStrip(ch);
    const snaps = (d.snapshots || []).map((s) => ({ ts: s.ts, value: s.subs }));
    drawChart("#dashChart", "#dashChartWrap", "#dashTip", snaps, fmt);
    $("#sparkNote").textContent = snaps.length > 1
      ? `${snaps.length} snapshots · latest ${fmt(snaps[snaps.length - 1].value)} subscribers`
      : "No snapshots yet — refresh analytics to start tracking.";
    renderRecentJobs();
  }
  function renderChannelStrip(ch) {
    const el = $("#channelStrip");
    if (!el) return;
    if (ch && ch.title) {
      el.innerHTML = `<div class="cs-avatar">${ch.thumb ? `<img src="${esc(ch.thumb)}" alt="">` : icon("youtube")}</div>
        <div class="cs-main"><div class="cs-title">${esc(ch.title)}<span class="pill ok">live</span></div><div class="cs-sub">${fmt(ch.subs)} subscribers · ${fmt(ch.views)} views · ${fmt(ch.video_count)} videos</div></div>
        <div class="cs-actions"><button class="btn ghost sm" data-go="analytics">${icon("chart")}Analytics</button><button class="btn primary sm" data-go="create">${icon("create")}New short</button></div>`;
    } else {
      el.innerHTML = `<span class="cs-ico">${icon("youtube")}</span>
        <div class="cs-main"><div class="cs-title">YouTube not connected <span class="pill muted">local mode</span></div><div class="cs-sub">Rendering works offline. Connect a channel for auto-upload, stats and the growth advisor.</div></div>
        <div class="cs-actions"><button class="btn primary sm" data-go="settings" data-tab-target="channel">${icon("youtube")}Connect channel</button></div>`;
    }
  }
  function renderAdvice(el, adv) {
    if (!el) return;
    adv = adv || {};
    const next = adv.next_best_action || "Connect your channel and cut your first Short — the advisor gets sharper with data.";
    const actions = Array.isArray(adv.actions) ? adv.actions : [];
    const hooks = Array.isArray(adv.hook_ideas) ? adv.hook_ideas : [];
    el.innerHTML = `<div class="next-action"><span class="na-label">next best action</span><p>${esc(next)}</p></div>
      ${actions.length ? `<ul class="adv-list">${actions.slice(0, 4).map((a) => `<li>${esc(a)}</li>`).join("")}</ul>` : ""}
      ${hooks.length ? `<div class="hooks"><div class="tw-label" style="margin-bottom:5px">hook ideas · click to copy</div>${hooks.slice(0, 3).map((h) => `<button class="hook" data-copy="${esc(h)}">${esc(h)}</button>`).join("")}</div>` : ""}`;
  }
  function renderRecentJobs() {
    const el = $("#recentJobs");
    if (!el) return;
    if (!state.jobs.length) {
      el.innerHTML = `<div class="empty" style="padding:26px 14px"><span class="empty-icon">${icon("layers")}</span><strong>No jobs yet</strong><p>Paste a link to start the pipeline.</p></div>`;
      return;
    }
    el.innerHTML = state.jobs.slice(0, 5).map((j) => {
      const s = statusMeta(j.status);
      const eta = jobEta(j);
      return `<button class="recent-row" data-open-job="${j.id}">
        <span class="recent-ico">${icon(j.status === "done" ? "check" : j.status === "review" ? "scissors" : "film")}</span>
        <span class="recent-main"><strong>${esc(j.title || j.url)}</strong><small>#${j.id} · ${j.short_count} shorts · ${timeAgo(j.created_at)}${eta ? ` · <span class="eta-text" title="${esc(eta.title)}">${esc(eta.label)}</span>` : ""}</small></span>
        <span class="status ${s.tone}" title="${eta ? esc(eta.title) : ""}"><i></i>${s.label}</span></button>`;
    }).join("");
  }
  function drawChart(svgSel, wrapSel, tipSel, points, format = fmt) {
    const svg = $(svgSel), wrap = $(wrapSel), tip = $(tipSel);
    if (!svg || !wrap) return;
    const W = 820, H = Number(String(svg.getAttribute("viewBox")).split(" ")[3]) || 260;
    if (!points || points.length < 2) {
      const grid = [0, 1, 2, 3].map((i) => {
        const gy = 18 + (i / 3) * (H - 44);
        return `<line x1="46" y1="${gy}" x2="${W - 14}" y2="${gy}" style="stroke:var(--line);stroke-dasharray:2 6;opacity:.5"/>`;
      }).join("");
      svg.innerHTML = grid + `<line x1="46" y1="${H / 2}" x2="${W - 14}" y2="${H / 2}" style="stroke:var(--accent);opacity:.35;stroke-dasharray:4 6"/>
        <text x="${W / 2}" y="${H / 2 - 8}" text-anchor="middle" style="fill:var(--dim);font-size:12px">No snapshot history yet</text>
        <text x="${W / 2}" y="${H / 2 + 12}" text-anchor="middle" style="fill:var(--faint);font-size:9px">Refresh analytics to start drawing this line</text>`;
      if (tip) tip.hidden = true;
      wrap.onmousemove = null;
      return;
    }
    const pad = { l: 46, r: 14, t: 14, b: 26 };
    const vals = points.map((p) => Number(p.value) || 0);
    let min = Math.min(...vals), max = Math.max(...vals);
    if (min === max) { min -= 1; max += 1; }
    const span = max - min;
    const x = (i) => pad.l + (i / (points.length - 1)) * (W - pad.l - pad.r);
    const y = (v) => H - pad.b - ((v - min) / span) * (H - pad.t - pad.b);
    const pts = points.map((p, i) => [x(i), y(Number(p.value) || 0)]);
    const smooth = (arr) => {
      let d = `M${arr[0][0]},${arr[0][1]}`;
      for (let i = 0; i < arr.length - 1; i++) {
        const p0 = arr[i - 1] || arr[i], p1 = arr[i], p2 = arr[i + 1], p3 = arr[i + 2] || p2;
        d += ` C${p1[0] + (p2[0] - p0[0]) / 6},${p1[1] + (p2[1] - p0[1]) / 6} ${p2[0] - (p3[0] - p1[0]) / 6},${p2[1] - (p3[1] - p1[1]) / 6} ${p2[0]},${p2[1]}`;
      }
      return d;
    };
    const path = smooth(pts);
    const area = `${path} L${pts[pts.length - 1][0]},${H - pad.b} L${pts[0][0]},${H - pad.b} Z`;
    const gid = "grad" + svg.id;
    const grid = [0, 1, 2, 3].map((i) => {
      const gy = pad.t + (i / 3) * (H - pad.t - pad.b);
      const val = max - (i / 3) * span;
      return `<line x1="${pad.l}" y1="${gy}" x2="${W - pad.r}" y2="${gy}" style="stroke:var(--line);stroke-dasharray:2 5;opacity:.6"/>
        <text x="${pad.l - 8}" y="${gy + 3}" text-anchor="end" style="fill:var(--faint);font-size:9px">${format(val)}</text>`;
    }).join("");
    const xlabels = `<text x="${pad.l}" y="${H - 6}" style="fill:var(--faint);font-size:9px">${isoDate(points[0].ts)}</text>
      <text x="${W - pad.r}" y="${H - 6}" text-anchor="end" style="fill:var(--faint);font-size:9px">${isoDate(points[points.length - 1].ts)}</text>`;
    svg.innerHTML = `<defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" style="stop-color:var(--accent);stop-opacity:.3"/><stop offset="100%" style="stop-color:var(--accent);stop-opacity:0"/></linearGradient></defs>
      ${grid}
      <path d="${area}" fill="url(#${gid})"/>
      <path d="${path}" fill="none" style="stroke:var(--accent);stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round"/>
      <line id="hoverLine" x1="0" y1="${pad.t}" x2="0" y2="${H - pad.b}" style="stroke:var(--accent);opacity:0;stroke-dasharray:3 4"/>
      <circle id="hoverDot" r="4" style="fill:var(--accent);opacity:0"/>
      <circle cx="${pts[pts.length - 1][0]}" cy="${pts[pts.length - 1][1]}" r="3.4" style="fill:var(--accent);stroke:var(--panel);stroke-width:2"/>
      ${xlabels}`;
    const hoverLine = svg.querySelector("#hoverLine"), hoverDot = svg.querySelector("#hoverDot");
    if (tip) {
      wrap.onmousemove = (e) => {
        const rect = wrap.getBoundingClientRect();
        const rel = (e.clientX - rect.left) / rect.width * W;
        const stepX = (W - pad.l - pad.r) / (points.length - 1);
        let i = Math.round((rel - pad.l) / stepX);
        i = Math.max(0, Math.min(points.length - 1, i));
        const px = pts[i][0], py = pts[i][1];
        hoverLine.setAttribute("x1", px); hoverLine.setAttribute("x2", px); hoverLine.style.opacity = "1";
        hoverDot.setAttribute("cx", px); hoverDot.setAttribute("cy", py); hoverDot.style.opacity = "1";
        tip.hidden = false;
        tip.innerHTML = `<span>${isoDate(points[i].ts)}</span><strong>${format(points[i].value)}</strong>`;
        tip.style.left = `${(px / W) * rect.width}px`;
        tip.style.top = `${(py / H) * rect.height}px`;
      };
      wrap.onmouseleave = () => {
        tip.hidden = true;
        if (hoverLine) hoverLine.style.opacity = "0";
        if (hoverDot) hoverDot.style.opacity = "0";
      };
    }
  }

  /* ---------- jobs ---------- */
  function statusMeta(status) {
    return ({ queued: { label: "Queued", tone: "muted" }, running: { label: "Running", tone: "info" },
      review: { label: "Review", tone: "warn" }, done: { label: "Done", tone: "ok" },
      error: { label: "Failed", tone: "bad" }, canceled: { label: "Canceled", tone: "muted" } })[status] || { label: status || "—", tone: "muted" };
  }
  function stageLabel(stage) {
    return ({ queued: "Queued", downloading: "Reading source / fetching", recording: "Recording live", transcribing: "Transcript", analyzing: "AI picking moments",
      review: "Awaiting review", manual: "Manual cut ready", clipping: "Fetching ranges + rendering", uploading: "Uploading", done: "Done",
      canceling: "Canceling", canceled: "Canceled" })[stage] || stage || "Working";
  }
  const actBtn = (act, id, title, ico) => `<button class="icon-btn" data-act="${act}" data-id="${id}" title="${title}">${icon(ico)}</button>`;
  function filteredJobs() {
    const q = state.jobQuery.trim().toLowerCase();
    return state.jobs.filter((j) => {
      const f = state.filter;
      const matches = f === "all" || (f === "active" && ["queued", "running"].includes(j.status)) ||
        (f === "review" && j.status === "review") || (f === "done" && j.status === "done") ||
        (f === "error" && ["error", "canceled"].includes(j.status));
      const text = `${j.title || ""} ${j.url} ${j.id}`.toLowerCase();
      return matches && (!q || text.includes(q));
    });
  }
  function renderJobs(force = false) {
    const list = filteredJobs();
    const sig = JSON.stringify({ v: state.view, f: state.filter, q: state.jobQuery, o: state.jobOpen,
      j: state.jobs.map((j) => [j.id, j.status, j.stage, Math.round((j.progress || 0) * 100), j.uploads.length, j.candidates.length, j.error ? 1 : 0, j.title]) });
    if (!force && sig === state.jobSig) return;
    state.jobSig = sig;
    if (state.view === "jobs") {
      const box = $("#jobList");
      if (box) box.innerHTML = list.length ? list.map(jobCard).join("") : emptyJobs();
    }
    if (state.view === "create") renderCreateActive();
    updateRail();
  }
  function updateRail() {
    const active = state.jobs.filter((j) => ["queued", "running"].includes(j.status)).length;
    const review = state.jobs.filter((j) => j.status === "review").length;
    const a = $("#railActive"), r = $("#railReview"), b = $("#navBadge");
    if (a) a.textContent = `${active} active`;
    if (r) r.textContent = `${review} review`;
    if (b) { b.textContent = review || ""; b.style.display = review ? "inline-block" : "none"; }
  }
  function emptyJobs() {
    return `<div class="empty"><span class="empty-icon">${icon("layers")}</span><strong>No jobs here yet</strong><p>Paste a YouTube link and the pipeline will fill this up.</p><button class="btn primary sm" data-go="create">${icon("plus")}New short</button></div>`;
  }
  function jobCard(j) {
    const s = statusMeta(j.status);
    const open = !!state.jobOpen[j.id];
    const pct = Math.min(100, Math.max(0, Math.round((j.progress || 0) * 100)));
    const showBar = ["queued", "running", "review"].includes(j.status);
    const eta = jobEta(j);
    const tools = [
      ["queued", "running", "review"].includes(j.status) ? actBtn("cancel", j.id, "Cancel job", "x") : "",
      ["error", "canceled"].includes(j.status) ? actBtn("retry", j.id, "Retry job", "rotate") : "",
      j.status !== "running" ? actBtn("delete", j.id, "Delete job", "trash") : "",
      `<a class="icon-btn" href="${esc(j.url)}" target="_blank" rel="noopener" title="Open source video">${icon("external")}</a>`,
      `<button class="icon-btn" data-act="toggle" data-id="${j.id}" title="Details" aria-expanded="${open}"><span class="chev">${icon("chevron-down")}</span></button>`
    ].join("");
    return `<article class="job${open ? " open" : ""}" data-id="${j.id}">
      <div class="job-top">
        <span class="status ${s.tone}"><i></i>${s.label}</span>
        <div class="job-title"><strong>${esc(j.title || j.url)}</strong><small>#${j.id} · ${j.short_count} shorts · ${timeAgo(j.created_at)}</small></div>
        <div class="job-tools">${tools}</div>
      </div>
      ${showBar ? `<div class="pbar"><span style="width:${j.status === "review" ? 100 : pct}%"></span></div><div class="job-meta"><span>${stageLabel(j.stage)}${j.status === "running" ? " · " + elapsedLabel(j.started_at || j.created_at) + " elapsed" : ""}</span><span class="job-eta" title="${eta ? esc(eta.title) : ""}">${j.status === "review" ? "ready" : eta ? `${pct}% · ${esc(eta.label)}` : `${pct}%`}</span></div>` : ""}
      ${j.error ? `<div class="alert bad" style="margin:10px 16px 12px">${icon("alert")}<span>${esc(j.error)}</span></div>` : ""}
      ${open ? jobBody(j) : ""}
    </article>`;
  }
  function jobBody(j) {
    return `<div class="job-body">${stageRail(j)}${j.status === "review" ? reviewSection(j) : ""}${uploadsSection(j)}${logsSection(j)}</div>`;
  }
  function stageRail(j) {
    const order = ["downloading", "transcribing", "analyzing", "review", "clipping", "uploading", "done"];
    const names = ["source", "transcript", "ai pick", "review", "render", "upload", "done"];
    const stage = j.stage === "recording" ? "downloading" : (j.stage || j.status);
    let cur = order.indexOf(j.status === "done" ? "done" : stage);
    if (cur < 0) cur = order.indexOf(j.status);
    if (cur < 0) cur = j.status === "queued" ? -1 : 0;
    return `<div class="stages">${names.map((n, i) => `<span class="stage-step${i < cur ? " done" : i === cur ? " active" : ""}">${i < cur ? icon("check") : ""}${n}</span>`).join("")}</div>`;
  }
  function editSignature(candidates) {
    return JSON.stringify((candidates || []).map((c) => [Number(c.start), Number(c.end), String(c.title || ""), Array.isArray(c.cuts) ? c.cuts.map((cut) => [Number(cut.start), Number(cut.end)]) : null]));
  }
  function editDuration(ed) {
    if (ed && Array.isArray(ed.cuts) && ed.cuts.length > 1) {
      return ed.cuts.reduce((total, cut) => total + Math.max(0, Number(cut.end) - Number(cut.start)), 0);
    }
    return Math.max(0, Number(ed?.end || 0) - Number(ed?.start || 0));
  }
  function isMultiCut(ed) {
    return Boolean(ed && Array.isArray(ed.cuts) && ed.cuts.length > 1);
  }
  function ensureEdits(j) {
    const candidates = j.candidates || [];
    const sig = editSignature(candidates);
    if (!state.edit[j.id] || state.edit[j.id].length !== candidates.length || state.editSig[j.id] !== sig) {
      state.edit[j.id] = candidates.map((c) => ({
        start: Number(c.start),
        end: Number(c.end),
        title: c.title || "Highlight",
        cuts: Array.isArray(c.cuts) ? c.cuts.map((cut) => ({ start: Number(cut.start), end: Number(cut.end) })) : null,
        picked: true
      }));
      state.editSig[j.id] = sig;
      return true;
    }
    return false;
  }
  function reviewSection(j) {
    ensureEdits(j);
    const privacy = jobOpt(j, "privacy", "public");
    const caption = jobOpt(j, "caption_preset", "gruvbox");
    const animation = jobOpt(j, "caption_animation", "static");
    const reframe = jobOpt(j, "reframe", "crop");
    const rows = j.candidates.map((c, i) => {
      const ed = state.edit[j.id][i];
      const dur = editDuration(ed);
      return `<div class="cand${ed.picked === false ? " off" : ""}" data-job="${j.id}" data-idx="${i}">
        <input type="checkbox" class="cand-pick"${ed.picked === false ? "" : " checked"} title="Include this clip">
        <div class="cand-body">
          <input class="cand-title" data-field="title" value="${esc(ed.title)}" aria-label="Clip title">
          <div class="cand-reason">${esc(c.reason || "Highlight")}${Array.isArray(c.cuts) && c.cuts.length ? ` · ${c.cuts.length} cuts · ${Math.round(dur)}s combined` : ""}</div>
        </div>
        <div class="time-field"><label>in</label><input type="number" step="0.1" min="0" data-field="start" value="${Number(ed.start).toFixed(1)}"></div>
        <div class="time-field"><label>out</label><input type="number" step="0.1" min="0" data-field="end" value="${Number(ed.end).toFixed(1)}"></div>
        <span class="dur">${Math.round(dur)}s</span>
        <button class="icon-btn cand-preview" data-act="preview" data-id="${j.id}" data-idx="${i}" title="${Array.isArray(c.cuts) && c.cuts.length > 1 ? "Preview cut sequence" : "Preview source at this moment"}">${icon("play")}</button>
        <button class="icon-btn" data-act="hooklab" data-id="${j.id}" data-idx="${i}" title="Hook Lab — AI title options">${icon("wand")}</button>
        <button class="icon-btn" data-act="captions" data-id="${j.id}" data-idx="${i}" title="Edit captions">${icon("terminal")}</button>
      </div>`;
    }).join("");
    return `<div class="review">
      <div class="review-head"><div><h4>Pick the moments</h4><p>Trim in/out, rename, then render. ${j.candidates.length} candidates.</p></div>
        <div class="review-tools"><button class="btn ghost sm" data-act="all" data-id="${j.id}">All</button><button class="btn ghost sm" data-act="none" data-id="${j.id}">None</button></div></div>
      <div class="cands">${rows}</div>
      <div class="review-actions">
        <span class="job-publish-note">${icon("info")}${j.options?.auto_upload ? "Auto-upload on · AI metadata" : "Auto-upload off · clips stay in History"}</span>
        <select data-job-opt="privacy" aria-label="Privacy">${optionsHtml([["public", "Public"], ["unlisted", "Unlisted"], ["private", "Private"]], privacy)}</select>
        <select data-job-opt="caption" aria-label="Caption style">${optionsHtml([["gruvbox", "Gruvbox captions"], ["omarchy", "Omarchy green"], ["classic", "Classic"], ["boxed", "Boxed"], ["clean", "Clean"], ["neon", "Neon"]], caption)}</select>
        <select data-job-opt="animation" aria-label="Caption animation">${optionsHtml([["static", "Static captions"], ["word", "Word highlight"], ["pop", "Pop-in captions"]], animation)}</select>
        <select data-job-opt="reframe" aria-label="Reframe">${optionsHtml([["crop", "Center crop"], ["blur", "Blur backdrop"]], reframe)}</select>
        <button class="btn primary sm" data-act="render" data-id="${j.id}">${icon("scissors")}Render selected</button>
      </div>
    </div>`;
  }
  function uploadsSection(j) {
    if (!j.uploads || !j.uploads.length) return "";
    const rerender = j.status === "done"
      ? `<div class="up-actions" style="padding:0 16px 14px;justify-content:flex-start"><button class="btn ghost sm" data-act="rerender" data-id="${j.id}">${icon("rotate")}Re-render</button><span class="hint" style="margin-left:8px">Uses the current GPU/quality/caption settings.</span></div>`
      : "";
    return `<div class="uploads">${j.uploads.map((u) => {
      const file = u.path ? String(u.path).split("/").pop() : "";
      const thumb = u.thumb ? String(u.thumb).split("/").pop() : "";
      const thumbSrc = u.clip_id ? `/api/clips/${u.clip_id}/thumb` : (thumb ? `/media/${encodeURIComponent(thumb)}` : "");
      const qa = u.qa_status && u.qa_status !== "pending" ? `<span class="pill ${u.qa_status === "pass" ? "ok" : u.qa_status === "failed" ? "bad" : "muted"}">QA ${esc(u.qa_status)}</span>` : "";
      return `<div class="upload">
        <div class="up-thumb">${thumbSrc ? `<img src="${thumbSrc}" alt="">` : icon("film")}</div>
        <div class="up-main"><strong>${esc(u.title)}</strong><small>${u.uploaded ? "YouTube · " + esc(u.privacy || "public") : "not uploaded"} ${qa}</small></div>
        <div class="up-actions">
          ${u.url ? `<a class="btn ghost sm" href="${esc(u.url)}" target="_blank" rel="noopener">${icon("external")}Watch</a>` : ""}
          ${!u.uploaded && u.clip_id ? `<button class="btn primary sm" data-act="upload" data-id="${j.id}" data-clip="${u.clip_id}">${icon("youtube")}Upload with AI</button>` : ""}
          ${file && u.clip_id ? `<button class="btn ghost sm" data-act="play" data-clip="${u.clip_id}" data-title="${esc(u.title)}">${icon("play")}Play</button><button class="icon-btn" data-copy="${esc(u.path)}" title="Copy file path">${icon("copy")}</button>` : file ? `<button class="btn ghost sm" data-act="play" data-file="${esc(file)}">${icon("play")}Play</button><button class="icon-btn" data-copy="${esc(u.path)}" title="Copy file path">${icon("copy")}</button>` : ""}
        </div></div>`;
    }).join("")}</div>${rerender}`;
  }
  function logsSection(j) {
    const lines = renderLogLines(j.id);
    return `<details class="logs"${j.status === "running" ? " open" : ""}><summary>${icon("terminal")} activity log <span>${(state.logs[j.id] || []).length}</span></summary>
      <div class="logs-body" data-logbox="${j.id}">${lines}</div></details>`;
  }
  function renderLogLines(id) {
    const logs = state.logs[id] || [];
    if (!logs.length) return `<div class="logs-empty">Waiting for activity…</div>`;
    return logs.map((l) => `<div class="log-line ${l.level === "error" ? "err" : l.level === "warn" ? "warn" : ""}"><span class="lt">${new Date(l.ts * 1000).toLocaleTimeString([], { hour12: false })}</span><span>${esc(l.message)}</span></div>`).join("");
  }
  async function pullLogs(job) {
    if (!job || !state.jobOpen[job.id] || state.logBusy[job.id]) return;
    state.logBusy[job.id] = true;
    try {
      const since = state.logCursor[job.id] || 0;
      const data = await api(`/jobs/${job.id}?since_log=${since}`);
      const logs = data.logs || [];
      if (logs.length) {
        state.logCursor[job.id] = logs[logs.length - 1].id;
        state.logs[job.id] = [...(state.logs[job.id] || []), ...logs];
        updateLogBox(job.id);
      }
    } catch (_) { /* server busy */ }
    finally { state.logBusy[job.id] = false; }
  }
  function updateLogBox(id) {
    const box = document.querySelector(`[data-logbox="${id}"]`);
    if (!box) return;
    const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 60;
    box.innerHTML = renderLogLines(id);
    if (nearBottom) box.scrollTop = box.scrollHeight;
  }
  async function pollJobs(force = false) {
    if (state.polling) return;
    state.polling = true;
    try {
      const jobs = await api("/jobs");
      let finished = false;
      jobs.forEach((j) => {
        const prev = state.prevStatus[j.id];
        if (prev && prev !== j.status) {
          if (j.status === "done") { finished = true; toast(`Job #${j.id} finished — ${j.uploads.length} clip${j.uploads.length === 1 ? "" : "s"}`, "ok", "Rendered"); confetti(); }
          if (j.status === "review") toast(j.manual ? "Manual section downloaded — preview ready" : "Highlights are ready for review", "warn", "Your turn");
          if (j.status === "error") toast(j.error || "The pipeline failed", "err", "Job failed");
        }
        state.prevStatus[j.id] = j.status;
        if (!(j.id in state.jobOpen)) state.jobOpen[j.id] = ["review", "error"].includes(j.status);
        if (j.status === "review") ensureEdits(j);
      });
      state.jobs = jobs;
      renderJobs(force);
      if (state.createMode === "manual") renderManualPanel();
      if (state.view === "dashboard") renderRecentJobs();
      if (state.view === "history" && finished) loadHistory();
      const open = jobs.filter((j) => state.jobOpen[j.id]);
      await Promise.all(open.slice(0, 6).map(pullLogs));
    } catch (_) { /* backend restarting */ }
    finally { state.polling = false; }
  }
  function renderCreateActive() {
    const el = $("#createActive");
    if (!el) return;
    const active = state.jobs.filter((j) => !j.manual && ["queued", "running", "review"].includes(j.status)).slice(0, 4);
    el.innerHTML = active.length ? `<div style="margin-top:24px"><div class="eyebrow">live pipeline</div>${active.map(jobCard).join("")}</div>` : "";
  }
  function timeLabel(seconds) {
    const s = Math.max(0, Math.floor(Number(seconds) || 0));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  }
  function openCutSequence(job, cuts) {
    const clean = (cuts || [])
      .map((cut) => ({ start: Number(cut.start), end: Number(cut.end) }))
      .filter((cut) => Number.isFinite(cut.start) && Number.isFinite(cut.end) && cut.end > cut.start + 0.5);
    if (clean.length < 2) return toast("No cut sequence to preview", "warn");
    const source = job.source || `job${job.id}_source.mp4`;
    const total = clean.reduce((sum, cut) => sum + cut.end - cut.start, 0);
    const buttons = clean.map((cut, i) => `
      <button class="cut-chip" data-cut-index="${i}">
        <strong>Cut ${i + 1}</strong><span>${timeLabel(cut.start)}–${timeLabel(cut.end)}</span>
      </button>`).join("");
    showModal({
      title: `Cut sequence · ${clean.length} clips`,
      wide: true,
      body: `<div class="cut-sequence">
        <video id="cutSequenceVideo" class="clip-video" controls autoplay playsinline preload="metadata" src="/media/${encodeURIComponent(source)}"></video>
        <div class="cut-sequence-head"><span id="cutSequenceStatus">Loading sequence…</span><span>${clean.length} cuts · ${Math.round(total)}s combined</span></div>
        <div class="cut-list" id="cutSequenceList">${buttons}</div>
        <p class="hint">Previewing only the selected cuts, one after another. The finished Short burns in captions and crops to 9:16.</p>
      </div>`
    });
    const video = document.getElementById("cutSequenceVideo");
    const status = document.getElementById("cutSequenceStatus");
    const list = document.getElementById("cutSequenceList");
    if (!video || !status || !list) return;
    let current = -1;
    let switching = false;
    let complete = false;
    const paint = () => {
      [...list.querySelectorAll("[data-cut-index]")].forEach((button, i) => button.classList.toggle("on", i === current));
      if (complete) status.textContent = "Sequence complete";
      else if (current >= 0 && current < clean.length) status.textContent = `Playing cut ${current + 1} of ${clean.length} · ${timeLabel(clean[current].start)}–${timeLabel(clean[current].end)}`;
    };
    const playCut = (i) => {
      if (i >= clean.length) {
        complete = true;
        current = clean.length;
        video.pause();
        paint();
        return;
      }
      current = i;
      complete = false;
      switching = true;
      paint();
      const start = () => video.play().catch(() => {
        switching = false;
        status.textContent = "Press play to preview the cut sequence";
      });
      if (Math.abs(video.currentTime - clean[i].start) < 0.08) {
        switching = false;
        start();
        return;
      }
      const onSeeked = () => {
        video.removeEventListener("seeked", onSeeked);
        switching = false;
        start();
      };
      video.addEventListener("seeked", onSeeked);
      try { video.currentTime = clean[i].start; } catch (_) { switching = false; start(); }
    };
    video.addEventListener("loadedmetadata", () => playCut(0), { once: true });
    video.addEventListener("timeupdate", () => {
      if (switching || complete || current < 0 || current >= clean.length) return;
      if (video.currentTime >= clean[current].end - 0.06) {
        if (current + 1 < clean.length) playCut(current + 1);
        else { complete = true; current = clean.length; video.pause(); paint(); }
      }
    });
    video.addEventListener("ended", () => {
      if (complete) return;
      if (current + 1 < clean.length) playCut(current + 1);
      else { complete = true; current = clean.length; paint(); }
    });
    video.addEventListener("error", () => { status.textContent = "Source video unavailable for sequence preview"; });
    list.addEventListener("click", (event) => {
      const button = event.target.closest("[data-cut-index]");
      if (!button) return;
      complete = false;
      playCut(Number(button.dataset.cutIndex));
    });
  }
  function openPreview(id, idx) {
    const job = state.jobs.find((j) => j.id === id);
    if (!job) return;
    const ed = state.edit[id] && state.edit[id][idx];
    const candidate = job.candidates[idx] || {};
    const cuts = ed && Array.isArray(ed.cuts) ? ed.cuts : candidate.cuts;
    if (Array.isArray(cuts) && cuts.length > 1) {
      if (job.source) return openCutSequence(job, cuts);
      return openCutLinks(job, cuts);
    }
    const start = Math.floor(ed ? ed.start : (candidate.start || 0));
    if (job.source) {
      const fresh = `${Date.now()}`;
      showModal({
        title: `Source preview · ${start}s`,
        wide: true,
        body: `<video id="sourcePreviewVideo" class="clip-video" controls autoplay playsinline preload="metadata" src="/media/${encodeURIComponent(job.source)}?v=${fresh}"></video><p class="hint" style="margin-top:10px">Previewing the local source recording. The render crops this to 9:16.</p>`
      });
      const video = document.getElementById("sourcePreviewVideo");
      if (!video) return;
      const seek = () => { try { video.currentTime = start; } catch (_) { /* live edge */ } };
      if (video.readyState >= 1) seek();
      else video.addEventListener("loadedmetadata", seek, { once: true });
      return;
    }
    const vid = youtubeId(job.url);
    if (!vid) return toast("This source is not a YouTube video", "warn");
    showModal({ title: `Source preview · ${start}s`, wide: true, body: `<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/${vid}?start=${start}&autoplay=1&rel=0" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe></div><p class="hint" style="margin-top:10px">The source opens at the clip start. The render crops this to 9:16.</p>` });
  }
  function openCutLinks(job, cuts) {
    const clean = (cuts || [])
      .map((cut) => ({ start: Number(cut.start), end: Number(cut.end) }))
      .filter((cut) => Number.isFinite(cut.start) && Number.isFinite(cut.end) && cut.end > cut.start + 0.5);
    if (!clean.length) return toast("No cuts to preview", "warn");
    const vid = youtubeId(job.url);
    if (!vid) return toast("This source is not a YouTube video", "warn");
    const total = clean.reduce((sum, cut) => sum + cut.end - cut.start, 0);
    const first = Math.floor(clean[0].start);
    showModal({
      title: `Cut sequence · ${clean.length} clips`,
      wide: true,
      body: `<div class="cut-sequence">
        <div class="video-frame"><iframe id="cutLinkFrame" src="https://www.youtube-nocookie.com/embed/${vid}?start=${first}&autoplay=1&rel=0" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
        <div class="cut-sequence-head"><span id="cutLinkStatus">Source preview starts at cut 1</span><span>${clean.length} cuts · ${Math.round(total)}s combined</span></div>
        <div class="cut-list">${clean.map((cut, i) => `<button class="cut-chip${i === 0 ? " on" : ""}" data-cut-link="${i}"><strong>Cut ${i + 1}</strong><span>${timeLabel(cut.start)}–${timeLabel(cut.end)}</span></button>`).join("")}</div>
        <p class="hint">Nothing has been downloaded yet. These buttons jump to each chosen moment on YouTube; only the final selected ranges are fetched during render.</p>
      </div>`
    });
    const frame = document.getElementById("cutLinkFrame");
    const list = document.querySelector(".cut-list");
    if (!list) return;
    list.addEventListener("click", (event) => {
      const button = event.target.closest("[data-cut-link]");
      if (!button || !frame) return;
      const index = Number(button.dataset.cutLink);
      const cut = clean[index];
      if (!cut) return;
      frame.src = `https://www.youtube-nocookie.com/embed/${vid}?start=${Math.floor(cut.start)}&autoplay=1&rel=0`;
      const status = document.getElementById("cutLinkStatus");
      if (status) status.textContent = `Playing cut ${index + 1} of ${clean.length} · ${timeLabel(cut.start)}–${timeLabel(cut.end)}`;
      list.querySelectorAll("[data-cut-link]").forEach((el) => el.classList.toggle("on", el === button));
    });
  }
  const youtubeId = (url) => { const m = String(url || "").match(/(?:v=|youtu\.be\/|shorts\/|live\/|embed\/)([\w-]{11})/); return m ? m[1] : ""; };
  function openClip(file) {
    // Break browser caches when a job is re-rendered under the same filename.
    const fresh = `${Date.now()}`;
    showModal({ title: "Rendered clip", wide: true, body: `<video class="clip-video" controls autoplay playsinline src="/media/${encodeURIComponent(file)}?v=${fresh}"></video><p class="hint" style="margin-top:8px">${esc(file)}</p>` });
  }
  function openStoredClip(id, title = "Rendered clip") {
    const fresh = `${Date.now()}`;
    showModal({ title, wide: true, body: `<video class="clip-video" controls autoplay playsinline src="/api/clips/${encodeURIComponent(id)}/file?v=${fresh}"></video><p class="hint" style="margin-top:8px">job clip #${esc(id)}</p>` });
  }
  async function handleJobClick(e) {
    const openEl = e.target.closest("[data-open-job]");
    if (openEl) { go("jobs"); state.jobOpen[Number(openEl.dataset.openJob)] = true; renderJobs(true); return; }
    const btn = e.target.closest("[data-act]");
    if (!btn) return;
    const id = Number(btn.dataset.id), act = btn.dataset.act;
    const job = state.jobs.find((j) => j.id === id);
    if (act === "toggle") {
      state.jobOpen[id] = !state.jobOpen[id];
      renderJobs(true);
      if (state.jobOpen[id] && job) pullLogs(job);
      return;
    }
    if (act === "preview") return openPreview(id, Number(btn.dataset.idx));
    if (act === "play") return btn.dataset.clip ? openStoredClip(btn.dataset.clip, btn.dataset.title || "Rendered clip") : openClip(btn.dataset.file);
    if (act === "hooklab") return openHookLab(id, Number(btn.dataset.idx));
    if (act === "captions") return openCaptionEditor(id, Number(btn.dataset.idx));
    if (act === "upload") return openUploadModal(Number(btn.dataset.clip));
    if (!job) return;
    if (act === "all" || act === "none") {
      const card = btn.closest(".job");
      const on = act === "all";
      card.querySelectorAll(".cand").forEach((row) => {
        const idx = Number(row.dataset.idx);
        row.querySelector(".cand-pick").checked = on;
        row.classList.toggle("off", !on);
        if (state.edit[id] && state.edit[id][idx]) state.edit[id][idx].picked = on;
      });
      return;
    }
    if (act === "render") return renderSelected(id, btn);
    if (act === "rerender") {
      btn.classList.add("loading"); btn.disabled = true;
      try {
        await api(`/jobs/${id}/rerender`, { method: "POST" });
        toast(`Job #${id} re-rendering`, "ok", "Queued");
        state.jobOpen[id] = true;
        pollJobs(true);
      } catch (err) { toast(err.message, "err"); }
      finally { btn.classList.remove("loading"); btn.disabled = false; }
      return;
    }
    if (act === "cancel") {
      if (!(await confirmDialog(`Cancel job #${id}?`, "The current step stops. Clips already rendered stay on disk.", "Cancel job", true))) return;
      try { await api(`/jobs/${id}/cancel`, { method: "POST" }); toast("Canceling job", "warn"); pollJobs(); } catch (err) { toast(err.message, "err"); }
      return;
    }
    if (act === "retry") {
      try { await api(`/jobs/${id}/retry`, { method: "POST" }); toast(`Job #${id} queued again`, "ok"); state.logs[id] = []; state.logCursor[id] = 0; delete state.edit[id]; delete state.editSig[id]; state.jobOpen[id] = true; pollJobs(true); } catch (err) { toast(err.message, "err"); }
      return;
    }
    if (act === "delete") {
      if (!(await confirmDialog(`Delete job #${id}?`, "This removes the job, its log and every rendered file for this job. This cannot be undone.", "Delete", true))) return;
      try { await api(`/jobs/${id}`, { method: "DELETE" }); delete state.jobOpen[id]; delete state.edit[id]; delete state.editSig[id]; toast("Job deleted", "warn"); pollJobs(true); } catch (err) { toast(err.message, "err"); }
    }
  }
  function handleJobInput(e) {
    const pick = e.target.closest(".cand-pick");
    const row = e.target.closest(".cand");
    if (!row) return;
    const id = Number(row.dataset.job), idx = Number(row.dataset.idx);
    ensureEdits({ id, candidates: state.jobs.find((j) => j.id === id)?.candidates || [] });
    const ed = state.edit[id] && state.edit[id][idx];
    if (!ed) return;
    if (pick) { ed.picked = pick.checked; row.classList.toggle("off", !pick.checked); return; }
    const field = e.target.dataset.field;
    if (!field) return;
    ed[field] = field === "title" ? e.target.value : Number(e.target.value);
    if (field !== "title") updateDur(row);
  }
  function updateDur(row) {
    const id = Number(row.dataset.job), idx = Number(row.dataset.idx);
    const ed = state.edit[id]?.[idx];
    const dur = ed ? editDuration(ed) : Math.max(0, Number(row.querySelector('[data-field="end"]').value) - Number(row.querySelector('[data-field="start"]').value));
    const max = isMultiCut(ed) ? 180 : 120;
    const bad = dur <= 1 || dur > max;
    const label = row.querySelector(".dur");
    if (label) { label.textContent = `${Math.round(dur)}s`; label.classList.toggle("bad", bad); }
    row.classList.toggle("bad", bad);
  }
  async function renderSelected(id, btn) {
    const card = btn.closest(".job");
    if (!card) return;
    const job = state.jobs.find((j) => j.id === id);
    if (job && ensureEdits(job)) {
      renderJobs(true);
      return toast("Candidates changed — review the new timestamps before rendering", "warn");
    }
    const clips = [];
    let bad = false;
    card.querySelectorAll(".cand").forEach((row) => {
      if (!row.querySelector(".cand-pick").checked) return;
      const idx = Number(row.dataset.idx);
      const ed = state.edit[id]?.[idx];
      const start = Number(row.querySelector('[data-field="start"]').value);
      const end = Number(row.querySelector('[data-field="end"]').value);
      const title = row.querySelector('[data-field="title"]').value.trim();
      const dur = ed ? editDuration(ed) : end - start;
      const max = isMultiCut(ed) ? 180 : 120;
      const cutsValid = !isMultiCut(ed) || ed.cuts.every((cut) => Number(cut.end) > Number(cut.start) + 1);
      if (!(end > start + 1) || !cutsValid || dur <= 1 || dur > max) { row.classList.add("bad"); bad = true; return; }
      clips.push({ index: idx, start, end, title: title || `Highlight ${idx + 1}` });
    });
    if (bad) return toast("Check the in/out points — separate clips must be 2–120s; combined multi-cuts can be up to 180s", "err");
    if (!clips.length) return toast("Select at least one moment", "warn");
    const payload = {
      clips,
      privacy: card.querySelector('[data-job-opt="privacy"]').value,
      caption_preset: card.querySelector('[data-job-opt="caption"]').value,
      caption_animation: card.querySelector('[data-job-opt="animation"]').value,
      reframe: card.querySelector('[data-job-opt="reframe"]').value
    };
    btn.classList.add("loading"); btn.disabled = true;
    try {
      await api(`/jobs/${id}/select`, { method: "POST", body: JSON.stringify(payload) });
      toast(`${clips.length} clip${clips.length === 1 ? "" : "s"} queued for rendering`, "ok");
      state.jobOpen[id] = true;
      pollJobs(true);
    } catch (err) { toast(err.message, "err"); }
    finally { btn.classList.remove("loading"); btn.disabled = false; }
  }
  function captionOptions() {
    return {
      caption_preset: $("#caption_preset")?.value || "gruvbox",
      caption_size: Number($("#caption_size")?.value) || 46,
      caption_position: $("#caption_position")?.value || "bottom",
      caption_color: $("#caption_color")?.value || "#fabd2f",
      caption_highlight: $("#caption_highlight")?.value || "#fe8019",
      caption_animation: $("#caption_animation")?.value || "static",
      caption_uppercase: !!$("#caption_uppercase")?.checked,
      caption_box: !!$("#caption_box")?.checked
    };
  }

  function setCreateMode(mode) {
    state.createMode = ["manual", "batch"].includes(mode) ? mode : "auto";
    $$("#createModeTabs .tab").forEach((b) => b.classList.toggle("active", b.dataset.createMode === state.createMode));
    const manual = state.createMode === "manual";
    const batch = state.createMode === "batch";
    if ($("#countPicker")) $("#countPicker").hidden = manual || batch;
    if ($("#manualTimes")) $("#manualTimes").hidden = !manual;
    if ($("#durationField")) $("#durationField").hidden = manual;
    if ($("#layoutField")) $("#layoutField").hidden = manual;
    if ($("#autoUploadField")) $("#autoUploadField").hidden = manual || batch;
    if ($("#createFlow")) $("#createFlow").hidden = manual;
    if ($("#createActive")) $("#createActive").hidden = manual;
    if ($("#manualPanel")) $("#manualPanel").hidden = !manual;
    if ($("#batchPanel")) $("#batchPanel").hidden = !batch;
    const composer = $(".composer");
    if (composer) composer.hidden = batch;
    if ($("#btnAnalyzeLabel")) $("#btnAnalyzeLabel").textContent = manual ? "Download preview" : "Find moments";
    if (manual) renderManualPanel();
  }

  async function queueBatch() {
    const btn = $("#btnBatch");
    const urls = $("#batchUrls").value.split("\n").map((s) => s.trim()).filter(Boolean);
    if (!urls.length) return toast("Add at least one YouTube URL", "warn");
    if (urls.some((u) => !/(youtube\.com|youtu\.be)\//i.test(u))) return toast("One or more URLs are not YouTube links", "err");
    btn.classList.add("loading"); btn.disabled = true;
    try {
      const r = await api("/batches", { method: "POST", body: JSON.stringify({
        urls, name: $("#batchName").value.trim(), kind: $("#batchKind").value,
        short_count: Number($("#batchCount").value) || 2,
        privacy: $("#createPrivacy").value,
        clip_duration: Number($("#createDuration").value) || 45,
        clip_mode: $("#createMode").value,
        reframe: $("#createReframe").value,
        ...captionOptions()
      }) });
      $("#batchUrls").value = "";
      toast(`${r.job_ids.length} videos queued in “${r.name}”`, "ok", "Batch queued");
      r.job_ids.forEach((id) => { state.jobOpen[id] = false; });
      go("jobs");
      pollJobs(true);
    } catch (e) { toast(e.message, "err"); }
    finally { btn.classList.remove("loading"); btn.disabled = false; }
  }

  function parseTimestamp(value) {
    const raw = String(value ?? "").trim();
    if (!raw) return NaN;
    if (!raw.includes(":")) return Number(raw);
    const parts = raw.split(":").map((part) => Number(part));
    if (parts.some((part) => !Number.isFinite(part))) return NaN;
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    return NaN;
  }

  async function startAnalyze() {
    const input = $("#urlInput"), hint = $("#urlHint"), btn = $("#btnAnalyze");
    const url = input.value.trim();
    input.classList.remove("bad"); hint.hidden = true;
    if (!url) { input.classList.add("bad"); hint.textContent = "Paste a YouTube link first."; hint.hidden = false; input.focus(); return; }
    if (!/(youtube\.com|youtu\.be)\//i.test(url)) { input.classList.add("bad"); hint.textContent = "That does not look like a YouTube URL."; hint.hidden = false; return; }
    if (state.createMode === "manual") return startManual(url, btn, input, hint);
    btn.classList.add("loading"); btn.disabled = true;
    try {
      const r = await api("/jobs", { method: "POST", body: JSON.stringify({
        url, short_count: state.count,
        privacy: $("#createPrivacy").value,
        clip_duration: Number($("#createDuration").value) || 45,
        clip_mode: $("#createMode").value,
        reframe: $("#createReframe").value,
        auto_upload: state.createMode === "auto" && !!$("#createAutoUpload")?.checked,
        ...captionOptions()
      }) });
      input.value = "";
      state.jobOpen[r.id] = true;
      toast(`Job #${r.id} started — reading the timed transcript before downloading video`, "ok", "Analyzing");
      go("jobs");
    } catch (err) { toast(err.message, "err"); }
    finally { btn.classList.remove("loading"); btn.disabled = false; }
  }

  async function startManual(url, btn, input, hint) {
    const start = parseTimestamp($("#manualStart").value);
    const end = parseTimestamp($("#manualEnd").value);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0) {
      hint.textContent = "Enter valid start and end times (for example 1:20 and 2:05).";
      hint.hidden = false;
      $("#manualStart").focus();
      return;
    }
    if (end <= start + 1) {
      hint.textContent = "End time must be at least one second after start.";
      hint.hidden = false;
      return;
    }
    if (end - start > 180) {
      hint.textContent = "Manual cuts can be up to 3 minutes long.";
      hint.hidden = false;
      return;
    }
    btn.classList.add("loading"); btn.disabled = true;
    try {
      const r = await api("/manual", { method: "POST", body: JSON.stringify({
        url, start, end,
        privacy: $("#createPrivacy").value,
        reframe: $("#createReframe").value,
        ...captionOptions()
      }) });
      state.manualJobId = r.id;
      state.jobOpen[r.id] = true;
      toast(`Downloading ${timeLabel(start)}–${timeLabel(end)} only`, "ok", "Manual cut");
      if ($("#manualPanel")) $("#manualPanel").hidden = false;
      pollJobs(true);
    } catch (err) { toast(err.message, "err"); }
    finally { btn.classList.remove("loading"); btn.disabled = false; }
  }

  function manualJob() {
    if (state.manualJobId) {
      const found = state.jobs.find((j) => j.id === state.manualJobId);
      if (found) return found;
    }
    return state.jobs.find((j) => j.manual) || null;
  }

  function renderManualPanel() {
    const panel = $("#manualPanel");
    if (!panel || state.createMode !== "manual") return;
    panel.hidden = false;
    const job = manualJob();
    const status = $("#manualStatus"), meta = $("#manualMeta"), progress = $("#manualProgress");
    const wrap = $("#manualVideoWrap"), video = $("#manualVideo");
    const renderBtn = $("#manualRender"), openBtn = $("#manualOpenJob"), title = $("#manualTitle");
    if (!job) {
      if (status) status.innerHTML = `<i></i>Ready`;
      if (meta) meta.textContent = "Enter start and end timestamps, then download only that range.";
      if (progress) progress.style.width = "0%";
      if (wrap) wrap.hidden = true;
      if (renderBtn) renderBtn.hidden = true;
      if (openBtn) openBtn.hidden = true;
      if (title) title.textContent = "Download a specific moment";
      return;
    }
    const s = statusMeta(job.status);
    if (title) title.textContent = job.title || `Manual cut #${job.id}`;
    if (status) status.innerHTML = `<i></i>${s.label}${job.status === "running" ? " · " + stageLabel(job.stage) : ""}`;
    if (progress) progress.style.width = `${Math.round((job.progress || 0) * 100)}%`;
    const opts = job.options || {};
    const start = Number(opts.manual_start ?? job.candidates?.[0]?.start ?? 0);
    const end = Number(opts.manual_end ?? job.candidates?.[0]?.end ?? 0);
    const startInput = $("#manualStart"), endInput = $("#manualEnd");
    if (state.manualInputJob !== job.id) {
      if (startInput) startInput.value = Number.isInteger(start) ? timeLabel(start) : start.toFixed(1);
      if (endInput) endInput.value = Number.isInteger(end) ? timeLabel(end) : end.toFixed(1);
      state.manualInputJob = job.id;
    }
    if (meta) {
      const eta = jobEta(job);
      meta.textContent = job.status === "error"
        ? job.error || "Manual cut failed"
        : job.status === "running"
          ? `${stageLabel(job.stage)} · ${Math.round((job.progress || 0) * 100)}%${eta ? ` · ${eta.label}` : ""} — only ${timeLabel(start)}–${timeLabel(end)} is being fetched.`
          : `${timeLabel(start)}–${timeLabel(end)} · ${Math.max(0, Math.round(end - start))}s · ${job.uploads?.length ? "rendered" : (job.preview ? "raw section downloaded" : "waiting")}${eta ? ` · ${eta.label}` : ""}`;
    }
    const canPreview = !!job.preview && ["review", "done"].includes(job.status);
    if (wrap && video) {
      wrap.hidden = !canPreview;
      if (canPreview) {
        const src = `/media/${encodeURIComponent(job.preview)}?v=${job.updated_at || job.id}`;
        if (!video.src.endsWith(src)) video.src = src;
      }
    }
    if (renderBtn) {
      renderBtn.hidden = job.status !== "review";
      renderBtn.dataset.id = job.id;
      renderBtn.disabled = false;
    }
    if (openBtn) openBtn.hidden = !job.id;
    openBtn.dataset.id = job.id;
  }

  async function renderManualCut(btn) {
    const job = manualJob();
    if (!job) return;
    const start = parseTimestamp($("#manualStart").value);
    const end = parseTimestamp($("#manualEnd").value);
    const opts = job.options || {};
    if (!Number.isFinite(start) || !Number.isFinite(end) || Math.abs(start - Number(opts.manual_start)) > 0.2 || Math.abs(end - Number(opts.manual_end)) > 0.2) {
      return toast("Download the preview for the current range before rendering", "warn");
    }
    const candidate = job.candidates?.[0] || {};
    btn.classList.add("loading"); btn.disabled = true;
    try {
      await api(`/jobs/${job.id}/select`, { method: "POST", body: JSON.stringify({
        clips: [{ index: 0, start, end, title: candidate.title || "Manual cut" }],
        privacy: $("#createPrivacy").value,
        reframe: $("#createReframe").value,
        ...captionOptions()
      }) });
      toast("Manual cut queued for 9:16 render", "ok", "Rendering");
      pollJobs(true);
    } catch (err) { toast(err.message, "err"); }
    finally { btn.classList.remove("loading"); btn.disabled = false; }
  }

  /* ---------- history ---------- */
  async function loadHistory() {
    try {
      state.history = await api("/clips");
      state.historyLoaded = true;
      const ids = new Set(state.history.map((c) => Number(c.id)));
      Object.keys(state.historySel).forEach((id) => { if (!ids.has(Number(id))) delete state.historySel[id]; });
      renderHistory();
      clearTimeout(state.historyPoll);
      if (state.history.some((c) => c.upload_state === "uploading")) {
        state.historyPoll = setTimeout(() => { if (state.view === "history") loadHistory(); }, 3000);
      }
    } catch (e) { toast("Could not load history: " + e.message, "err"); }
  }

  function filteredHistory() {
    let list = state.history;
    if (state.historyFilter === "local") list = list.filter((c) => !c.uploaded);
    if (state.historyFilter === "uploaded") list = list.filter((c) => c.uploaded);
    const q = state.historyQuery.trim().toLowerCase();
    if (!q) return list;
    return list.filter((c) => `${c.title || ""} ${c.job_title || ""} ${c.id} ${c.job_id}`.toLowerCase().includes(q));
  }

  function renderHistory() {
    const grid = $("#historyGrid");
    if (!grid) return;
    const list = filteredHistory();
    const selected = Object.keys(state.historySel).filter((id) => state.historySel[id]).length;
    const count = $("#historyCount");
    if (count) count.textContent = `${state.history.length} clip${state.history.length === 1 ? "" : "s"}${selected ? ` · ${selected} selected` : ""}`;
    const del = $("#historyDeleteSelected");
    if (del) del.disabled = selected === 0;
    const allBtn = $("#historySelectAll");
    if (allBtn) {
      const allOn = list.length > 0 && list.every((c) => state.historySel[c.id]);
      allBtn.innerHTML = `${icon(allOn ? "x" : "check")}${allOn ? "Deselect all" : "Select all"}`;
    }
    if (!list.length) {
      grid.innerHTML = `<div class="empty history-empty"><span class="empty-icon">${icon("film")}</span><strong>${state.history.length ? "No clips match that search" : "No generated clips yet"}</strong><p>${state.history.length ? "Try a different title or job id." : "Render a Short and it will show up here."}</p><button class="btn primary sm" data-go="create">${icon("plus")}New short</button></div>`;
      return;
    }
    grid.innerHTML = list.map((c) => {
      const on = !!state.historySel[c.id];
      const thumb = c.thumb && c.exists ? `/api/clips/${c.id}/thumb` : "";
      const uploading = c.upload_state === "uploading";
      const failedUpload = c.upload_state === "error";
      const status = !c.exists
        ? `<span class="status bad"><i></i>missing file</span>`
        : c.uploaded
          ? `<span class="status ok"><i></i>${c.scheduled_at ? "Scheduled" : "YouTube"}</span>`
          : uploading
            ? `<span class="status warn"><i></i>uploading ${Math.round(c.upload_progress || 0)}%</span>`
            : failedUpload
              ? `<span class="status bad"><i></i>upload failed</span>`
              : `<span class="status muted"><i></i>not uploaded</span>`;
      const qaPill = c.qa_status && c.qa_status !== "pending" ? `<span class="pill ${c.qa_status === "pass" ? "ok" : c.qa_status === "failed" ? "bad" : "muted"}">QA ${esc(c.qa_status)}</span>` : "";
      return `<article class="history-card${on ? " selected" : ""}" data-history-card="${c.id}">
        <input type="checkbox" class="history-check" data-history-check="${c.id}"${on ? " checked" : ""} aria-label="Select ${esc(c.title)}">
        <div class="history-thumb" data-hist-play="${c.id}" role="button" tabindex="0" aria-label="Play ${esc(c.title)}">
          ${thumb ? `<img src="${thumb}" alt="" loading="lazy">` : `<div style="display:grid;place-items:center;height:100%;color:var(--faint)">${icon("film")}</div>`}
          ${c.exists ? `<button class="history-play" data-hist-play="${c.id}" aria-label="Play clip"><span>${icon("play")}</span></button>` : ""}
        </div>
        <div class="history-body">
          <div class="history-title" title="${esc(c.title)}">${esc(c.title)}</div>
          <div class="history-meta"><span>${timeLabel(c.duration)}</span><span>${timeAgo(c.created_at)}</span><span>${qaPill}</span></div>
          <div class="history-meta"><span>${status}</span><span>job #${c.job_id}</span></div>
          ${c.upload_error ? `<div class="history-meta"><span class="inline-error">${esc(c.upload_error)}</span></div>` : ""}
          <div class="history-actions">
            ${c.exists ? `<button class="btn ghost sm" data-hist-play="${c.id}">${icon("play")}Play</button>` : ""}
            ${c.exists && !c.uploaded && !uploading ? `<button class="btn primary sm" data-hist-upload="${c.id}">${icon("youtube")}Upload with AI</button>` : ""}
            <button class="btn ghost sm" data-hist-job="${c.job_id}">${icon("layers")}Job</button>
            ${c.url ? `<a class="btn ghost sm" href="${esc(c.url)}" target="_blank" rel="noopener">${icon("external")}Watch</a>` : ""}
          </div>
        </div>
      </article>`;
    }).join("");
  }

  function openHistoryClip(id) {
    const clip = state.history.find((c) => c.id === id);
    if (!clip) return;
    if (!clip.exists || !clip.file) return toast("This clip's local file is missing", "warn");
    showModal({
      title: clip.title,
      wide: true,
      body: `<video class="clip-video" controls autoplay playsinline src="/api/clips/${clip.id}/file?v=${Date.now()}"></video>
        <p class="hint" style="margin-top:8px">${timeLabel(clip.duration)} · ${clip.uploaded ? "Published to YouTube" : "Saved locally"} · job #${clip.job_id} · QA ${esc(clip.qa_status || "pending")}</p>
        ${clip.url ? `<p class="hint"><a href="${esc(clip.url)}" target="_blank" rel="noopener">Open on YouTube ↗</a></p>` : ""}`,
      foot: `${clip.uploaded ? `<button class="btn ghost danger-text" id="btnDeleteYt">${icon("trash")}Remove from YouTube</button>` : `<button class="btn primary" id="btnUploadFromView">${icon("youtube")}Upload with AI</button>`}<a class="btn ghost" href="/api/clips/${clip.id}/export">${icon("download")}Download MP4</a>`
    });
    if ($("#btnUploadFromView")) $("#btnUploadFromView").onclick = () => { closeModal(); openUploadModal(clip.id); };
    if ($("#btnDeleteYt")) $("#btnDeleteYt").onclick = async () => {
      if (!(await confirmDialog("Remove this Short from YouTube?", "The YouTube video is deleted permanently. Your local MP4 stays here.", "Delete from YouTube", true))) return;
      try {
        await api(`/clips/${clip.id}/youtube`, { method: "DELETE" });
        closeModal(); toast("Removed from YouTube", "warn"); loadHistory();
      } catch (e) { toast(e.message, "err"); }
    };
  }

  async function openUploadModal(id) {
    let clip = state.history.find((c) => Number(c.id) === Number(id));
    if (!clip) {
      try { clip = await api(`/clips/${id}`); } catch (e) { return toast(e.message, "err"); }
    }
    if (!clip.exists) return toast("This clip's local file is missing", "warn");
    showModal({
      title: "Publish to YouTube",
      wide: true,
      body: `<div class="upload-modal">
        <div class="publish-note" style="margin-bottom:14px"><span data-icon="wand"></span><span id="aiMetaStatus">Writing title, description and tags with your AI provider…</span></div>
        <div class="row">
          <div class="field"><label for="uploadTitle">Title</label><input id="uploadTitle" type="text" maxlength="100" value="${esc(clip.title || "")}"></div>
          <div class="field"><label for="uploadPrivacy">Privacy</label><select id="uploadPrivacy"><option value="private">Private</option><option value="unlisted">Unlisted</option><option value="public">Public</option></select></div>
        </div>
        <div class="field"><label>AI title options</label><div id="aiTitleOptions" class="hook-list"></div></div>
        <div class="field"><label for="uploadDescription">Description</label><textarea id="uploadDescription">${esc(clip.description || "")}</textarea></div>
        <div class="field"><label for="uploadTags">Tags <span class="hint">comma separated</span></label><input id="uploadTags" type="text" value="shorts, clips"></div>
        <div class="field"><label for="uploadSchedule">Schedule <span class="hint">optional · YouTube publishes it privately then at this time</span></label><input id="uploadSchedule" type="datetime-local"></div>
        ${clip.qa_status === "failed" ? `<label class="switch"><input type="checkbox" id="uploadForce"><span class="sw"></span><span>Force upload despite failed QA</span></label>` : ""}
        <div class="auth-error" id="uploadError" hidden></div>
      </div>`,
      foot: `<button class="btn ghost" data-modal-cancel>Cancel</button><button class="btn primary" id="btnDoUpload"><span data-icon="youtube"></span>Upload Short</button>`
    });
    $("#modalFoot").querySelector("[data-modal-cancel]").onclick = closeModal;
    const privacy = clip.privacy || "private";
    if ($("#uploadPrivacy")) $("#uploadPrivacy").value = ["public", "unlisted", "private"].includes(privacy) ? privacy : "private";
    const status = $("#aiMetaStatus");
    try {
      const meta = await api(`/clips/${id}/metadata`);
      if (status) status.textContent = meta.source === "llm" ? "AI wrote these — edit anything before publishing." : "AI is offline; these are safe defaults. Edit before publishing.";
      if (meta.titles?.[0]) $("#uploadTitle").value = meta.titles[0];
      if (meta.description) $("#uploadDescription").value = meta.description;
      if (meta.tags?.length) $("#uploadTags").value = meta.tags.join(", ");
      const options = $("#aiTitleOptions");
      if (options) options.innerHTML = (meta.titles || []).map((t) => `<button class="hook-option" type="button" data-use-title="${esc(t)}">${esc(t)}</button>`).join("") || `<span class="hint">No AI title options — write your own.</span>`;
      options?.addEventListener("click", (e) => {
        const b = e.target.closest("[data-use-title]");
        if (b) $("#uploadTitle").value = b.dataset.useTitle;
      });
    } catch (e) {
      if (status) status.textContent = "Could not generate metadata: " + e.message;
    }
    $("#btnDoUpload").onclick = async () => {
      const btn = $("#btnDoUpload"), err = $("#uploadError");
      err.hidden = true; btn.disabled = true; btn.classList.add("loading");
      const schedule = $("#uploadSchedule").value;
      const scheduled_at = schedule ? new Date(schedule).getTime() / 1000 : null;
      try {
        await api(`/clips/${id}/upload`, { method: "POST", body: JSON.stringify({
          title: $("#uploadTitle").value.trim(), description: $("#uploadDescription").value,
          privacy: $("#uploadPrivacy").value,
          tags: $("#uploadTags").value.split(",").map((t) => t.trim()).filter(Boolean),
          scheduled_at, force: !!$("#uploadForce")?.checked
        }) });
        closeModal();
        toast("Upload started — this can take a few minutes", "ok", "Publishing");
        loadHistory();
      } catch (e) {
        err.textContent = e.message; err.hidden = false;
        btn.disabled = false; btn.classList.remove("loading");
      }
    };
  }

  async function openHookLab(id, idx) {
    const job = state.jobs.find((j) => j.id === id);
    if (!job) return toast("Refresh jobs first", "warn");
    try {
      const data = await api(`/jobs/${id}/hooklab`, { method: "POST", body: JSON.stringify({ index: idx }) });
      showModal({
        title: "Hook Lab",
        body: `<p class="sub tight">Pick a title. Your current candidate keeps its timestamps — only the text changes.</p><div class="hook-list">${(data.titles || []).map((t) => `<button class="hook-option" data-hook-title="${esc(t)}">${esc(t)}</button>`).join("")}</div><p class="hint">${data.source === "llm" ? "Generated by your AI provider." : "AI is offline — this is the current title."}</p>`
      });
      $("#modalBody").onclick = (e) => {
        const b = e.target.closest("[data-hook-title]");
        if (!b) return;
        ensureEdits(job);
        if (state.edit[id]?.[idx]) state.edit[id][idx].title = b.dataset.hookTitle;
        closeModal();
        renderJobs(true);
        toast("Hook applied — render when ready", "ok");
      };
    } catch (e) { toast(e.message, "err"); }
  }

  async function openCaptionEditor(id, idx) {
    try {
      const data = await api(`/jobs/${id}/candidates/${idx}/captions`);
      const text = (data.segments || []).map((s) => `${Number(s.start).toFixed(2)}|${Number(s.end).toFixed(2)}|${s.text}`).join("\n");
      showModal({
        title: "Caption editor",
        wide: true,
        body: `<div class="cap-editor"><p class="hint">One line per caption: <code>start|end|text</code> in seconds. Leave a line out to drop it. The renderer burns these exact words.</p><textarea id="captionEditorText" spellcheck="false">${esc(text)}</textarea><div class="auth-error" id="captionError" hidden></div></div>`,
        foot: `<button class="btn ghost" data-modal-cancel>Cancel</button><button class="btn primary" id="btnSaveCaptions"><span data-icon="check"></span>Save captions</button>`
      });
      $("#modalFoot").querySelector("[data-modal-cancel]").onclick = closeModal;
      $("#btnSaveCaptions").onclick = async () => {
        const btn = $("#btnSaveCaptions"), err = $("#captionError");
        const segments = [];
        for (const line of $("#captionEditorText").value.split("\n")) {
          if (!line.trim()) continue;
          const parts = line.split("|");
          if (parts.length < 3) continue;
          const start = Number(parts.shift()), end = Number(parts.shift());
          const caption = parts.join("|").trim();
          if (!Number.isFinite(start) || !Number.isFinite(end) || !caption || end <= start) continue;
          segments.push({ start, end, text: caption });
        }
        if (!segments.length) { err.textContent = "Add at least one valid line (start|end|text)."; err.hidden = false; return; }
        btn.disabled = true; btn.classList.add("loading");
        try {
          await api(`/jobs/${id}/candidates/${idx}/captions`, { method: "PUT", body: JSON.stringify({ segments }) });
          closeModal();
          toast(`${segments.length} caption lines saved`, "ok");
          pollJobs(true);
        } catch (e) { err.textContent = e.message; err.hidden = false; }
        finally { btn.disabled = false; btn.classList.remove("loading"); }
      };
    } catch (e) { toast(e.message, "err"); }
  }

  async function deleteHistory(all) {
    const selected = Object.keys(state.historySel).filter((id) => state.historySel[id]).map(Number);
    if (!all && !selected.length) return toast("Select at least one clip", "warn");
    const total = all ? state.history.length : selected.length;
    if (!(await confirmDialog(
      all ? "Delete all history?" : `Delete ${total} clip${total === 1 ? "" : "s"}?`,
      "This removes the local MP4 files. Videos already published to YouTube stay online. This cannot be undone.",
      all ? "Delete all" : "Delete selected", true,
    ))) return;
    try {
      const r = await api("/clips/delete", { method: "POST", body: JSON.stringify(all ? { all: true } : { ids: selected }) });
      state.historySel = {};
      toast(`${r.deleted} clip${r.deleted === 1 ? "" : "s"} deleted · ${fmtBytes(r.freed)} freed`, "warn", "History updated");
      await loadHistory();
      if (state.view === "dashboard") loadDashboard();
    } catch (e) { toast(e.message, "err"); }
  }

  /* ---------- analytics ---------- */
  async function loadAnalytics() {
    try {
      const [an, adv] = await Promise.all([api("/analytics").catch(() => null), api("/advisor").catch(() => null)]);
      if (an) state.analytics = an;
      if (adv) state.advisor = adv;
      renderAnalytics();
    } catch (e) { toast(e.message, "err"); }
  }
  function renderAnalytics() {
    const d = state.analytics || {};
    const ch = d.channel || null;
    setStat("#anSubs", ch ? ch.subs : null);
    setStat("#anViews", ch ? ch.views : null);
    setStat("#anVideos", ch ? ch.video_count : null);
    setStat("#anTracked", d.tracked_videos ?? 0);
    setStat("#anMade", d.clips_made ?? 0);
    const raw = (d.views_series && d.views_series.length) ? d.views_series : (d.snapshots || []).map((s) => ({ ts: s.ts, views: s.total_views }));
    drawChart("#anChart", "#anChartWrap", "#anTip", raw.map((p) => ({ ts: p.ts, value: p.views })), fmt);
    $("#anNote").textContent = raw.length > 1 ? `${raw.length} snapshots · ${fmt(raw[raw.length - 1].views)} total views` : "Refresh analytics to build history.";
    renderAdvice($("#anAdvice"), state.advisor);
    $("#anAdvSource").textContent = (state.advisor && state.advisor.source) || "rules";
    renderTopVideos();
    renderVideoTable();
  }
  function renderTopVideos() {
    const el = $("#topVideos");
    if (!el) return;
    const top = (state.analytics && state.analytics.top_videos) || [];
    if (!top.length) { el.innerHTML = `<div class="logs-empty">No tracked videos yet — refresh from YouTube.</div>`; return; }
    const max = Math.max(...top.map((v) => v.views || 0), 1);
    el.innerHTML = top.map((v, i) => `<div class="top-row"><span class="top-rank">${String(i + 1).padStart(2, "0")}</span>
      <div class="top-main"><div class="top-title" title="${esc(v.title)}">${esc(v.title)}</div><div class="top-bar"><span style="width:${Math.max(4, (v.views / max) * 100)}%"></span></div></div>
      <span class="top-val">${fmt(v.views)}</span></div>`).join("");
  }
  function renderVideoTable() {
    const body = $("#allVideos");
    if (!body) return;
    const d = state.analytics || {};
    let videos = (d.videos || []).slice();
    const q = state.vidQuery.trim().toLowerCase();
    if (q) videos = videos.filter((v) => String(v.title).toLowerCase().includes(q));
    const { key, dir } = state.sort;
    videos.sort((a, b) => {
      let x = a[key], y = b[key];
      if (key === "published_at") { x = String(x); y = String(y); }
      else { x = Number(x) || 0; y = Number(y) || 0; }
      return (x < y ? -1 : x > y ? 1 : 0) * (dir === "asc" ? 1 : -1);
    });
    body.innerHTML = videos.length ? videos.map((v) => `<tr><td class="title-cell" title="${esc(v.title)}">${esc(v.title)}</td><td class="num-c">${fmt(v.views)}</td><td class="num-c">${fmt(v.likes)}</td><td class="num-c">${fmt(v.comments)}</td><td>${v.published_at ? new Date(v.published_at).toLocaleDateString() : "—"}</td></tr>`).join("") : `<tr><td colspan="5" class="logs-empty">No tracked videos.</td></tr>`;
    $$("th.sortable").forEach((th) => { th.classList.toggle("sorted", th.dataset.sort === key); th.dataset.dir = th.dataset.sort === key ? dir : ""; });
  }
  function toggleSort(key) {
    state.sort = { key, dir: state.sort.key === key && state.sort.dir === "desc" ? "asc" : "desc" };
    renderVideoTable();
  }
  async function refreshAnalytics() {
    const btn = $("#btnRefresh");
    btn.classList.add("loading"); btn.disabled = true;
    try {
      const r = await api("/analytics/refresh", { method: "POST" });
      toast(`Refreshed — ${r.videos} videos updated`, "ok");
      await loadAnalytics();
      loadDashboard();
    } catch (e) { toast(e.message, "err"); }
    finally { btn.classList.remove("loading"); btn.disabled = false; }
  }
  function exportCsv() {
    const videos = (state.analytics && state.analytics.videos) || [];
    if (!videos.length) return toast("Nothing to export yet", "warn");
    const rows = [["Title", "Views", "Likes", "Comments", "Published"], ...videos.map((v) => [v.title, v.views, v.likes, v.comments, v.published_at])];
    const csv = rows.map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "shorts-factory-analytics.csv"; a.click();
    URL.revokeObjectURL(a.href);
    toast("CSV exported", "ok");
  }

  /* ---------- settings ---------- */
  const CAPTION_STYLES = {
    gruvbox: { label: "Gruvbox", blurb: "warm · terminal", size: 46, color: "#fabd2f", highlight: "#fe8019", outline: 3, shadow: 2, uppercase: true, box: false, bold: true, animation: "word" },
    omarchy: { label: "Omarchy green", blurb: "sage · terminal", size: 46, color: "#b8bb26", highlight: "#d79921", outline: 3, shadow: 1, uppercase: true, box: false, bold: true, animation: "word" },
    classic: { label: "Classic", blurb: "clean broadcast", size: 44, color: "#ffffff", highlight: "#fabd2f", outline: 2, shadow: 0, uppercase: false, box: false, bold: true, animation: "static" },
    boxed: { label: "Boxed", blurb: "solid plate", size: 42, color: "#fbf1c7", highlight: "#fe8019", outline: 0, shadow: 0, uppercase: false, box: true, bold: false, animation: "pop" },
    clean: { label: "Clean", blurb: "minimal white", size: 40, color: "#ffffff", highlight: "#ffffff", outline: 0, shadow: 1, uppercase: false, box: false, bold: false, animation: "static" },
    neon: { label: "Neon", blurb: "aqua glow", size: 46, color: "#8ec07c", highlight: "#fb4934", outline: 2, shadow: 3, uppercase: true, box: false, bold: true, animation: "word" },
    outline: { label: "Outline", blurb: "heavy contrast", size: 48, color: "#ffffff", highlight: "#fabd2f", outline: 5, shadow: 0, uppercase: true, box: false, bold: true, animation: "pop" },
    impact: { label: "Impact", blurb: "loud & punchy", size: 52, color: "#ffffff", highlight: "#fb4934", outline: 4, shadow: 0, uppercase: true, box: false, bold: true, animation: "word" },
    shadow: { label: "Shadow", blurb: "soft depth", size: 44, color: "#fbf1c7", highlight: "#8ec07c", outline: 0, shadow: 6, uppercase: false, box: false, bold: false, animation: "static" },
    karaoke: { label: "Karaoke", blurb: "word focus", size: 46, color: "#ebdbb2", highlight: "#fb4934", outline: 3, shadow: 1, uppercase: true, box: false, bold: true, animation: "word" },
    minimal: { label: "Minimal", blurb: "small & quiet", size: 34, color: "#ffffff", highlight: "#b8bb26", outline: 0, shadow: 0, uppercase: false, box: false, bold: false, animation: "static" },
    terminal: { label: "Terminal", blurb: "green bar", size: 40, color: "#b8bb26", highlight: "#fabd2f", outline: 0, shadow: 0, uppercase: true, box: true, bold: true, animation: "static" }
  };
  const SETTING_IDS = ["yt_client_id", "yt_client_secret", "default_privacy", "upload_tags", "category_id",
    "llm_base_url", "llm_api_key", "llm_model", "whisper_model", "gpu_enabled", "short_length", "clip_mode", "clip_duration",
    "reframe", "resolution", "quality", "caption_preset", "caption_size", "caption_position",
    "caption_color", "caption_highlight", "caption_animation", "caption_uppercase", "caption_box", "output_dir"];

  async function loadSettings() {
    try {
      const res = await api("/settings");
      state.settings = res.settings || {};
      state.settingsLoaded = true;
      SETTING_IDS.forEach((id) => {
        const el = document.getElementById(id);
        if (!el) return;
        const v = state.settings[id];
        if (el.type === "checkbox") el.checked = v === undefined || v === null ? el.checked : truthy(v);
        else if (id === "caption_color") { if (/^#[0-9a-f]{6}$/i.test(String(v || ""))) el.value = v; }
        else if (v !== undefined && v !== null) el.value = v;
      });
      if ($("#oauthRedirect") && state.settings.oauth_redirect_uri) $("#oauthRedirect").textContent = state.settings.oauth_redirect_uri;
      const hasYt = !!state.settings.has_yt_client_secret;
      const hasAi = !!state.settings.has_llm_api_key;
      const ytInput = $("#yt_client_secret"), aiInput = $("#llm_api_key");
      if (ytInput) { ytInput.value = ""; ytInput.placeholder = hasYt ? "•••• saved — leave blank to keep" : "••••••••"; }
      if (aiInput) { aiInput.value = ""; aiInput.placeholder = hasAi ? "•••• saved — leave blank to keep" : "key configured on your server"; }
      $("#ytSecretSaved").hidden = !hasYt;
      $("#llmKeySaved").hidden = !hasAi;
      $("#aiPill").textContent = res.llm_available ? "AI ready" : "rules mode";
      $("#aiPill").className = "pill " + (res.llm_available ? "ok" : "muted");
      populateCreateDefaults();
      syncCaptionControls();
      updateCaptionPreview();
    } catch (e) { toast("Could not load settings: " + e.message, "err"); }
  }
  function populateCreateDefaults() {
    const s = state.settings;
    const set = (sel, val) => { const el = $(sel); if (el && val !== undefined && val !== null && val !== "") el.value = String(val); };
    set("#createPrivacy", s.default_privacy || "public");
    set("#createDuration", s.clip_duration || s.short_length || 45);
    set("#createMode", s.clip_mode || "separate");
    set("#createReframe", s.reframe || "crop");
    const preset = CAPTION_STYLES[s.caption_preset] ? s.caption_preset : "gruvbox";
    set("#caption_preset", preset);
    set("#caption_size", s.caption_size || CAPTION_STYLES[preset].size);
    set("#caption_position", s.caption_position || "bottom");
    set("#caption_color", s.caption_color || CAPTION_STYLES[preset].color);
    set("#caption_highlight", s.caption_highlight || CAPTION_STYLES[preset].highlight);
    set("#caption_animation", s.caption_animation || CAPTION_STYLES[preset].animation);
    if ($("#caption_uppercase")) $("#caption_uppercase").checked = s.caption_uppercase === undefined ? CAPTION_STYLES[preset].uppercase : truthy(s.caption_uppercase);
    if ($("#caption_box")) $("#caption_box").checked = s.caption_box === undefined ? CAPTION_STYLES[preset].box : truthy(s.caption_box);

    syncCaptionControls();
    updateCaptionPreview();
  }
  function collectSettings() {
    const out = {};
    SETTING_IDS.forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      if (el.type === "checkbox") { out[id] = el.checked; return; }
      const val = String(el.value).trim();
      if (id === "yt_client_secret" || id === "llm_api_key") { if (val) out[id] = val; return; }
      if (["short_length", "clip_duration", "caption_size"].includes(id)) out[id] = Number(val) || (id === "caption_size" ? 46 : 45);
      else out[id] = val;
    });
    return out;
  }
  async function saveSettings(silent = false) {
    const btn = $("#btnSave");
    if (btn) { btn.classList.add("loading"); btn.disabled = true; }
    try {
      const payload = collectSettings();
      const res = await api("/settings", { method: "POST", body: JSON.stringify({ settings: payload }) });
      Object.assign(state.settings, payload);
      if (res.output_dir !== undefined) {
        state.settings.output_dir = res.output_dir;
        if ($("#output_dir")) $("#output_dir").value = res.output_dir;
      }
      if (payload.yt_client_secret) { state.settings.has_yt_client_secret = true; $("#yt_client_secret").value = ""; $("#yt_client_secret").placeholder = "•••• saved — leave blank to keep"; $("#ytSecretSaved").hidden = false; }
      if (payload.llm_api_key) { state.settings.has_llm_api_key = true; $("#llm_api_key").value = ""; $("#llm_api_key").placeholder = "•••• saved — leave blank to keep"; $("#llmKeySaved").hidden = false; }
      $("#aiPill").textContent = res.llm_available ? "AI ready" : "rules mode";
      $("#aiPill").className = "pill " + (res.llm_available ? "ok" : "muted");
      populateCreateDefaults();
      const msg = $("#saveMsg");
      msg.textContent = "✓ settings saved"; msg.className = "save-msg ok";
      setTimeout(() => { msg.textContent = ""; msg.className = "save-msg"; }, 2600);
      if (!silent) toast("Settings saved", "ok");
    } catch (e) { toast(e.message, "err"); }
    finally { if (btn) { btn.classList.remove("loading"); btn.disabled = false; } }
  }
  async function chooseOutputFolder() {
    const input = $("#output_dir");
    if (!window.shortsDesktop || !window.shortsDesktop.chooseFolder) {
      return toast("Type an absolute folder path here — the native picker is available in the desktop app", "warn");
    }
    try {
      const selected = await window.shortsDesktop.chooseFolder(input?.value.trim() || "");
      if (selected && input) input.value = selected;
    } catch (e) { toast(e.message || "Could not open the folder picker", "err"); }
  }
  function switchTab(tab, updateHash = true) {
    const valid = ["channel", "ai", "pipeline", "system"];
    if (!valid.includes(tab)) tab = "channel";
    $$("#settingsTabs .tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
    $$(".tab-panel").forEach((p) => p.classList.toggle("active", p.id === `tab-${tab}`));
    if (updateHash && state.view === "settings") history.replaceState(null, "", `#settings/${tab}`);
    if (tab === "system") loadHealth();
  }
  function syncCaptionControls() {
    const presetEl = $("#caption_preset");
    if (!presetEl) return;
    const preset = presetEl.value || "gruvbox";
    $$("#capPresets .cap-preset").forEach((b) => b.classList.toggle("on", b.dataset.preset === preset));
    const pos = $("#caption_position").value || "bottom";
    $$("#capPosition button").forEach((b) => b.classList.toggle("on", b.dataset.pos === pos));
    const color = String($("#caption_color").value || "").toLowerCase();
    $$("#capColors .swatch[data-color]").forEach((b) => b.classList.toggle("on", b.dataset.color.toLowerCase() === color));
    const size = Number($("#caption_size").value) || 46;
    const out = $("#capSizeOut");
    if (out) out.textContent = size + "px";
    const lo = $("#lengthOut");
    if (lo) lo.textContent = ($("#short_length")?.value || 45) + "s";
  }
  function stopCaptionPreview() {
    if (state.capTimer) { clearInterval(state.capTimer); state.capTimer = null; }
  }
  function updateCaptionPreview() {
    const line = $("#capLine"), stage = $("#capStage");
    if (!line || !stage) return;
    stopCaptionPreview();
    const presetKey = $("#caption_preset")?.value || "gruvbox";
    const style = CAPTION_STYLES[presetKey] || CAPTION_STYLES.gruvbox;
    const size = Number($("#caption_size")?.value) || style.size;
    const color = $("#caption_color")?.value || style.color;
    const highlight = $("#caption_highlight")?.value || style.highlight;
    const upper = !!$("#caption_uppercase")?.checked;
    const box = !!$("#caption_box")?.checked;
    const animation = $("#caption_animation")?.value || "static";
    const rawSample = $("#capSample")?.value || "THIS IS THE MOMENT";
    const sample = upper ? rawSample.toUpperCase() : rawSample;
    const words = sample.trim().split(/\s+/).filter(Boolean);
    const shown = words.slice(0, 4);
    const fontPx = Math.max(10, Math.round(size * 0.36));
    stage.dataset.pos = $("#caption_position")?.value || "bottom";
    line.style.fontSize = fontPx + "px";
    line.style.fontWeight = style.bold ? "800" : "600";
    line.style.background = box ? "rgba(0,0,0,.78)" : "transparent";
    line.style.padding = box ? "5px 10px" : "0";
    line.style.borderRadius = box ? "3px" : "0";
    const outline = box ? 0 : Math.max(0, Number(style.outline) || 0);
    const shadow = box ? 0 : Math.max(0, Number(style.shadow) || 0);
    const shadows = [];
    if (outline > 0) {
      const r = Math.max(1, Math.round(outline * 0.45));
      for (let x = -r; x <= r; x += 1) for (let y = -r; y <= r; y += 1) {
        if (x || y) shadows.push(`${x}px ${y}px 0 #0b0b0b`);
      }
    }
    if (shadow > 0) shadows.push(`0 ${Math.max(2, Math.round(shadow * 0.8))}px ${shadow * 2}px rgba(0,0,0,.8)`);
    line.style.textShadow = shadows.join(", ") || "none";

    line.classList.remove("cap-pop");
    line.innerHTML = shown.map((word, index) => `<span class="cap-word" data-i="${index}">${esc(word)}</span>`).join(" ");
    const spans = Array.from(line.querySelectorAll(".cap-word"));
    spans.forEach((span) => { span.style.color = color; });
    const help = $("#captionHelp");
    if (help) {
      help.textContent = animation === "word"
        ? "Full four-word caption stays visible. The active word changes to the highlight colour and grows to 112% over 100 ms — exactly what the burner writes into the ASS captions."
        : animation === "pop"
          ? "Each four-word caption group fades in while scaling from 88% to 100% over 140 ms, then holds until the group ends."
          : "Four-word caption groups appear together with no per-word motion. Outline, shadow, box, size and safe-area position match the burner.";
    }
    if (animation === "word" && spans.length) {
      let active = -1;
      const tick = () => {
        active = (active + 1) % spans.length;
        spans.forEach((span, index) => {
          const on = index === active;
          span.style.color = on ? highlight : color;
          span.style.transform = on ? "scale(1.12)" : "scale(1)";
        });
      };
      tick();
      state.capTimer = setInterval(() => { if (state.view === "create") tick(); }, 550);
    } else if (animation === "pop") {
      const pop = () => {
        line.classList.remove("cap-pop");
        void line.offsetWidth;
        line.classList.add("cap-pop");
      };
      pop();
      state.capTimer = setInterval(() => { if (state.view === "create") pop(); }, 1700);
    }
  }
  function applyCaptionPreset(name) {
    const p = CAPTION_STYLES[name];
    if (!p) return;
    $("#caption_preset").value = name;
    $("#caption_size").value = p.size;
    $("#caption_color").value = p.color;
    $("#caption_highlight").value = p.highlight;
    $("#caption_animation").value = p.animation;
    $("#caption_uppercase").checked = p.uppercase;
    $("#caption_box").checked = p.box;
    syncCaptionControls(); updateCaptionPreview();
  }

  /* ---------- health / AI ---------- */
  async function loadHealth(force = false) {
    if (state.healthLoaded && !force) return;
    const grid = $("#healthGrid");
    if (grid) grid.innerHTML = `<div class="skeleton sk-line"></div><div class="skeleton sk-line"></div><div class="skeleton sk-line"></div>`;
    try {
      state.health = await api("/health");
      state.healthLoaded = true;
      renderHealth();
    } catch (e) {
      if (grid) grid.innerHTML = `<div class="alert bad">${icon("alert")}<span>${esc(e.message)}</span></div>`;
    }
  }
  function renderHealth() {
    const h = state.health;
    if (!h) return;
    $("#healthGrid").innerHTML = h.items.map((it) => `<div class="health-item"><span class="h-ico${it.ok ? "" : " bad"}">${icon(it.ok ? "check" : "alert")}</span><span class="h-copy"><strong>${esc(it.name)}</strong><span class="h-detail">${esc(it.detail || "")}</span></span></div>`).join("");
    const disk = h.disk && h.disk.total ? `<div class="disk-wrap"><div class="h-copy"><strong>Disk</strong><span class="h-detail">${fmtBytes(h.disk.free)} free · ${h.disk.used_pct}% used</span></div><div class="disk-bar"><span style="width:${h.disk.used_pct}%"></span></div></div>` : "";
    $("#healthMeta").innerHTML = `<span>python ${esc(h.python)}</span><span>${esc(h.data_dir)}</span><span>media ${fmtBytes(h.media.bytes)} · ${h.media.files} files</span><span>${h.connected ? "YouTube connected" : "YouTube offline"}</span>${disk}`;
  }
  async function testAI() {
    const btn = $("#btnTestAI"), out = $("#aiTestResult");
    btn.classList.add("loading"); btn.disabled = true;
    out.className = "test-result"; out.textContent = "Calling model…";
    try {
      const r = await api("/ai/test", { method: "POST" });
      out.className = "test-result ok"; out.textContent = `✓ ${r.model} replied “${r.reply}” in ${r.ms}ms`;
    } catch (e) { out.className = "test-result bad"; out.textContent = "✗ " + e.message; }
    finally { btn.classList.remove("loading"); btn.disabled = false; }
  }

  /* ---------- auth ---------- */
  async function checkAuth() {
    clearTimeout(state.authTimer);
    try {
      const st = await api("/auth/status");
      state.auth = st;
      const on = !!st.connected;
      const changed = state.connected !== undefined && state.connected !== on;
      state.connected = on;
      if (st.flow_error && st.flow_error !== state.lastFlowError) { state.lastFlowError = st.flow_error; toast(st.flow_error, "err", "YouTube connect failed"); }
      if (!st.flow_error) state.lastFlowError = null;
      $("#connDot").classList.toggle("on", on);
      $("#connLabel").textContent = on ? (st.channel?.title || "Connected") : "Not connected";
      $("#connSub").textContent = on ? `${fmt(st.channel?.subs)} subscribers` : st.flow_running ? "waiting for browser…" : "local mode";
      $("#ytDot").classList.toggle("on", on);
      $("#ytTitle").textContent = on ? `Connected: ${st.channel?.title}` : "YouTube not connected";
      $("#ytSub").textContent = on ? `${fmt(st.channel?.subs)} subs · ${fmt(st.channel?.views)} views · ${st.channel?.video_count} videos` : st.flow_error ? `Flow error: ${st.flow_error}` : "Connect a channel for auto-upload and analytics";
      $("#btnDisconnect").hidden = !on;
      $("#btnConnect").hidden = on;
      $("#ytBanner").classList.toggle("ok", on);
      $("#ytBanner").classList.toggle("no", !on);
      const cb = $("#btnConnect");
      const cancel = $("#btnCancelAuth");
      cancel.hidden = !(st.flow_running && !on);
      if (st.flow_running) {
        cb.disabled = true; cb.innerHTML = `<span class="spinner"></span>Waiting for browser…`;
        cancel.disabled = false; cancel.textContent = "Cancel";
        state.authTimer = setTimeout(checkAuth, 2000);
      } else {
        cb.disabled = false; cb.innerHTML = `${icon("youtube")}Connect channel`;
        cancel.hidden = true;
      }
      if (state.view === "dashboard" && !state.analytics) renderChannelStrip(st.channel || null);
      if (changed) { loadDashboard(); if (state.view === "analytics") loadAnalytics(); }
    } catch (_) { /* offline */ }
  }
  async function startConnect() {
    await saveSettings(true);
    try {
      const r = await api("/auth/start", { method: "POST" });
      if (!r.auth_url) throw new Error("Google did not return a consent URL");
      if (window.shortsDesktop && window.shortsDesktop.openExternal) {
        window.shortsDesktop.openExternal(r.auth_url);
      } else {
        const popup = window.open(r.auth_url, "youtube-oauth", "width=520,height=720");
        if (!popup) window.location.href = r.auth_url;
      }
      toast("Google sign-in opened in a new window", "ok", "Connecting");
      checkAuth();
      state.authTimer = setTimeout(checkAuth, 2500);
    } catch (e) { toast(e.message, "err"); }
  }
  async function cancelConnect() {
    const b = $("#btnCancelAuth");
    b.disabled = true; b.textContent = "Cancelling…";
    try {
      await api("/auth/cancel", { method: "POST" });
      toast("Google sign-in cancelled", "warn", "Connection stopped");
      await new Promise((r) => setTimeout(r, 700));
      await checkAuth();
    } catch (e) {
      b.disabled = false; b.textContent = "Cancel";
      toast(e.message, "err");
    }
  }
  async function disconnectYt() {
    if (!(await confirmDialog("Disconnect YouTube?", "Uploads and analytics stop until you reconnect. Local rendering still works.", "Disconnect", true))) return;
    try { await api("/auth/disconnect", { method: "POST" }); toast("Disconnected", "warn"); checkAuth(); loadDashboard(); } catch (e) { toast(e.message, "err"); }
  }

  /* ---------- modal / toasts / palette ---------- */
  function showModal({ title = "", body = "", foot = "", wide = false }) {
    $("#modalTitle").textContent = title;
    $("#modalBody").innerHTML = body;
    $("#modalFoot").innerHTML = foot;
    $("#modalBox").classList.toggle("wide", wide);
    $("#modalOverlay").hidden = false;
  }
  function closeModal() {
    $("#modalOverlay").hidden = true;
    $("#modalBody").innerHTML = "";
    $("#modalFoot").innerHTML = "";
    const resolve = state.confirmResolve;
    state.confirmResolve = null;
    if (resolve) resolve(false);
  }
  function confirmDialog(title, message, okLabel = "Confirm", danger = false) {
    return new Promise((resolve) => {
      showModal({
        title,
        body: `<p class="confirm-text">${esc(message)}</p>`,
        foot: `<button class="btn ghost" data-modal-cancel>Cancel</button><button class="btn ${danger ? "danger-text" : "primary"}" data-modal-ok>${esc(okLabel)}</button>`
      });
      state.confirmResolve = resolve;
      const foot = $("#modalFoot");
      foot.querySelector("[data-modal-ok]").onclick = () => { const r = state.confirmResolve; state.confirmResolve = null; closeModal(); if (r) r(true); };
      foot.querySelector("[data-modal-cancel]").onclick = () => { const r = state.confirmResolve; state.confirmResolve = null; closeModal(); if (r) r(false); };
    });
  }
  function toast(message, type = "info", title = "", options = {}) {
    const wrap = $("#toasts");
    if (!wrap) return;
    const actions = Array.isArray(options.actions) ? options.actions : [];
    const el = document.createElement("div");
    el.className = `toast ${type}${options.className ? ` ${options.className}` : ""}`;
    const ico = { ok: "check", err: "alert", warn: "info", info: "info" }[type] || "info";
    const actionHtml = actions.length
      ? `<div class="toast-actions">${actions.map((action, index) => `<button type="button" class="toast-action${action.primary ? " primary" : ""}" data-toast-action="${index}">${esc(action.label)}</button>`).join("")}</div>`
      : "";
    const timeout = options.timeout === 0 ? 0 : Number(options.timeout) || 4600;
    el.innerHTML = `<span class="toast-ico">${icon(ico)}</span><div class="toast-copy">${title ? `<strong>${esc(title)}</strong>` : ""}<span>${esc(message)}</span>${actionHtml}</div><button class="toast-x" aria-label="Dismiss">${icon("x")}</button>${timeout > 0 ? '<i class="toast-life"></i>' : ""}`;
    wrap.appendChild(el);
    blip(type);
    const kill = () => el.remove();
    el.querySelector(".toast-x").onclick = kill;
    el.querySelectorAll("[data-toast-action]").forEach((button) => {
      const action = actions[Number(button.dataset.toastAction)];
      if (action && typeof action.run === "function") button.onclick = () => action.run(button, el);
    });
    if (timeout > 0) setTimeout(kill, timeout);
    return { el, kill };
  }

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
  function copy(text) {
    const done = () => toast("Copied to clipboard", "ok");
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
    else fallbackCopy(text, done);
  }
  function fallbackCopy(text, done) {
    const ta = document.createElement("textarea"); ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); done(); } catch (_) { toast("Could not copy", "err"); }
    ta.remove();
  }
  let audioCtx = null, audioMaster = null, lastHoverAt = 0, lastClickAt = 0;

  function audioContext() {
    if (!prefs.sound) return null;
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
      if (!audioMaster) {
        audioMaster = audioCtx.createGain();
        audioMaster.gain.value = 0.62;
        audioMaster.connect(audioCtx.destination);
      }
      return audioCtx;
    } catch (_) {
      return null;
    }
  }

  function soundTone(ctx, { freq = 440, end = freq, dur = .1, type = "sine", vol = .035, delay = 0 }) {
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(20, freq), t);
    if (end !== freq) osc.frequency.exponentialRampToValueAtTime(Math.max(20, end), t + dur);
    gain.gain.setValueAtTime(.0001, t);
    gain.gain.exponentialRampToValueAtTime(Math.max(.0002, vol), t + .012);
    gain.gain.exponentialRampToValueAtTime(.0001, t + dur);
    osc.connect(gain); gain.connect(audioMaster);
    osc.start(t); osc.stop(t + dur + .03);
  }

  function soundNoise(ctx, { dur = .12, vol = .018, freq = 900, q = .8, delay = 0 } = {}) {
    const t = ctx.currentTime + delay;
    const frames = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
    const src = ctx.createBufferSource(), filter = ctx.createBiquadFilter(), gain = ctx.createGain();
    src.buffer = buffer;
    filter.type = "bandpass"; filter.frequency.setValueAtTime(freq, t); filter.Q.value = q;
    gain.gain.setValueAtTime(.0001, t);
    gain.gain.exponentialRampToValueAtTime(vol, t + .01);
    gain.gain.exponentialRampToValueAtTime(.0001, t + dur);
    src.connect(filter); filter.connect(gain); gain.connect(audioMaster);
    src.start(t); src.stop(t + dur + .02);
  }

  function blip(type) {
    if (!prefs.sound) return;
    const ctx = audioContext();
    if (!ctx) return;
    try {
      if (prefs.palette === "vice") {
        if (type === "ok") {
          [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => soundTone(ctx, {
            freq, dur: .18, type: "triangle", vol: .027, delay: i * .055
          }));
          soundNoise(ctx, { dur: .16, vol: .009, freq: 2600, q: .7, delay: .08 });
        } else if (type === "err") {
          soundTone(ctx, { freq: 190, end: 86, dur: .28, type: "sawtooth", vol: .028 });
          soundTone(ctx, { freq: 95, end: 48, dur: .2, type: "square", vol: .012, delay: .03 });
        } else if (type === "warn") {
          soundTone(ctx, { freq: 430, end: 350, dur: .17, type: "square", vol: .018 });
        } else {
          soundTone(ctx, { freq: 690, end: 980, dur: .13, type: "sine", vol: .024 });
        }
        return;
      }
      soundTone(ctx, {
        freq: type === "err" ? 180 : type === "ok" ? 620 : type === "warn" ? 420 : 520,
        dur: .16, type: type === "err" ? "sawtooth" : "sine", vol: .032
      });
    } catch (_) { /* audio blocked */ }
  }

  function uiSound(kind) {
    if (!prefs.sound) return;
    const now = performance.now();
    if (kind === "hover") {
      if (!audioCtx || audioCtx.state !== "running" || now - lastHoverAt < 85) return;
      lastHoverAt = now;
    } else if (now - lastClickAt < 32) {
      return;
    }
    const ctx = audioContext();
    if (!ctx) return;
    try {
      if (kind === "hover") {
        soundTone(ctx, { freq: 1420, end: 1680, dur: .035, type: "sine", vol: .008 });
        if (prefs.palette === "vice") soundNoise(ctx, { dur: .035, vol: .004, freq: 3200, q: 1.4 });
        return;
      }
      lastClickAt = now;
      if (prefs.palette === "vice") {
        soundNoise(ctx, { dur: .055, vol: .017, freq: 2100, q: .75 });
        soundTone(ctx, { freq: 820, end: 250, dur: .07, type: "triangle", vol: .026 });
        soundTone(ctx, { freq: 145, end: 76, dur: .11, type: "sine", vol: .024 });
      } else {
        soundTone(ctx, { freq: 560, end: 430, dur: .06, type: "sine", vol: .024 });
      }
    } catch (_) { /* audio blocked */ }
  }

  function bindAudio() {
    if (!(window.AudioContext || window.webkitAudioContext)) return;
    const hit = (el) => el && el.closest("button, a[href], [role='button'], .palette-card, .filter, .tab, .chip, .switch, .nav-item, .quick-btn, .recent-row, .history-card, .hook");
    document.addEventListener("pointerdown", (e) => {
      const target = hit(e.target);
      if (target && !target.disabled && target.getAttribute("aria-disabled") !== "true") uiSound("click");
    }, true);
    let hovered = null;
    document.addEventListener("pointerover", (e) => {
      const target = hit(e.target);
      if (!target || target === hovered || target.disabled) return;
      hovered = target;
      uiSound("hover");
    }, true);
    document.addEventListener("pointerout", (e) => { if (!e.relatedTarget) hovered = null; }, true);
  }
  let confettiToken = 0;
  function confetti() {
    if (prefs.motion !== "full") return;
    const canvas = $("#confetti");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    canvas.width = window.innerWidth; canvas.height = window.innerHeight;
    const css = getComputedStyle(document.documentElement);
    const colors = [css.getPropertyValue("--accent"), css.getPropertyValue("--accent2"), css.getPropertyValue("--green"), css.getPropertyValue("--purple"), css.getPropertyValue("--aqua")].map((c) => c.trim());
    const parts = Array.from({ length: 90 }, () => ({
      x: canvas.width / 2 + (Math.random() - 0.5) * 200, y: canvas.height * 0.42,
      vx: (Math.random() - 0.5) * 11, vy: -Math.random() * 11 - 3,
      size: 3 + Math.random() * 5, color: colors[Math.floor(Math.random() * colors.length)],
      rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.3
    }));
    const token = ++confettiToken;
    const start = performance.now();
    const frame = (now) => {
      if (token !== confettiToken) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      parts.forEach((p) => {
        p.vy += 0.32; p.x += p.vx; p.y += p.vy; p.vx *= 0.995; p.rot += p.vr;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.globalAlpha = Math.max(0, 1 - (now - start) / 2400);
        ctx.fillStyle = p.color; ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6); ctx.restore();
      });
      if (now - start < 2400) requestAnimationFrame(frame); else ctx.clearRect(0, 0, canvas.width, canvas.height);
    };
    requestAnimationFrame(frame);
  }

  /* ---------- command palette ---------- */
  function allCommands() {
    const navIcons = { dashboard: "dashboard", create: "create", jobs: "layers", history: "film", analytics: "chart", settings: "sliders" };
    return [
      { group: "Navigate", items: VIEWS.map((v, i) => ({ label: v[0].toUpperCase() + v.slice(1), icon: navIcons[v], hint: String(i + 1), run: () => go(v) })) },
      { group: "Actions", items: [
        { label: "New short from URL", icon: "create", hint: "N", run: () => { go("create"); setTimeout(() => $("#urlInput").focus(), 120); } },
        { label: "Refresh jobs", icon: "refresh", run: () => { pollJobs(true); toast("Jobs refreshed"); } },
        { label: "Browse clip history", icon: "film", hint: "4", run: () => go("history") },
        { label: "Refresh channel analytics", icon: "chart", run: () => { go("analytics"); refreshAnalytics(); } },
        { label: "Run system health check", icon: "cpu", run: () => { go("settings"); switchTab("system"); loadHealth(true); } },
        { label: "Connect YouTube channel", icon: "youtube", run: () => { go("settings"); switchTab("channel"); } }
      ] },
      { group: "Appearance", items: [
        { label: "Open appearance panel", icon: "palette", run: openTweaks },
        { label: "Toggle light / dark", icon: prefs.mode === "dark" ? "sun" : "moon", hint: "T", run: toggleMode },
        { label: "Cycle colour palette", icon: "palette", run: cyclePalette },
        { label: "Keyboard shortcuts", icon: "keyboard", hint: "?", run: showShortcuts }
      ] }
    ];
  }
  function openCmd() {
    $("#cmdOverlay").hidden = false;
    $("#cmdInput").value = "";
    state.cmdIndex = 0;
    renderCmd();
    setTimeout(() => $("#cmdInput").focus(), 30);
  }
  function closeCmd() { $("#cmdOverlay").hidden = true; }
  function renderCmd() {
    const q = $("#cmdInput").value.trim().toLowerCase();
    const groups = allCommands().map((g) => ({ group: g.group, items: g.items.filter((it) => !q || `${it.label} ${g.group} ${it.hint || ""}`.toLowerCase().includes(q)) })).filter((g) => g.items.length);
    state.cmdItems = groups.flatMap((g) => g.items);
    if (state.cmdIndex >= state.cmdItems.length) state.cmdIndex = Math.max(0, state.cmdItems.length - 1);
    if (!groups.length) { $("#cmdList").innerHTML = `<div class="logs-empty" style="padding:16px">No matches — try “jobs”, “palette”, “analytics”.</div>`; return; }
    let i = 0;
    $("#cmdList").innerHTML = groups.map((g) => `<div class="cmdk-group">${g.group}</div>` + g.items.map((it) => {
      const idx = i++;
      return `<button class="cmdk-item${idx === state.cmdIndex ? " active" : ""}" data-i="${idx}"><span class="cmdk-ico">${icon(it.icon || "spark")}</span><span>${esc(it.label)}</span>${it.hint ? `<span class="cmdk-hint">${esc(it.hint)}</span>` : ""}</button>`;
    }).join("")).join("");
  }
  function runCmd(index) {
    const item = state.cmdItems[index];
    if (!item) return;
    closeCmd();
    item.run();
  }
  function showShortcuts() {
    const rows = [["1 – 6", "Switch views"], ["⌘K / Ctrl K", "Command palette"], ["N", "New short"], ["R", "Refresh current view"], ["T", "Toggle light / dark"], ["?", "This help"], ["Esc", "Close overlays"]].map(([k, v]) => `<div class="shortcut-row"><span>${v}</span><kbd>${k}</kbd></div>`).join("");
    showModal({ title: "Keyboard shortcuts", body: `<div class="shortcut-list">${rows}</div>` });
  }

  /* ---------- bind ---------- */
  function bind() {
    document.addEventListener("ytm:prefs", (e) => {
      if (e.detail) prefs = e.detail;
      applyPrefsUI();
      renderTweaks();
    });
    $$(".nav-item").forEach((n) => n.addEventListener("click", () => go(n.dataset.view)));
    document.addEventListener("click", (e) => {
      const g = e.target.closest("[data-go]");
      if (g) { go(g.dataset.go); if (g.dataset.tabTarget) switchTab(g.dataset.tabTarget); return; }
      if (e.target.closest("[data-tweaks]")) return openTweaks();
      const c = e.target.closest("[data-copy]");
      if (c) { copy(c.dataset.copy); return; }
      const oj = e.target.closest("[data-open-job]");
      if (oj) { state.jobOpen[Number(oj.dataset.openJob)] = true; go("jobs"); renderJobs(true); }
    });
    $("#railCollapse").addEventListener("click", () => setPref({ sidebar: !prefs.sidebar }));
    $("#railOpen").addEventListener("click", () => { $("#rail").classList.add("open"); $("#railScrim").classList.add("show"); });
    $("#railScrim").addEventListener("click", closeRail);
    $("#connCard").addEventListener("click", () => { go("settings"); switchTab("channel"); });
    $("#btnMode").addEventListener("click", toggleMode);
    $("#btnTweaks").addEventListener("click", openTweaks);
    $("#btnAppearance").addEventListener("click", openTweaks);
    $("#btnHelp").addEventListener("click", showShortcuts);
    $("#cmdTrigger").addEventListener("click", openCmd);
    $("#dashRefresh").addEventListener("click", () => { loadDashboard(true); pollJobs(true); });
    $("#createModeTabs").addEventListener("click", (e) => { const b = e.target.closest("[data-create-mode]"); if (b) setCreateMode(b.dataset.createMode); });
    $("#btnBatch").addEventListener("click", queueBatch);
    $("#btnLogout").addEventListener("click", async () => { try { await api("/auth/logout", { method: "POST" }); } catch (_) {} location.reload(); });
    $("#manualRender").addEventListener("click", (e) => renderManualCut(e.currentTarget));
    $("#manualOpenJob").addEventListener("click", (e) => {
      const id = Number(e.currentTarget.dataset.id);
      if (!id) return;
      state.jobOpen[id] = true;
      go("jobs");
    });

    $("#countPicker").addEventListener("click", (e) => { const c = e.target.closest(".chip"); if (!c) return; $$("#countPicker .chip").forEach((b) => b.classList.remove("on")); c.classList.add("on"); state.count = Number(c.dataset.count); });
    $("#btnAnalyze").addEventListener("click", startAnalyze);
    $("#urlInput").addEventListener("keydown", (e) => { if (e.key === "Enter") startAnalyze(); });
    $("#btnPaste").addEventListener("click", async () => {
      try { const text = await navigator.clipboard.readText(); if (text) { $("#urlInput").value = text.trim(); $("#urlHint").hidden = true; $("#urlInput").classList.remove("bad"); } }
      catch (_) { toast("Clipboard permission denied — paste manually", "warn"); }
    });
    $("#jobFilters").addEventListener("click", (e) => { const b = e.target.closest(".filter"); if (!b) return; $$("#jobFilters .filter").forEach((x) => x.classList.remove("on")); b.classList.add("on"); state.filter = b.dataset.filter; renderJobs(true); });
    $("#jobSearch").addEventListener("input", (e) => { clearTimeout(state.searchTimer); state.searchTimer = setTimeout(() => { state.jobQuery = e.target.value; renderJobs(true); }, 140); });
    $("#jobsRefresh").addEventListener("click", () => pollJobs(true));
    $("#jobList").addEventListener("click", handleJobClick);
    $("#createActive").addEventListener("click", handleJobClick);
    $("#historyRefresh").addEventListener("click", loadHistory);
    $("#historySearch").addEventListener("input", (e) => { clearTimeout(state.historyTimer); state.historyTimer = setTimeout(() => { state.historyQuery = e.target.value; renderHistory(); }, 120); });
    $("#historyGrid").addEventListener("click", (e) => {
      const play = e.target.closest("[data-hist-play]");
      if (play) { e.preventDefault(); openHistoryClip(Number(play.dataset.histPlay)); return; }
      const up = e.target.closest("[data-hist-upload]");
      if (up) { openUploadModal(Number(up.dataset.histUpload)); return; }
      const job = e.target.closest("[data-hist-job]");
      if (job) { state.jobOpen[Number(job.dataset.histJob)] = true; go("jobs"); return; }
    });
    $("#historyFilters").addEventListener("click", (e) => {
      const b = e.target.closest("[data-history-filter]");
      if (!b) return;
      $$("#historyFilters .filter").forEach((x) => x.classList.remove("on"));
      b.classList.add("on");
      state.historyFilter = b.dataset.historyFilter;
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
    [$("#jobList"), $("#createActive")].forEach((root) => { root.addEventListener("input", handleJobInput); root.addEventListener("change", handleJobInput); });
    $("#btnRefresh").addEventListener("click", refreshAnalytics);
    $("#btnExport").addEventListener("click", exportCsv);
    $("#vidSearch").addEventListener("input", (e) => { state.vidQuery = e.target.value; renderVideoTable(); });
    $$("th.sortable").forEach((th) => th.addEventListener("click", () => toggleSort(th.dataset.sort)));
    $("#settingsTabs").addEventListener("click", (e) => { const b = e.target.closest(".tab"); if (b) switchTab(b.dataset.tab); });
    $("#btnSave").addEventListener("click", () => saveSettings());
    if ($("#btnChooseOutput")) $("#btnChooseOutput").addEventListener("click", chooseOutputFolder);
    $("#btnTestAI").addEventListener("click", testAI);
    $("#btnHealth").addEventListener("click", () => loadHealth(true));
    $("#btnConnect").addEventListener("click", startConnect);
    $("#btnCancelAuth").addEventListener("click", cancelConnect);
    $("#btnDisconnect").addEventListener("click", disconnectYt);
    $("#capPresets").addEventListener("click", (e) => { const b = e.target.closest(".cap-preset"); if (b) applyCaptionPreset(b.dataset.preset); });
    $("#capPosition").addEventListener("click", (e) => { const b = e.target.closest("button[data-pos]"); if (!b) return; $("#caption_position").value = b.dataset.pos; syncCaptionControls(); updateCaptionPreview(); });
    $("#capColors").addEventListener("click", (e) => { const b = e.target.closest("[data-color]"); if (!b) return; $("#caption_color").value = b.dataset.color; syncCaptionControls(); updateCaptionPreview(); });
    ["caption_size", "caption_color", "caption_highlight", "caption_animation", "caption_uppercase", "caption_box", "capSample"].forEach((id) => { const el = document.getElementById(id); if (el) { const sync = () => { syncCaptionControls(); updateCaptionPreview(); }; el.addEventListener("input", sync); el.addEventListener("change", sync); } });
    $("#short_length").addEventListener("input", syncCaptionControls);
    $("#twClose").addEventListener("click", closeTweaks);
    $("#twScrim").addEventListener("click", closeTweaks);
    $("#twReset").addEventListener("click", () => { prefs = T.reset(); applyPrefsUI(); renderTweaks(); schedulePrefsSave(); toast("Appearance reset", "ok"); });
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
    $("#accentSwatches").addEventListener("click", (e) => { const b = e.target.closest("[data-accent]"); if (b) setPref({ accent: b.dataset.accent }); });
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
        navigator.sendBeacon("/api/prefs", new Blob([JSON.stringify({ prefs })], { type: "application/json" }));
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
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); if ($("#cmdOverlay").hidden) openCmd(); else closeCmd(); return; }
      if (e.key === "Escape") { closeCmd(); closeModal(); closeTweaks(); closeRail(); return; }
      if (!$("#cmdOverlay").hidden || !$("#modalOverlay").hidden) return;
      const tag = (e.target.tagName || "").toLowerCase();
      if (["input", "textarea", "select"].includes(tag) || e.target.isContentEditable) return;
      if (["1", "2", "3", "4", "5", "6"].includes(e.key)) go(VIEWS[Number(e.key) - 1]);
      else if (e.key === "?" || (e.shiftKey && e.key === "/")) showShortcuts();
      else if (e.key.toLowerCase() === "n") { go("create"); setTimeout(() => $("#urlInput").focus(), 120); }
      else if (e.key.toLowerCase() === "t") toggleMode();
      else if (e.key.toLowerCase() === "r") { if (state.view === "analytics") refreshAnalytics(); else if (state.view === "dashboard") loadDashboard(true); else pollJobs(true); }
    });
    document.addEventListener("pointermove", (e) => {
      const card = e.target.closest(".spot");
      if (!card) return;
      const r = card.getBoundingClientRect();
      card.style.setProperty("--mx", `${e.clientX - r.left}px`);
      card.style.setProperty("--my", `${e.clientY - r.top}px`);
    }, { passive: true });
    document.addEventListener("click", (e) => {
      const b = e.target.closest(".btn");
      if (!b || !prefs.motion || prefs.motion !== "full") return;
      const r = b.getBoundingClientRect();
      const s = document.createElement("span"); s.className = "ripple";
      const d = Math.max(r.width, r.height);
      s.style.width = s.style.height = d + "px";
      s.style.left = e.clientX - r.left - d / 2 + "px";
      s.style.top = e.clientY - r.top - d / 2 + "px";
      b.appendChild(s); setTimeout(() => s.remove(), 600);
    });
  }

  function startApp() {
    bind();
    renderTweaks();
    applyPrefsUI();
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
    window.addEventListener("hashchange", () => { const v = location.hash.slice(1); if ((VIEWS.includes(v) || v.startsWith("settings/")) && v !== state.view) go(v, false); });
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
    if (!ok) { finishBoot(); return; }
    const params = new URLSearchParams(location.search);
    if (params.get("youtube") === "connected") { toast("YouTube connected to this account", "ok"); history.replaceState(null, "", location.pathname + location.hash); }
    if (params.get("youtube") === "error") { toast("YouTube connection failed — try again", "err"); history.replaceState(null, "", location.pathname + location.hash); }
  }
  document.addEventListener("DOMContentLoaded", boot);
})();
