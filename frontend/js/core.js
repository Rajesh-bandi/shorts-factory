/* Shorts Factory — shared state, formatting and API helpers. */

const runtimeConfig = window.SHORTS_CONFIG || {};

/** Absolute backend origin when the frontend is hosted separately. */
export const API_BASE = String(runtimeConfig.apiBase || "").replace(/\/+$/, "");

/** Prefix a backend path (starting with /) with the configured origin. */
export const apiUrl = (path) => `${API_BASE}${path}`;

export const VIEWS = ["dashboard", "create", "jobs", "history", "analytics", "settings"];

export const state = {
  view: "dashboard", jobs: [], jobOpen: {}, edit: {}, editSig: {}, logs: {}, logCursor: {}, logBusy: {},
  prevStatus: {}, settings: {}, settingsLoaded: false, auth: null, analytics: null, advisor: null,
  health: null, healthLoaded: false, filter: "all", jobQuery: "", vidQuery: "",
  sort: { key: "views", dir: "desc" }, count: 2, polling: false, jobSig: "",
  cmdItems: [], cmdIndex: 0, confirmResolve: null, authTimer: null, warned: false,
  createMode: "auto", manualJobId: null, manualInputJob: null, capTimer: null, capTick: 0,
  history: [], historyLoaded: false, historySel: {}, historyQuery: "", historyFilter: "all",
  account: null, accountMode: "login", authConfig: null, appStarted: false, historyPoll: null,
  localMode: false, prefsTimer: null, prefsDirty: false, liveCursor: {}, pipeline: null
};

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
export const esc = (v) => String(v ?? "").replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" }[c]));
export const fmt = (n) => {
  if (n === null || n === undefined || n === "") return "—";
  n = Number(n);
  if (!Number.isFinite(n)) return "—";
  if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, "") + "B";
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, "") + "K";
  return String(n);
};
export const fmtBytes = (b) => {
  if (!b) return "0 B";
  const u = ["B", "KB", "MB", "GB"];
  let i = 0, n = b;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n > 9 ? 0 : 1)} ${u[i]}`;
};
export const elapsedLabel = (ts) => {
  if (!ts) return "";
  const s = Math.max(0, Math.floor(Date.now() / 1000 - ts));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h ? `${h}h ${m}m` : m ? `${m}m ${sec}s` : `${sec}s`;
};
export const shortEta = (seconds) => {
  const s = Math.max(0, Number(seconds) || 0);
  if (s < 90) return "under 2m";
  const m = Math.round(s / 60);
  if (m < 60) return `~${m}m`;
  const h = Math.floor(m / 60), rem = m % 60;
  return rem ? `~${h}h ${rem}m` : `~${h}h`;
};
export const etaClock = (ts) => ts ? new Date(ts * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "";
export function jobEta(j) {
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
    if (j.options?.live_scan) {
      const waiting = j.stage === "live_pick" || j.options.live_phase === "picking";
      return {
        label: waiting ? "waiting for your spike pick" : "live · no fixed ETA",
        title: "Live jobs follow chat spikes and your picks, so a fixed ETA does not apply"
      };
    }
    return {
      label: seconds > 0 ? `ETA ${shortEta(seconds)} left` : "estimating ETA…",
      title: seconds > 0 ? `Estimated finish around ${etaClock(j.eta_at)}` : "ETA appears once progress stabilizes"
    };
  }
  return null;
}
export const timeAgo = (ts) => {
  if (!ts) return "";
  const s = Math.max(0, Date.now() / 1000 - ts);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 604800) return `${Math.floor(s / 86400)}d ago`;
  return new Date(ts * 1000).toLocaleDateString();
};
export const truthy = (v) => v === true || v === "true" || v === 1 || v === "1";
export const jobOpt = (j, key, fallback) => {
  if (j && j.options && Object.prototype.hasOwnProperty.call(j.options, key) && j.options[key] !== null && j.options[key] !== "") return j.options[key];
  if (state.settings && Object.prototype.hasOwnProperty.call(state.settings, key) && state.settings[key] !== null && state.settings[key] !== "") return state.settings[key];
  return fallback;
};
export const optionsHtml = (list, current) => list.map(([v, l]) => `<option value="${v}"${String(v) === String(current) ? " selected" : ""}>${l}</option>`).join("");
export const isoDate = (ts) => new Date(ts * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric" });
export const timeLabel = (seconds) => {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
export function statusMeta(status) {
  return ({ queued: { label: "Queued", tone: "muted" }, running: { label: "Running", tone: "info" },
    review: { label: "Review", tone: "warn" }, done: { label: "Done", tone: "ok" },
    error: { label: "Failed", tone: "bad" }, canceled: { label: "Canceled", tone: "muted" } })[status] || { label: status || "—", tone: "muted" };
}
export function stageLabel(stage) {
  return ({ queued: "Queued", downloading: "Ingesting source", recording: "Fetching spike window", live_pick: "Waiting for your spike pick", live_scan: "Watching live chat", transcribing: "Building transcript signals", analyzing: "Ranking windows",
    review: "Evidence ready for review", manual: "Manual range ready", clipping: "Cutting + framing + rendering", uploading: "Uploading + QA", done: "Done",
    canceling: "Canceling", canceled: "Canceled" })[stage] || stage || "Working";
}

/** The seven pipeline stages used by the console UI. */
export const PIPELINE_STAGES = ["ingest", "signals", "rank", "cut", "frame", "render", "qa"];

/** Load aggregate pipeline/cache telemetry once and keep it on state. */
export async function loadPipelineStatus(force = false) {
  if (state.pipeline && !force) return state.pipeline;
  try {
    state.pipeline = await api("/pipeline/status");
  } catch (_) {
    if (!state.pipeline) state.pipeline = null;
  }
  return state.pipeline;
}

/** Map a job row onto the seven-stage rail. */
export function jobStageIndex(job) {
  if (!job) return -1;
  const stage = job.stage || "";
  if (job.status === "done") return PIPELINE_STAGES.length;
  if (job.status === "queued") return -1;
  if (job.options?.live_scan) {
    if (["downloading", "live_scan"].includes(stage)) return 0;
    if (stage === "live_pick") return 2;
    if (["recording", "transcribing", "analyzing"].includes(stage)) return 3;
    if (stage === "clipping") return 4;
    if (stage === "uploading") return 5;
    if (job.status === "error" || job.status === "canceled") return -1;
    return 0;
  }
  if (["downloading", "recording", "live_scan"].includes(stage)) return 0;
  if (["transcribing", "analyzing"].includes(stage)) return 1;
  if (stage === "live_pick") return 2;
  if (job.status === "review" || stage === "review" || stage === "manual") return 2;
  if (stage === "clipping") return 4;
  if (stage === "uploading") return 5;
  if (job.status === "error" || job.status === "canceled") return -1;
  return 0;
}

let unauthorizedHandler = null;
export function setUnauthorizedHandler(fn) {
  unauthorizedHandler = typeof fn === "function" ? fn : null;
}

export async function api(path, opts = {}) {
  const headers = { "Content-Type": "application/json", ...(opts.headers || {}) };
  const res = await fetch(apiUrl(`/api${path}`), {
    credentials: "include",
    ...opts,
    headers,
  });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch (_) { body = text; }
  if (res.status === 401 && !state.localMode && !path.startsWith("/auth/login") && !path.startsWith("/auth/register")) {
    if (unauthorizedHandler) unauthorizedHandler();
  }
  if (!res.ok) throw new Error((body && body.detail) || res.statusText || "Request failed");
  return body;
}
