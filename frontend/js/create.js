import { state, $, $$, api, truthy, timeLabel, jobEta, statusMeta, stageLabel, API_BASE } from "./core.js";
import { toast } from "./ui.js";
import { go } from "./router.js";
import { pollJobs } from "./jobs.js";
import { syncCaptionControls, updateCaptionPreview } from "./settings.js";
import { CAPTION_STYLES } from "./caption-styles.js";

let createStep = 1;

function populateCreateDefaults() {
  const s = state.settings;
  const set = (sel, val) => { const el = $(sel); if (el && val !== undefined && val !== null && val !== "") el.value = String(val); };
  set("#createPrivacy", s.default_privacy || "public");
  set("#createDuration", s.clip_duration || s.short_length || 45);
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

function updateCreateStepUI() {
  const auto = state.createMode === "auto";
  const batch = state.createMode === "batch";
  const sourceBody = $("#createSourceBody");
  const summary = $("#sourceSummary");
  const setup = $("#createSetupStep");
  const actions = $("#createWizardActions");
  const steps = $("#createSteps");
  if (steps) steps.hidden = !auto;
  if (batch) return;
  if (!auto) {
    if (sourceBody) sourceBody.hidden = false;
    if (summary) summary.hidden = true;
    if (setup) setup.hidden = false;
    if (actions) actions.hidden = true;
    return;
  }
  const onOptions = createStep === 2;
  if (sourceBody) sourceBody.hidden = onOptions;
  if (summary) summary.hidden = !onOptions;
  if (setup) setup.hidden = !onOptions;
  if (actions) actions.hidden = !onOptions;
  if (onOptions) {
    const url = ($("#urlInput")?.value || "").trim();
    if ($("#sourceSummaryUrl")) $("#sourceSummaryUrl").textContent = url;
  }
  $$("#createSteps .create-step").forEach((step) => {
    const n = Number(step.dataset.step) || 1;
    const active = n === createStep;
    step.classList.toggle("is-active", active);
    step.classList.toggle("is-done", n < createStep);
    if (active) step.setAttribute("aria-current", "step");
    else step.removeAttribute("aria-current");
  });
}

function showCreateStep(step) {
  createStep = step === 2 ? 2 : 1;
  updateCreateStepUI();
  if (createStep === 2) {
    const title = $("#createSetupTitle");
    if (title) title.focus({ preventScroll: true });
  }
}

function setCreateMode(mode) {
  state.createMode = ["manual", "batch"].includes(mode) ? mode : "auto";
  $$("#createModeTabs .tab").forEach((b) => {
    const on = b.dataset.createMode === state.createMode;
    b.classList.toggle("active", on);
    b.setAttribute("aria-pressed", String(on));
  });
  const manual = state.createMode === "manual";
  const batch = state.createMode === "batch";
  if ($("#countPicker")) $("#countPicker").hidden = manual || batch;
  if ($("#manualTimes")) $("#manualTimes").hidden = !manual;
  if ($("#durationField")) $("#durationField").hidden = manual;
  if ($("#autoUploadField")) $("#autoUploadField").hidden = manual || batch;
  if ($("#createFlow")) $("#createFlow").hidden = manual;
  if ($("#createActive")) $("#createActive").hidden = manual;
  if ($("#manualPanel")) $("#manualPanel").hidden = !manual;
  if ($("#batchPanel")) $("#batchPanel").hidden = !batch;
  const composer = $(".composer");
  if (composer) composer.hidden = batch;
  if ($("#btnAnalyzeLabel")) $("#btnAnalyzeLabel").textContent = manual ? "Download preview" : "Find moments";
  if ($("#setupEyebrow")) $("#setupEyebrow").textContent = manual ? "manual cut" : "step 2";
  if ($("#setupModePill")) $("#setupModePill").textContent = manual ? "You pick the exact range" : "AI picks the moments";
  if (!manual) createStep = 1;
  updateCreateStepUI();
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

async function startAnalyze(ev) {
  if (ev && typeof ev.preventDefault === "function") ev.preventDefault();
  const input = $("#urlInput"), hint = $("#urlHint");
  const url = input.value.trim();
  input.classList.remove("bad"); hint.hidden = true;
  const invalid = !url || !/(youtube\.com|youtu\.be)\//i.test(url);
  if (invalid) {
    if (state.createMode === "auto" && createStep === 2) showCreateStep(1);
    input.classList.add("bad");
    hint.textContent = url ? "That does not look like a YouTube URL." : "Paste a YouTube link first.";
    hint.hidden = false;
    input.focus();
    return;
  }
  if (state.createMode === "manual") return startManual(url, $("#btnAnalyze"), input, hint);
  if (state.createMode === "auto" && createStep === 1) {
    showCreateStep(2);
    return;
  }
  return startAutoJob(url);
}

async function startAutoJob(url) {
  const input = $("#urlInput");
  const btn = $("#btnStartAnalysis") || $("#btnAnalyze");
  btn.classList.add("loading"); btn.disabled = true;
  try {
    const r = await api("/jobs", { method: "POST", body: JSON.stringify({
      url, short_count: state.count,
      privacy: $("#createPrivacy").value,
      clip_duration: Number($("#createDuration").value) || 45,
      reframe: $("#createReframe").value,
      auto_upload: state.createMode === "auto" && !!$("#createAutoUpload")?.checked,
      ...captionOptions()
    }) });
    input.value = "";
    createStep = 1;
    updateCreateStepUI();
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
      const src = `${API_BASE}/media/${encodeURIComponent(job.preview)}?v=${job.updated_at || job.id}`;
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

export { setCreateMode, queueBatch, startAnalyze, showCreateStep, renderManualPanel, renderManualCut, populateCreateDefaults };
