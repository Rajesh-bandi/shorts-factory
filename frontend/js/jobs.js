import { state, $, esc, api, elapsedLabel, jobEta, timeAgo, jobOpt, optionsHtml, statusMeta, stageLabel, timeLabel } from "./core.js";
import { icon } from "./icons.js";
import { toast, showModal, confirmDialog, confetti } from "./ui.js";
import { go } from "./router.js";
import { renderManualPanel } from "./create.js";
import { renderRecentJobs } from "./dashboard.js";
import { openHistoryClip, openUploadModal, openHookLab, openCaptionEditor, loadHistory } from "./history.js";

const actBtn = (act, id, title, ico) => `<button class="icon-btn" data-act="${act}" data-id="${id}" title="${title}" aria-label="${title}">${icon(ico)}</button>`;
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
    `<a class="icon-btn" href="${esc(j.url)}" target="_blank" rel="noopener" title="Open source video" aria-label="Open source video">${icon("external")}</a>`,
    `<button class="icon-btn" data-act="toggle" data-id="${j.id}" title="Details" aria-label="Job details" aria-expanded="${open}"><span class="chev">${icon("chevron-down")}</span></button>`
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
  return JSON.stringify((candidates || []).map((c) => [Number(c.start), Number(c.end), String(c.title || ""), Array.isArray(c.hooks) ? c.hooks : []]));
}
function editDuration(ed) {
  return Math.max(0, Number(ed?.end || 0) - Number(ed?.start || 0));
}
function ensureEdits(j) {
  const candidates = j.candidates || [];
  const sig = editSignature(candidates);
  if (!state.edit[j.id] || state.edit[j.id].length !== candidates.length || state.editSig[j.id] !== sig) {
    const hookMode = jobOpt(j, "hook_mode", "auto");
    state.edit[j.id] = candidates.map((c) => {
      const hooks = Array.isArray(c.hooks) ? c.hooks.map((hook) => String(hook || "")).filter(Boolean) : [];
      return {
        start: Number(c.start),
        end: Number(c.end),
        title: c.title || "Highlight",
        hooks,
        hook: c.hook != null ? String(c.hook) : (hookMode === "auto" ? (hooks[0] || "") : ""),
        picked: true
      };
    });
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
  const hookMode = jobOpt(j, "hook_mode", "auto");
  const rows = j.candidates.map((c, i) => {
    const ed = state.edit[j.id][i];
    const dur = editDuration(ed);
    const hooks = Array.isArray(ed.hooks) ? ed.hooks : [];
    const hookOptions = hooks.length
      ? `<select class="cand-hook-select" data-field="hook" aria-label="Hook line"><option value="">No hook line</option>${hooks.map((hook) => `<option value="${esc(hook)}"${hook === ed.hook ? " selected" : ""}>${esc(hook)}</option>`).join("")}</select>`
      : hookMode === "none" ? "" : `<span class="cand-hook-hint">${icon("wand")} AI hook line will be added at render</span>`;
    return `<div class="cand${ed.picked === false ? " off" : ""}" data-job="${j.id}" data-idx="${i}">
      <input type="checkbox" class="cand-pick"${ed.picked === false ? "" : " checked"} title="Include this clip" aria-label="Include clip ${i + 1}">
      <div class="cand-body">
        <input class="cand-title" data-field="title" value="${esc(ed.title)}" aria-label="Clip title">
        <div class="cand-reason">${esc(c.reason || "Highlight")}</div>
        ${hookOptions ? `<div class="cand-hook"><span class="cand-hook-label">Hook</span>${hookOptions}</div>` : ""}
      </div>
      <div class="time-field"><label>in</label><input type="number" step="0.1" min="0" data-field="start" value="${Number(ed.start).toFixed(1)}"></div>
      <div class="time-field"><label>out</label><input type="number" step="0.1" min="0" data-field="end" value="${Number(ed.end).toFixed(1)}"></div>
      <span class="dur">${Math.round(dur)}s</span>
      <button class="icon-btn cand-preview" data-act="preview" data-id="${j.id}" data-idx="${i}" title="Preview source at this moment" aria-label="Preview source at this moment">${icon("play")}</button>
      <button class="icon-btn" data-act="hooklab" data-id="${j.id}" data-idx="${i}" title="Hook Lab — AI title options" aria-label="Hook Lab">${icon("wand")}</button>
      <button class="icon-btn" data-act="captions" data-id="${j.id}" data-idx="${i}" title="Edit captions" aria-label="Edit captions">${icon("terminal")}</button>
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
        ${file && u.clip_id ? `<button class="btn ghost sm" data-act="play" data-clip="${u.clip_id}" data-title="${esc(u.title)}">${icon("play")}Play</button><button class="icon-btn" data-copy="${esc(u.path)}" title="Copy file path" aria-label="Copy file path">${icon("copy")}</button>` : file ? `<button class="btn ghost sm" data-act="play" data-file="${esc(file)}">${icon("play")}Play</button><button class="icon-btn" data-copy="${esc(u.path)}" title="Copy file path" aria-label="Copy file path">${icon("copy")}</button>` : ""}
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
function openPreview(id, idx) {
  const job = state.jobs.find((j) => j.id === id);
  if (!job) return;
  const ed = state.edit[id] && state.edit[id][idx];
  const candidate = job.candidates[idx] || {};
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
  if (act === "play") return btn.dataset.clip ? openHistoryClip(Number(btn.dataset.clip)) : openClip(btn.dataset.file);
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
  ed[field] = field === "title" || field === "hook" ? e.target.value : Number(e.target.value);
  if (field !== "title" && field !== "hook") updateDur(row);
}
function updateDur(row) {
  const id = Number(row.dataset.job), idx = Number(row.dataset.idx);
  const ed = state.edit[id]?.[idx];
  const dur = ed ? editDuration(ed) : Math.max(0, Number(row.querySelector('[data-field="end"]').value) - Number(row.querySelector('[data-field="start"]').value));
  const bad = dur <= 1 || dur > 120;
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
    const hookEl = row.querySelector('[data-field="hook"]');
    const dur = ed ? editDuration(ed) : end - start;
    if (!(end > start + 1) || dur <= 1 || dur > 120) { row.classList.add("bad"); bad = true; return; }
    const clip = { index: idx, start, end, title: title || `Highlight ${idx + 1}` };
    if (hookEl) clip.hook = hookEl.value;
    else if (ed?.hook) clip.hook = ed.hook;
    clips.push(clip);
  });
  if (bad) return toast("Check the in/out points — clips must be 2–120s", "err");
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

export { ensureEdits, renderJobs, pollJobs, renderCreateActive, handleJobClick, handleJobInput };
