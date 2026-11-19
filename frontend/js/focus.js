/* Shorts Factory — focus helpers for dialogs, drawers and overlays. */

const FOCUSABLE = [
  "a[href]", "button:not([disabled])", "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])", "textarea:not([disabled])", "[tabindex]:not([tabindex='-1'])",
  "[contenteditable='true']"
].join(",");

export function focusable(container) {
  if (!container) return [];
  return Array.from(container.querySelectorAll(FOCUSABLE)).filter((el) => {
    if (el.closest("[hidden]")) return false;
    if (el.getAttribute("aria-hidden") === "true") return false;
    return el.getClientRects().length > 0;
  });
}

export function trapTab(event, container) {
  if (!container) return;
  const list = focusable(container);
  if (!list.length) {
    event.preventDefault();
    if (typeof container.focus === "function") container.focus({ preventScroll: true });
    return;
  }
  const first = list[0], last = list[list.length - 1];
  const active = document.activeElement;
  if (event.shiftKey && (active === first || !container.contains(active))) {
    event.preventDefault();
    last.focus({ preventScroll: true });
  } else if (!event.shiftKey && (active === last || !container.contains(active))) {
    event.preventDefault();
    first.focus({ preventScroll: true });
  }
}

export function restoreFocus(element) {
  if (!element || !element.isConnected || typeof element.focus !== "function") return;
  try { element.focus({ preventScroll: true }); } catch (_) { /* element is gone */ }
}
