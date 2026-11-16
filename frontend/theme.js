/* Shorts Factory — theme engine. Loaded synchronously so there is no flash. */
(function () {
  "use strict";

  const PALETTES = {
    gruvbox: {
      name: "Gruvbox",
      tag: "warm · terminal",
      dark: {
        bg: "#1b1b1b", bg2: "#202020", panel: "#282828", panel2: "#32302f",
        line: "#3c3836", line2: "#504945",
        fg: "#ebdbb2", dim: "#bdae93", faint: "#928374",
        accent: "#fe8019", accent2: "#fabd2f",
        red: "#fb4934", green: "#b8bb26", yellow: "#fabd2f",
        blue: "#83a598", purple: "#d3869b", aqua: "#8ec07c", orange: "#fe8019",
      },
      light: {
        bg: "#fbf1c7", bg2: "#f2e5bc", panel: "#f9f5d7", panel2: "#ebdbb2",
        line: "#e0cfae", line2: "#d5c4a1",
        fg: "#3c3836", dim: "#504945", faint: "#7c6f64",
        accent: "#af3a03", accent2: "#b57614",
        red: "#9d0006", green: "#79740e", yellow: "#b57614",
        blue: "#076678", purple: "#8f3f71", aqua: "#427b58", orange: "#d65d0e",
      },
    },
    omarchy: {
      name: "Omarchy Green",
      tag: "sage · terminal",
      dark: {
        bg: "#1b1b19", bg2: "#20201d", panel: "#222220", panel2: "#2a2a26",
        line: "#33332e", line2: "#45453d",
        fg: "#d8d5c9", dim: "#a5a297", faint: "#77766c",
        accent: "#a9bc73", accent2: "#c4d3a0",
        red: "#c97a6a", green: "#a9bc73", yellow: "#d8ab55",
        blue: "#8aa6a0", purple: "#b3949a", aqua: "#92b8a4", orange: "#d39a55",
      },
      light: {
        bg: "#f4f1e4", bg2: "#ece9db", panel: "#fbf9ee", panel2: "#e6e2d3",
        line: "#d6d1c0", line2: "#c3bdab",
        fg: "#2f332b", dim: "#4e554a", faint: "#7d8577",
        accent: "#697a3a", accent2: "#4f7b5c",
        red: "#a34f45", green: "#697a3a", yellow: "#9a742a",
        blue: "#4f7470", purple: "#85606a", aqua: "#4f7b5c", orange: "#a8732f",
      },
    },
    vice: {
      name: "GTA 6",
      tag: "vice · sunset / daytime",
      dark: {
        bg: "#0b0714", bg2: "#120a22", panel: "#1b0f31", panel2: "#271545",
        line: "#40215c", line2: "#5a2f7d",
        fg: "#fff4ee", dim: "#e2c9dd", faint: "#a689b8",
        accent: "#ff2e7e", accent2: "#ffb03a",
        red: "#ff4d5e", green: "#2ff5c5", yellow: "#ffd166",
        blue: "#4cc9f0", purple: "#b388ff", aqua: "#64ffe3", orange: "#ff7a1a",
        sun: "#ffd166", sun2: "#ff3d8d", ocean: "#07203d", city: "#12081f", neon: "#32f5c8",
      },
      light: {
        bg: "#ffe9dc", bg2: "#ffdfcf", panel: "#fff4e8", panel2: "#ffe6d2",
        line: "#e9b9b2", line2: "#d99a99",
        fg: "#2a1230", dim: "#5b3550", faint: "#8d657d",
        accent: "#d5006d", accent2: "#c46a00",
        red: "#c81d3b", green: "#007d70", yellow: "#a66a00",
        blue: "#00749c", purple: "#7d3cb5", aqua: "#008c7e", orange: "#d65a00",
        sun: "#ffca6a", sun2: "#ff4f87", ocean: "#1f7f92", city: "#81556a", neon: "#007c70",
      },
    },
    nord: {
      name: "Nord",
      tag: "cool · arctic",
      dark: {
        bg: "#21252e", bg2: "#262b36", panel: "#2e3440", panel2: "#3b4252",
        line: "#3e4657", line2: "#4c566a",
        fg: "#eceff4", dim: "#c6cfdd", faint: "#7b8a9f",
        accent: "#88c0d0", accent2: "#8fbcbb",
        red: "#bf616a", green: "#a3be8c", yellow: "#ebcb8b",
        blue: "#81a1c1", purple: "#b48ead", aqua: "#8fbcbb", orange: "#d08770",
      },
      light: {
        bg: "#e9edf3", bg2: "#e2e7ef", panel: "#f5f7fa", panel2: "#e5e9f0",
        line: "#d3dae5", line2: "#b8c2d4",
        fg: "#2e3440", dim: "#434c5e", faint: "#6d7a8c",
        accent: "#5e81ac", accent2: "#4c8f96",
        red: "#a83a45", green: "#5f7d3e", yellow: "#a07b1c",
        blue: "#5e81ac", purple: "#8b5f8a", aqua: "#4c8f96", orange: "#b35a37",
      },
    },
    tokyo: {
      name: "Tokyo Night",
      tag: "neon · city",
      dark: {
        bg: "#16161e", bg2: "#1a1b26", panel: "#1f2335", panel2: "#24283b",
        line: "#2f334d", line2: "#3b4261",
        fg: "#c0caf5", dim: "#a9b1d6", faint: "#6b7394",
        accent: "#7aa2f7", accent2: "#bb9af7",
        red: "#f7768e", green: "#9ece6a", yellow: "#e0af68",
        blue: "#7aa2f7", purple: "#bb9af7", aqua: "#73daca", orange: "#ff9e64",
      },
      light: {
        bg: "#e8eaf0", bg2: "#dfe2ea", panel: "#f4f5f9", panel2: "#e6e8f0",
        line: "#d2d6e2", line2: "#b9bfd2",
        fg: "#343b58", dim: "#4c5270", faint: "#7a82a0",
        accent: "#34548a", accent2: "#5a4a9e",
        red: "#8c4351", green: "#485e30", yellow: "#8f5e15",
        blue: "#34548a", purple: "#5a4a9e", aqua: "#33635c", orange: "#965027",
      },
    },
    catppuccin: {
      name: "Catppuccin",
      tag: "soft · pastel",
      dark: {
        bg: "#181825", bg2: "#1c1c2a", panel: "#232336", panel2: "#313244",
        line: "#3b3b54", line2: "#45475a",
        fg: "#cdd6f4", dim: "#bac2de", faint: "#7f849c",
        accent: "#fab387", accent2: "#f9e2af",
        red: "#f38ba8", green: "#a6e3a1", yellow: "#f9e2af",
        blue: "#89b4fa", purple: "#cba6f7", aqua: "#94e2d5", orange: "#fab387",
      },
      light: {
        bg: "#e9ecf2", bg2: "#e3e6ee", panel: "#f7f8fb", panel2: "#e6e9ef",
        line: "#d7dbe5", line2: "#ccd0da",
        fg: "#4c4f69", dim: "#5c5f77", faint: "#8c8fa1",
        accent: "#e05a1e", accent2: "#b98210",
        red: "#d20f39", green: "#40a02b", yellow: "#a1760a",
        blue: "#1e66f5", purple: "#8839ef", aqua: "#179299", orange: "#e05a1e",
      },
    },
    rosepine: {
      name: "Rosé Pine",
      tag: "muted · literary",
      dark: {
        bg: "#16141f", bg2: "#1a1726", panel: "#1f1d2e", panel2: "#26233a",
        line: "#302d41", line2: "#403d52",
        fg: "#e0def4", dim: "#b8b4d1", faint: "#807ca1",
        accent: "#ebbcba", accent2: "#f6c177",
        red: "#eb6f92", green: "#9ccfd8", yellow: "#f6c177",
        blue: "#9ccfd8", purple: "#c4a7e7", aqua: "#31748f", orange: "#ea9a97",
      },
      light: {
        bg: "#faf4ed", bg2: "#f5ede4", panel: "#fffaf3", panel2: "#f2e9e1",
        line: "#e9e0d8", line2: "#dfdad9",
        fg: "#575279", dim: "#6e6a86", faint: "#9893a5",
        accent: "#b4637a", accent2: "#a8752a",
        red: "#b4637a", green: "#286983", yellow: "#a8752a",
        blue: "#286983", purple: "#907aa9", aqua: "#56949f", orange: "#c26d4a",
      },
    },
  };

  const DEFAULT_PREFS = {
    palette: "vice",
    mode: "dark",
    accent: "",
    font: "mono",
    radius: "soft",
    density: "cozy",
    motion: "full",
    aurora: true,
    grain: true,
    grid: false,
    scan: false,
    sound: false,
    cursor: true,
    sidebar: true,
  };

  const RADII = {
    sharp: ["3px", "2px"],
    soft: ["6px", "4px"],
    round: ["14px", "9px"],
  };

  const KEY = "ytm.prefs.v3";
  const LEGACY_KEY = "ytm.prefs.v2";

  function load() {
    const reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    try {
      const current = JSON.parse(localStorage.getItem(KEY) || "null");
      if (current && typeof current === "object") {
        const merged = { ...DEFAULT_PREFS, ...current };
        if (reduceMotion) merged.motion = "reduced";
        return merged;
      }
      const old = JSON.parse(localStorage.getItem(LEGACY_KEY) || "null");
      const legacy = old && typeof old === "object" ? old : {};
      const switchTheme = !legacy.palette || legacy.palette === "gruvbox";
      const migrated = {
        ...DEFAULT_PREFS,
        ...legacy,
        palette: switchTheme ? DEFAULT_PREFS.palette : legacy.palette,
        accent: switchTheme ? "" : (legacy.accent || ""),
      };
      if (reduceMotion) migrated.motion = "reduced";
      try { localStorage.setItem(KEY, JSON.stringify(migrated)); } catch (_) { /* ignore */ }
      return migrated;
    } catch (_) {
      return { ...DEFAULT_PREFS, ...(reduceMotion ? { motion: "reduced" } : {}) };
    }
  }

  function save(prefs) {
    try {
      localStorage.setItem(KEY, JSON.stringify(prefs));
    } catch (_) {
      /* private mode */
    }
  }

  function lum(hex) {
    const h = String(hex).replace("#", "");
    if (h.length !== 6) return 0;
    const n = parseInt(h, 16);
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  }

  function apply(prefs) {
    const root = document.documentElement;
    const palette = PALETTES[prefs.palette] || PALETTES.gruvbox;
    const followsSystem = prefs.mode === "system";
    const prefersDark = !window.matchMedia || !window.matchMedia("(prefers-color-scheme: light)").matches;
    const mode = followsSystem ? (prefersDark ? "dark" : "light") : prefs.mode === "light" ? "light" : "dark";
    const vars = palette[mode] || palette.dark;

    for (const [k, v] of Object.entries(vars)) {
      root.style.setProperty("--" + k, v);
    }

    const accent = prefs.accent || vars.accent;
    root.style.setProperty("--accent", accent);
    if (prefs.accent) root.style.setProperty("--accent2", accent);
    root.style.setProperty("--accent-ink", lum(accent) > 0.56 ? "#1b1b1b" : "#fbf1c7");

    const [r, rSm] = RADII[prefs.radius] || RADII.soft;
    root.style.setProperty("--r", r);
    root.style.setProperty("--r-sm", rSm);

    root.dataset.mode = mode;
    root.dataset.modePref = prefs.mode;
    root.dataset.palette = prefs.palette;
    root.dataset.font = prefs.font;
    root.dataset.density = prefs.density;
    root.dataset.radius = prefs.radius;
    root.dataset.motion = prefs.motion;
    root.dataset.aurora = prefs.aurora ? "on" : "off";
    root.dataset.grain = prefs.grain ? "on" : "off";
    root.dataset.grid = prefs.grid ? "on" : "off";
    root.dataset.scan = prefs.scan ? "on" : "off";
    root.dataset.cursor = prefs.cursor === false ? "off" : "on";
    root.dataset.sidebar = prefs.sidebar ? "open" : "closed";
    root.style.colorScheme = mode;

    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", vars.bg);
  }

  function set(patch, prefs) {
    const next = { ...prefs, ...patch };
    save(next);
    apply(next);
    document.dispatchEvent(new CustomEvent("ytm:prefs", { detail: next }));
    return next;
  }

  function reset() {
    const next = { ...DEFAULT_PREFS };
    save(next);
    apply(next);
    document.dispatchEvent(new CustomEvent("ytm:prefs", { detail: next }));
    return next;
  }

  const initial = load();
  apply(initial);

  if (window.matchMedia) {
    const scheme = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = () => {
      const current = load();
      if (current.mode === "system") {
        apply(current);
        document.dispatchEvent(new CustomEvent("ytm:prefs", { detail: current }));
      }
    };
    if (scheme.addEventListener) scheme.addEventListener("change", onChange);
    else if (scheme.addListener) scheme.addListener(onChange);
  }

  window.YTMTheme = { PALETTES, DEFAULT_PREFS, RADII, load, save, apply, set, reset, KEY };
})();
