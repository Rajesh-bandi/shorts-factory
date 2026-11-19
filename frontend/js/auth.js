/* ---------- account gate ---------- */
import { state, $, $$, api, setUnauthorizedHandler } from "./core.js";
import { mergeServerPrefs } from "./prefs.js";
import { toast } from "./ui.js";

function finishBoot() {
  const splash = $("#bootSplash");
  if (!splash) return;
  splash.classList.add("done");
  setTimeout(() => splash.remove(), 450);
}
function lockApp() {
  if (state.localMode) return;
  document.body.classList.add("auth-locked");
  const gate = $("#authGate");
  if (gate) gate.classList.remove("hidden");
}
function unlockApp() {
  document.body.classList.remove("auth-locked");
  const gate = $("#authGate");
  if (gate) gate.classList.add("hidden");
  finishBoot();
}
function setAuthMode(mode) {
  state.accountMode = mode === "register" ? "register" : "login";
  $$("#authTabs .tab").forEach((b) => {
    const on = b.dataset.authTab === state.accountMode;
    b.classList.toggle("active", on);
    b.setAttribute("aria-pressed", String(on));
  });
  const cfg = state.authConfig || {};
  const first = !!cfg.first_account;
  $("#authTabs [data-auth-tab=\"login\"]").hidden = first;
  $("#authTabs [data-auth-tab=\"register\"]").hidden = cfg.registration_open === false;
  $("#authNameField").hidden = state.accountMode !== "register";
  $("#authInviteField").hidden = state.accountMode !== "register" || first || !cfg.invite_required;
  $("#authSubmitLabel").textContent = state.accountMode === "register" ? "Create account" : "Sign in";
  $("#authPassword").autocomplete = state.accountMode === "register" ? "new-password" : "current-password";
  $("#authError").hidden = true;
}
function bindAuth() {
  $("#authTabs").addEventListener("click", (e) => { const b = e.target.closest("[data-auth-tab]"); if (b) setAuthMode(b.dataset.authTab); });
  $("#authForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = $("#authError"), btn = $("#authSubmit");
    err.hidden = true; btn.disabled = true; btn.classList.add("loading");
    const payload = {
      email: $("#authEmail").value.trim(), password: $("#authPassword").value,
      display_name: $("#authName").value.trim(), invite: $("#authInvite").value.trim()
    };
    try {
      const body = await api(`/auth/${state.accountMode}`, { method: "POST", body: JSON.stringify(payload) });
      state.account = body.user;
      unlockApp();
      toast(`Welcome, ${body.user.display_name || body.user.email}`, "ok", "Signed in");
      location.reload();
    } catch (ex) {
      err.textContent = ex.message; err.hidden = false;
    } finally { btn.disabled = false; btn.classList.remove("loading"); }
  });
}
async function loadAuthConfig() {
  try { state.authConfig = await api("/auth/config"); }
  catch (_) { state.authConfig = null; }
  return state.authConfig;
}
async function loadAccount() {
  try {
    const me = await api("/auth/me");
    state.account = me.user;
    state.accountStats = me;
    state.localMode = !!me.local;
    document.body.classList.toggle("local-mode", state.localMode);
    if (me.prefs && typeof me.prefs === "object" && Object.keys(me.prefs).length) {
      mergeServerPrefs(me.prefs);
    }
    const name = me.user.display_name || me.user.email;
    $("#accountName").textContent = name;
    $("#accountEmail").textContent = state.localMode ? "local workspace" : me.user.email;
    $("#accountAvatar").textContent = (name || "?").slice(0, 2);
    $("#accountChip").title = state.localMode ? "Local workspace — everything stays on this computer" : "Signed-in account";
    $("#btnLogout").hidden = state.localMode;
    $("#btnLogout").style.display = state.localMode ? "none" : "";
    unlockApp();
    return true;
  } catch (_) {
    finishBoot();
    lockApp();
    return false;
  }
}

setUnauthorizedHandler(lockApp);

export { bindAuth, loadAuthConfig, loadAccount, setAuthMode };
