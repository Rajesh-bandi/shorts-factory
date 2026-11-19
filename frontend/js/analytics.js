/* ---------- analytics ---------- */
import { state, $, $$, esc, fmt, api } from "./core.js";
import { toast } from "./ui.js";
import { setStat, drawChart, renderAdvice, loadDashboard } from "./dashboard.js";

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
  $$("th.sortable").forEach((th) => {
    const active = th.dataset.sort === key;
    th.classList.toggle("sorted", active);
    th.dataset.dir = active ? dir : "";
    th.setAttribute("aria-sort", active ? (dir === "asc" ? "ascending" : "descending") : "none");
  });
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

export { loadAnalytics, renderAnalytics, refreshAnalytics, exportCsv, toggleSort, renderVideoTable };
