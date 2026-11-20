/* ---------- appearance ---------- */
import { state, $, $$, API_BASE } from "./core.js";
import { icon } from "./icons.js";
import { restoreFocus, trapTab } from "./focus.js";

const T = window.YTMTheme;
export let prefs = T.load();
let prefsSaveTimer = null;
let tweaksReturnFocus = null;

function applyPrefsUI() {
  const modeBtn = $("#btnMode");
  const resolvedMode = document.documentElement.dataset.mode || prefs.mode;
  if (modeBtn) modeBtn.innerHTML = icon(resolvedMode === "dark" ? "sun" : "moon");
  const collapse = $("#railCollapse");
  if (collapse) {
    const open = prefs.sidebar !== false;
    collapse.setAttribute("aria-expanded", String(open));
    collapse.setAttribute("aria-label", open ? "Collapse sidebar" : "Expand sidebar");
    collapse.title = open ? "Collapse sidebar" : "Expand sidebar";
  }
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
function applyServerPrefs() {
  if (!state.appStarted) return;
  const snapshot = { ...prefs };
  fetch(`${API_BASE}/api/prefs`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prefs: snapshot }),
    keepalive: true,
  }).then(() => { state.prefsDirty = false; }).catch(() => { /* offline - local copy is still saved */ });
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
    return `<button class="palette-card${key === prefs.palette ? " on" : ""}" data-palette="${key}" aria-pressed="${key === prefs.palette}">
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
    sw.innerHTML = `<button class="swatch${prefs.accent ? "" : " on"}" data-accent="" title="Palette default" aria-label="Palette default accent" aria-pressed="${!prefs.accent}" style="--sw:${colors.accent};background:linear-gradient(135deg,${colors.accent},${colors.accent2})"></button>` +
      list.map((c) => `<button class="swatch${prefs.accent.toLowerCase() === c.toLowerCase() ? " on" : ""}" data-accent="${c}" title="${c}" aria-label="Accent ${c}" aria-pressed="${prefs.accent.toLowerCase() === c.toLowerCase()}" style="--sw:${c};background:${c}"></button>`).join("");
  }
  const custom = $("#accentCustom");
  if (custom) custom.value = prefs.accent || colors.accent;
  const mark = (sel, attr, val) => $$(sel + " [" + attr + "]").forEach((b) => {
    const on = String(b.dataset[attr.replace("data-", "").replace(/-([a-z])/g, (_, c) => c.toUpperCase())]) === String(val);
    b.classList.toggle("on", on);
    b.setAttribute("aria-pressed", String(on));
  });
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
  const panel = $("#tweaks");
  if (!panel) return;
  if (!panel.classList.contains("open")) tweaksReturnFocus = document.activeElement;
  panel.classList.add("open");
  panel.setAttribute("aria-hidden", "false");
  $("#twScrim").classList.add("show");
  requestAnimationFrame(() => {
    const target = $("#twClose") || panel.querySelector("button, input, select, textarea, [href]");
    if (target) target.focus({ preventScroll: true });
  });
}
function closeTweaks() {
  const panel = $("#tweaks");
  if (!panel || !panel.classList.contains("open")) return;
  panel.classList.remove("open");
  panel.setAttribute("aria-hidden", "true");
  $("#twScrim").classList.remove("show");
  restoreFocus(tweaksReturnFocus);
  tweaksReturnFocus = null;
}
function resetPrefs() {
  prefs = T.reset();
  applyPrefsUI();
  renderTweaks();
  schedulePrefsSave();
}
function mergeServerPrefs(serverPrefs) {
  prefs = T.set(serverPrefs, prefs);
}
const toggleMode = () => setPref({ mode: (document.documentElement.dataset.mode || prefs.mode) === "dark" ? "light" : "dark" });
function cyclePalette() {
  const keys = Object.keys(T.PALETTES);
  setPref({ palette: keys[(keys.indexOf(prefs.palette) + 1) % keys.length] });
}

document.addEventListener("ytm:prefs", (e) => {
  if (e.detail) prefs = e.detail;
  applyPrefsUI();
  renderTweaks();
});
document.addEventListener("keydown", (e) => {
  const panel = $("#tweaks");
  if (e.key === "Tab" && panel && panel.classList.contains("open")) trapTab(e, panel);
});

export { applyPrefsUI, setPref, renderTweaks, openTweaks, closeTweaks, toggleMode, cyclePalette, schedulePrefsSave, resetPrefs, mergeServerPrefs };
