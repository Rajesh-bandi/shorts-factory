/* ---------- modal / toasts / palette ---------- */
import { state, $, esc } from "./core.js";
import { icon } from "./icons.js";
import { prefs } from "./prefs.js";
import { blip } from "./sounds.js";
import { focusable, restoreFocus } from "./focus.js";

let modalReturnFocus = null;
let modalOpen = false;

function showModal({ title = "", body = "", foot = "", wide = false }) {
  if (!modalOpen) modalReturnFocus = document.activeElement;
  modalOpen = true;
  $("#modalTitle").textContent = title;
  $("#modalBody").innerHTML = body;
  $("#modalFoot").innerHTML = foot;
  $("#modalBox").classList.toggle("wide", wide);
  $("#modalOverlay").hidden = false;
  requestAnimationFrame(() => {
    const box = $("#modalBox");
    const target = focusable(box)[0] || box;
    if (target && typeof target.focus === "function") target.focus({ preventScroll: true });
  });
}
function closeModal() {
  const overlay = $("#modalOverlay");
  if (!overlay || overlay.hidden) return;
  overlay.hidden = true;
  $("#modalBody").innerHTML = "";
  $("#modalFoot").innerHTML = "";
  const resolve = state.confirmResolve;
  state.confirmResolve = null;
  if (resolve) resolve(false);
  modalOpen = false;
  const returnTo = modalReturnFocus;
  modalReturnFocus = null;
  restoreFocus(returnTo);
}
function confirmDialog(title, message, okLabel = "Confirm", danger = false) {
  return new Promise((resolve) => {
    showModal({
      title,
      body: `<p class="confirm-text">${esc(message)}</p>`,
      foot: `<button class="btn ghost" data-modal-cancel>Cancel</button><button class="btn ${danger ? "danger-text" : "primary"}" data-modal-ok>${esc(okLabel)}</button>`
    });
    state.confirmResolve = resolve;
    const foot = $("#modalFoot");
    foot.querySelector("[data-modal-ok]").onclick = () => { const r = state.confirmResolve; state.confirmResolve = null; closeModal(); if (r) r(true); };
    foot.querySelector("[data-modal-cancel]").onclick = () => { const r = state.confirmResolve; state.confirmResolve = null; closeModal(); if (r) r(false); };
  });
}
function toast(message, type = "info", title = "", options = {}) {
  const wrap = $("#toasts");
  if (!wrap) return;
  const actions = Array.isArray(options.actions) ? options.actions : [];
  const el = document.createElement("div");
  el.className = `toast ${type}${options.className ? ` ${options.className}` : ""}`;
  const ico = { ok: "check", err: "alert", warn: "info", info: "info" }[type] || "info";
  const actionHtml = actions.length
    ? `<div class="toast-actions">${actions.map((action, index) => `<button type="button" class="toast-action${action.primary ? " primary" : ""}" data-toast-action="${index}">${esc(action.label)}</button>`).join("")}</div>`
    : "";
  const timeout = options.timeout === 0 ? 0 : Number(options.timeout) || 4600;
  el.innerHTML = `<span class="toast-ico">${icon(ico)}</span><div class="toast-copy">${title ? `<strong>${esc(title)}</strong>` : ""}<span>${esc(message)}</span>${actionHtml}</div><button class="toast-x" aria-label="Dismiss">${icon("x")}</button>${timeout > 0 ? '<i class="toast-life"></i>' : ""}`;
  wrap.appendChild(el);
  blip(type);
  const kill = () => el.remove();
  el.querySelector(".toast-x").onclick = kill;
  el.querySelectorAll("[data-toast-action]").forEach((button) => {
    const action = actions[Number(button.dataset.toastAction)];
    if (action && typeof action.run === "function") button.onclick = () => action.run(button, el);
  });
  if (timeout > 0) setTimeout(kill, timeout);
  return { el, kill };
}
function copy(text) {
  const done = () => toast("Copied to clipboard", "ok");
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
  else fallbackCopy(text, done);
}
function fallbackCopy(text, done) {
  const ta = document.createElement("textarea"); ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
  document.body.appendChild(ta); ta.select();
  try { document.execCommand("copy"); done(); } catch (_) { toast("Could not copy", "err"); }
  ta.remove();
}
let confettiToken = 0;
function confetti() {
  if (prefs.motion !== "full") return;
  const canvas = $("#confetti");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  canvas.width = window.innerWidth; canvas.height = window.innerHeight;
  const css = getComputedStyle(document.documentElement);
  const colors = [css.getPropertyValue("--accent"), css.getPropertyValue("--accent2"), css.getPropertyValue("--green"), css.getPropertyValue("--purple"), css.getPropertyValue("--aqua")].map((c) => c.trim());
  const parts = Array.from({ length: 90 }, () => ({
    x: canvas.width / 2 + (Math.random() - 0.5) * 200, y: canvas.height * 0.42,
    vx: (Math.random() - 0.5) * 11, vy: -Math.random() * 11 - 3,
    size: 3 + Math.random() * 5, color: colors[Math.floor(Math.random() * colors.length)],
    rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.3
  }));
  const token = ++confettiToken;
  const start = performance.now();
  const frame = (now) => {
    if (token !== confettiToken) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    parts.forEach((p) => {
      p.vy += 0.32; p.x += p.vx; p.y += p.vy; p.vx *= 0.995; p.rot += p.vr;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.globalAlpha = Math.max(0, 1 - (now - start) / 2400);
      ctx.fillStyle = p.color; ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6); ctx.restore();
    });
    if (now - start < 2400) requestAnimationFrame(frame); else ctx.clearRect(0, 0, canvas.width, canvas.height);
  };
  requestAnimationFrame(frame);
}

export { showModal, closeModal, confirmDialog, toast, copy, confetti };
