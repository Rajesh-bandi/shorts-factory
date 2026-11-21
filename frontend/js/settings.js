import { state, $, $$, esc, api, truthy, fmt, fmtBytes, timeAgo, loadPipelineStatus } from "./core.js";
import { icon } from "./icons.js";
import { prefs } from "./prefs.js";
import { toast } from "./ui.js";
import { populateCreateDefaults } from "./create.js";
import { CAPTION_STYLES } from "./caption-styles.js";

const SETTING_IDS = ["yt_client_id", "yt_client_secret", "default_privacy", "upload_tags", "category_id",
  "llm_base_url", "llm_api_key", "llm_model", "whisper_model", "gpu_enabled", "chat_highlights", "short_length", "clip_duration",
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
  $$("#settingsTabs .tab").forEach((b) => {
    const on = b.dataset.tab === tab;
    b.classList.toggle("active", on);
    b.setAttribute("aria-selected", String(on));
    b.tabIndex = on ? 0 : -1;
  });
  $$(".tab-panel").forEach((p) => p.classList.toggle("active", p.id === `tab-${tab}`));
  if (updateHash && state.view === "settings") history.replaceState(null, "", `#settings/${tab}`);
  if (tab === "system") loadHealth();
  if (tab === "pipeline") loadPipeline();
}
function syncCaptionControls() {
  const presetEl = $("#caption_preset");
  if (!presetEl) return;
  const preset = presetEl.value || "gruvbox";
  $$("#capPresets .cap-preset").forEach((b) => {
    const on = b.dataset.preset === preset;
    b.classList.toggle("on", on);
    b.setAttribute("aria-pressed", String(on));
  });
  const pos = $("#caption_position").value || "bottom";
  $$("#capPosition button").forEach((b) => {
    const on = b.dataset.pos === pos;
    b.classList.toggle("on", on);
    b.setAttribute("aria-pressed", String(on));
  });
  const color = String($("#caption_color").value || "").toLowerCase();
  $$("#capColors .swatch[data-color]").forEach((b) => {
    const on = b.dataset.color.toLowerCase() === color;
    b.classList.toggle("on", on);
    b.setAttribute("aria-pressed", String(on));
  });
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
  const animate = prefs.motion === "full" && state.view === "settings";
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
  if (animation === "word" && spans.length && animate) {
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
    state.capTimer = setInterval(() => { if (state.view === "settings") tick(); }, 550);
  } else if (animation === "pop" && animate) {
    const pop = () => {
      line.classList.remove("cap-pop");
      void line.offsetWidth;
      line.classList.add("cap-pop");
    };
    pop();
    state.capTimer = setInterval(() => { if (state.view === "settings") pop(); }, 1700);
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
/* ---------- signal pipeline cache ---------- */
async function loadPipeline(force = false) {
  const grid = $("#pipelineCacheGrid");
  if (grid && !grid.dataset.ready) {
    grid.innerHTML = Array.from({ length: 6 }, () => `<div class="pipeline-cache-cell"><span>loading</span><strong>—</strong></div>`).join("");
  }
  try {
    const data = await loadPipelineStatus(force);
    if (data) renderPipelineCache();
  } catch (e) {
    const foot = $("#pipelineCacheFoot");
    if (foot) foot.textContent = "Pipeline status unavailable: " + e.message;
  }
}
function renderPipelineCache() {
  const p = state.pipeline || {};
  const cache = p.cache || {};
  const live = p.live || {};
  const jobs = p.jobs || {};
  const grid = $("#pipelineCacheGrid");
  if (grid) {
    const cells = [
      ["videos", fmt(cache.videos || 0), "analyzed once"],
      ["heatmaps", fmt(cache.heatmaps || 0), "replay curves"],
      ["transcripts", fmt(cache.transcripts || 0), "timed units"],
      ["audio energy", fmt(cache.energy || 0), "energy curves"],
      ["chat replays", fmt(cache.chat_replays || 0), "spike sources"],
      ["QA failures", fmt(jobs.stages?.qa || 0), "need attention"],
    ];
    grid.innerHTML = cells.map(([label, value, sub]) => `<div class="pipeline-cache-cell"><span>${label}</span><strong>${value}</strong><small>${sub}</small></div>`).join("");
    grid.dataset.ready = "1";
  }
  const foot = $("#pipelineCacheFoot");
  if (foot) {
    const updated = cache.updated_at ? `last write ${timeAgo(cache.updated_at)}` : "no analysis cached yet";
    const scan = live.scan_seconds ? `scan ${Math.round(live.scan_seconds / 60)}m` : "scan 15m";
    const pad = live.pad_seconds ? `±${Math.round(live.pad_seconds)}s` : "±60s";
    const cap = live.max_capture_seconds ? `cap ${Math.round(live.max_capture_seconds / 60)}m` : "cap 30m";
    foot.textContent = `${updated} · public by video id · live ${scan} / ${pad} / ${cap} · ${jobs.running || 0} running · ${jobs.review || 0} review`;
  }
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

export { loadSettings, saveSettings, chooseOutputFolder, switchTab, syncCaptionControls, stopCaptionPreview, updateCaptionPreview, applyCaptionPreset, loadHealth, loadPipeline, testAI };
