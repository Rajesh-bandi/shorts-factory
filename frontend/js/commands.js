/* ---------- command palette ---------- */
import { VIEWS, state, $, esc } from "./core.js";
import { icon } from "./icons.js";
import { prefs, openTweaks, toggleMode, cyclePalette } from "./prefs.js";
import { go } from "./router.js";
import { pollJobs } from "./jobs.js";
import { refreshAnalytics } from "./analytics.js";
import { switchTab, loadHealth } from "./settings.js";
import { showModal, toast } from "./ui.js";
import { restoreFocus } from "./focus.js";

let cmdReturnFocus = null;

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
  const overlay = $("#cmdOverlay");
  if (!overlay || !overlay.hidden) return;
  cmdReturnFocus = document.activeElement;
  overlay.hidden = false;
  const input = $("#cmdInput");
  if (input) {
    input.value = "";
    input.setAttribute("aria-expanded", "true");
  }
  state.cmdIndex = 0;
  renderCmd();
  setTimeout(() => { const field = $("#cmdInput"); if (field) field.focus(); }, 30);
}
function closeCmd() {
  const overlay = $("#cmdOverlay");
  if (!overlay || overlay.hidden) return;
  overlay.hidden = true;
  const input = $("#cmdInput");
  if (input) {
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
  }
  restoreFocus(cmdReturnFocus);
  cmdReturnFocus = null;
}
function renderCmd() {
  const q = $("#cmdInput").value.trim().toLowerCase();
  const groups = allCommands().map((g) => ({ group: g.group, items: g.items.filter((it) => !q || `${it.label} ${g.group} ${it.hint || ""}`.toLowerCase().includes(q)) })).filter((g) => g.items.length);
  state.cmdItems = groups.flatMap((g) => g.items);
  if (state.cmdIndex >= state.cmdItems.length) state.cmdIndex = Math.max(0, state.cmdItems.length - 1);
  const input = $("#cmdInput");
  if (!groups.length) {
    if (input) input.removeAttribute("aria-activedescendant");
    $("#cmdList").innerHTML = `<div class="logs-empty" style="padding:16px">No matches — try “jobs”, “palette”, “analytics”.</div>`;
    return;
  }
  let i = 0;
  $("#cmdList").innerHTML = groups.map((g) => `<div class="cmdk-group" aria-hidden="true">${g.group}</div>` + g.items.map((it) => {
    const idx = i++;
    return `<div class="cmdk-item${idx === state.cmdIndex ? " active" : ""}" id="cmdItem${idx}" role="option" aria-selected="${idx === state.cmdIndex}" data-i="${idx}"><span class="cmdk-ico">${icon(it.icon || "spark")}</span><span>${esc(it.label)}</span>${it.hint ? `<span class="cmdk-hint">${esc(it.hint)}</span>` : ""}</div>`;
  }).join("")).join("");
  if (input) input.setAttribute("aria-activedescendant", `cmdItem${state.cmdIndex}`);
  requestAnimationFrame(() => {
    const active = $("#cmdList .cmdk-item.active");
    if (active && active.scrollIntoView) active.scrollIntoView({ block: "nearest" });
  });
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

export { openCmd, closeCmd, renderCmd, runCmd, showShortcuts };
