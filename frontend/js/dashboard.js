/* ---------- dashboard ---------- */
import { state, $, esc, fmt, api, isoDate, timeAgo, jobEta, statusMeta } from "./core.js";
import { icon } from "./icons.js";
import { prefs } from "./prefs.js";
import { toast } from "./ui.js";

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
  el.innerHTML = `<div class="next-action"><span class="na-label">next best action</span><p>${esc(next)}</p></div>
    ${actions.length ? `<ul class="adv-list">${actions.slice(0, 4).map((a) => `<li>${esc(a)}</li>`).join("")}</ul>` : ""}`;
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

export { loadDashboard, setStat, renderDashboard, renderChannelStrip, renderAdvice, renderRecentJobs, drawChart };
