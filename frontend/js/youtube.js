/* ---------- auth ---------- */
import { state, $, api, fmt } from "./core.js";
import { icon } from "./icons.js";
import { toast, confirmDialog } from "./ui.js";
import { saveSettings } from "./settings.js";
import { loadDashboard, renderChannelStrip } from "./dashboard.js";
import { loadAnalytics } from "./analytics.js";

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

export { checkAuth, startConnect, cancelConnect, disconnectYt };
