/* ---------- routing ---------- */
import { state, $, $$, VIEWS } from "./core.js";
import { prefs } from "./prefs.js";
import { loadDashboard } from "./dashboard.js";
import { renderJobs, pollJobs } from "./jobs.js";
import { loadHistory } from "./history.js";
import { loadAnalytics } from "./analytics.js";
import { loadSettings, switchTab, updateCaptionPreview, stopCaptionPreview } from "./settings.js";

import { restoreFocus } from "./focus.js";

const closeRail = () => {
  const rail = $("#rail");
  if (!rail) return;
  const wasOpen = rail.classList.contains("open");
  rail.classList.remove("open");
  $("#railScrim").classList.remove("show");
  const opener = $("#railOpen");
  if (opener) {
    opener.setAttribute("aria-expanded", "false");
    if (wasOpen) restoreFocus(opener);
  }
};
function go(view, push = true) {
  let sub = null;
  if (String(view).startsWith("settings/")) { sub = String(view).split("/")[1]; view = "settings"; }
  if (!VIEWS.includes(view)) view = "dashboard";
  state.view = view;
  $$(".view").forEach((v) => v.classList.toggle("active", v.id === `view-${view}`));
  $$(".nav-item").forEach((n) => {
    const active = n.dataset.view === view;
    n.classList.toggle("active", active);
    if (active) n.setAttribute("aria-current", "page");
    else n.removeAttribute("aria-current");
  });
  $$(".mnav-item").forEach((n) => {
    const active = n.dataset.go === view;
    n.classList.toggle("active", active);
    if (active) n.setAttribute("aria-current", "page");
    else n.removeAttribute("aria-current");
  });
  $("#crumbView").textContent = view;
  document.title = `${view[0].toUpperCase() + view.slice(1)} — Shorts Factory`;
  if (push) history.replaceState(null, "", `#${view}`);
  closeRail();
  if (view === "dashboard") loadDashboard();
  if (view === "jobs" || view === "create") { renderJobs(true); pollJobs(true); }
  if (view === "history") loadHistory();
  if (view === "analytics") loadAnalytics();
  if (view === "settings") { if (!state.settingsLoaded) loadSettings(); if (sub) switchTab(sub, false); }
  if (view === "settings") updateCaptionPreview();
  else stopCaptionPreview();
  window.scrollTo({ top: 0, behavior: prefs.motion === "full" ? "smooth" : "auto" });
}

export { go, closeRail };
