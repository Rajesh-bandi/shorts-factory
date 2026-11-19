import { prefs } from "./prefs.js";

let audioCtx = null, audioMaster = null, lastHoverAt = 0, lastClickAt = 0;

function audioContext() {
  if (!prefs.sound) return null;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
    if (!audioMaster) {
      audioMaster = audioCtx.createGain();
      audioMaster.gain.value = 0.62;
      audioMaster.connect(audioCtx.destination);
    }
    return audioCtx;
  } catch (_) {
    return null;
  }
}

function soundTone(ctx, { freq = 440, end = freq, dur = .1, type = "sine", vol = .035, delay = 0 }) {
  const t = ctx.currentTime + delay;
  const osc = ctx.createOscillator(), gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(Math.max(20, freq), t);
  if (end !== freq) osc.frequency.exponentialRampToValueAtTime(Math.max(20, end), t + dur);
  gain.gain.setValueAtTime(.0001, t);
  gain.gain.exponentialRampToValueAtTime(Math.max(.0002, vol), t + .012);
  gain.gain.exponentialRampToValueAtTime(.0001, t + dur);
  osc.connect(gain); gain.connect(audioMaster);
  osc.start(t); osc.stop(t + dur + .03);
}

function soundNoise(ctx, { dur = .12, vol = .018, freq = 900, q = .8, delay = 0 } = {}) {
  const t = ctx.currentTime + delay;
  const frames = Math.max(1, Math.floor(ctx.sampleRate * dur));
  const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
  const src = ctx.createBufferSource(), filter = ctx.createBiquadFilter(), gain = ctx.createGain();
  src.buffer = buffer;
  filter.type = "bandpass"; filter.frequency.setValueAtTime(freq, t); filter.Q.value = q;
  gain.gain.setValueAtTime(.0001, t);
  gain.gain.exponentialRampToValueAtTime(vol, t + .01);
  gain.gain.exponentialRampToValueAtTime(.0001, t + dur);
  src.connect(filter); filter.connect(gain); gain.connect(audioMaster);
  src.start(t); src.stop(t + dur + .02);
}

function blip(type) {
  if (!prefs.sound) return;
  const ctx = audioContext();
  if (!ctx) return;
  try {
    if (prefs.palette === "vice") {
      if (type === "ok") {
        [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => soundTone(ctx, {
          freq, dur: .18, type: "triangle", vol: .027, delay: i * .055
        }));
        soundNoise(ctx, { dur: .16, vol: .009, freq: 2600, q: .7, delay: .08 });
      } else if (type === "err") {
        soundTone(ctx, { freq: 190, end: 86, dur: .28, type: "sawtooth", vol: .028 });
        soundTone(ctx, { freq: 95, end: 48, dur: .2, type: "square", vol: .012, delay: .03 });
      } else if (type === "warn") {
        soundTone(ctx, { freq: 430, end: 350, dur: .17, type: "square", vol: .018 });
      } else {
        soundTone(ctx, { freq: 690, end: 980, dur: .13, type: "sine", vol: .024 });
      }
      return;
    }
    soundTone(ctx, {
      freq: type === "err" ? 180 : type === "ok" ? 620 : type === "warn" ? 420 : 520,
      dur: .16, type: type === "err" ? "sawtooth" : "sine", vol: .032
    });
  } catch (_) { /* audio blocked */ }
}

function uiSound(kind) {
  if (!prefs.sound) return;
  const now = performance.now();
  if (kind === "hover") {
    if (!audioCtx || audioCtx.state !== "running" || now - lastHoverAt < 85) return;
    lastHoverAt = now;
  } else if (now - lastClickAt < 32) {
    return;
  }
  const ctx = audioContext();
  if (!ctx) return;
  try {
    if (kind === "hover") {
      soundTone(ctx, { freq: 1420, end: 1680, dur: .035, type: "sine", vol: .008 });
      if (prefs.palette === "vice") soundNoise(ctx, { dur: .035, vol: .004, freq: 3200, q: 1.4 });
      return;
    }
    lastClickAt = now;
    if (prefs.palette === "vice") {
      soundNoise(ctx, { dur: .055, vol: .017, freq: 2100, q: .75 });
      soundTone(ctx, { freq: 820, end: 250, dur: .07, type: "triangle", vol: .026 });
      soundTone(ctx, { freq: 145, end: 76, dur: .11, type: "sine", vol: .024 });
    } else {
      soundTone(ctx, { freq: 560, end: 430, dur: .06, type: "sine", vol: .024 });
    }
  } catch (_) { /* audio blocked */ }
}

function bindAudio() {
  if (!(window.AudioContext || window.webkitAudioContext)) return;
  const hit = (el) => el && el.closest("button, a[href], [role='button'], .palette-card, .filter, .tab, .chip, .switch, .nav-item, .quick-btn, .recent-row, .history-card, .hook");
  document.addEventListener("pointerdown", (e) => {
    const target = hit(e.target);
    if (target && !target.disabled && target.getAttribute("aria-disabled") !== "true") uiSound("click");
  }, true);
  let hovered = null;
  document.addEventListener("pointerover", (e) => {
    const target = hit(e.target);
    if (!target || target === hovered || target.disabled) return;
    hovered = target;
    uiSound("hover");
  }, true);
  document.addEventListener("pointerout", (e) => { if (!e.relatedTarget) hovered = null; }, true);
}

export { blip, uiSound, bindAudio };
