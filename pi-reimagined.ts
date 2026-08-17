import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { CustomEditor } from "@earendil-works/pi-coding-agent";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join, basename } from "node:path";
import { homedir } from "node:os";

// pi reimagined: rounded input box, glow working text, sparkle spinner,
// turn stats (elapsed + tokens), ember thinking box, and switchable palettes
// (ember / void / ocean / forest).

// --- persisted feature toggles (/pi-reimagined settings menu) --------------
const CFG_PATH = join(
  process.env.USERPROFILE || process.env.HOME || ".",
  ".pi",
  "agent",
  "pi-reimagined.config.json",
);
interface BorderStatus {
  progress: boolean; // context-fill bar (glyph style: cfg.barStyle)
  percentage: boolean; // 54%
  path: boolean; // E:\Apps\LLM\pi-reimagined
  model: boolean; // model-id
  branch: boolean; // git branch (right of path)
  cacheHits: boolean; // cache hits (right of percentage)
  diffStats: boolean; // lines added/removed from git diff
}
interface Cfg {
  roundedBox: boolean;
  promptChar: boolean;
  borderStatus: boolean | Partial<BorderStatus>; // true = all, object = per-element
  barStyle: string; // context-fill bar glyphs (BAR_STYLES)
  glowText: boolean;
  sparkleSpinner: boolean;
  turnStats: boolean;
  thinkBox: boolean;
  collapseThinking: boolean;
  customHeader: boolean;
  palette: string;
}
const borderDefault: BorderStatus = { progress: true, percentage: true, path: true, model: true, branch: false, cacheHits: false, diffStats: false };
function bsOn(key: keyof BorderStatus): boolean {
  if (cfg.borderStatus === true) return borderDefault[key]; // legacy: use per-element defaults
  return (cfg.borderStatus as Partial<BorderStatus>)?.[key] ?? borderDefault[key];
}
const cfg: Cfg = {
  roundedBox: true,
  promptChar: true,
  borderStatus: true,
  barStyle: "blocks",
  glowText: true,
  sparkleSpinner: true,
  turnStats: true,
  thinkBox: true,
  collapseThinking: false,
  customHeader: true,
  palette: "ember",
};

// --- palettes --------------------------------------------------------------
// The signature look (glow crest, prompt, sparkle) is raw RGB the theme json
// can't express (theme.fg() returns baked ANSI, not channels we can lerp).
// Each palette bundles that RGB + glyphs AND names a matching pi theme json,
// so switching palette reskins both the brand bits and the theme-routed bits.
type RGB = [number, number, number];
interface Palette {
  theme: string; // pi theme to setTheme() when this palette is picked
  base: RGB; // ember-base of glow + working text + box border
  crest: RGB; // hot crest the glow lerps toward
  prompt: RGB; // ❯ + ✷ star accent (matches theme accent)
  promptChar: string;
  star: string;
  spinner: string[];
}
const PALETTES: Record<string, Palette> = {
  ember: {
    theme: "ember",
    base: [214, 128, 74], // #d6804a
    crest: [255, 224, 160], // #ffe0a0
    prompt: [255, 130, 5], // #ff8205
    promptChar: "❯",
    star: "✷",
    spinner: ["·", "˚", "✷", "✶", "✸", "✶", "✷", "˚"],
  },
  void: {
    theme: "void",
    base: [150, 120, 214], // #9678d6
    crest: [224, 200, 255], // #e0c8ff
    prompt: [168, 85, 247], // #a855f7
    promptChar: "❯",
    star: "✦",
    spinner: ["·", "∴", "✦", "⋆", "✦", "∴", "·", "˙"], // dots coalesce into a twinkling star
  },
  ocean: {
    theme: "ocean",
    base: [74, 164, 214], // #4aa4d6
    crest: [180, 235, 255], // #b4ebff
    prompt: [56, 189, 248], // #38bdf8
    promptChar: "❯",
    star: "○",
    spinner: ["·", "∘", "○", "◯", "○", "∘", "·", "˚"], // a bubble swelling then rising
  },
  forest: {
    theme: "forest",
    base: [106, 191, 105], // #6abf69
    crest: [214, 245, 192], // #d6f5c0
    prompt: [74, 222, 128], // #4ade80
    promptChar: "❯",
    star: "❀",
    spinner: ["·", "‧", "❀", "✿", "❀", "✿", "❀", "‧"], // sprout unfurling into bloom
  },
};
function loadCfg(): void {
  try {
    Object.assign(cfg, JSON.parse(readFileSync(CFG_PATH, "utf8")));
  } catch {
    /* first run / unreadable -> keep defaults */
  }
  if (!BAR_STYLES.includes(cfg.barStyle as BarStyle)) cfg.barStyle = "blocks";
}
function saveCfg(): void {
  try {
    writeFileSync(CFG_PATH, JSON.stringify(cfg, null, 2));
  } catch {
    /* best-effort; non-fatal */
  }
}

// pi version, read once from the installed package.json (cheap, cached).
let PI_VERSION = "";
function piVersion(): string {
  if (PI_VERSION) return PI_VERSION;
  try {
    const pkg = join(
      process.env.APPDATA || join(process.env.USERPROFILE || ".", "AppData", "Roaming"),
      "npm", "node_modules", "@earendil-works", "pi-coding-agent", "package.json",
    );
    PI_VERSION = JSON.parse(readFileSync(pkg, "utf8")).version || "";
  } catch {
    /* unreadable -> leave blank */
  }
  return PI_VERSION;
}

// single-line footer + animated flame spinner.
// ponytail: custom setFooter so the whole status fits one row (built-in renders 2-3 lines).
// Colors come from the active theme via theme.fg(), so this stays palette-agnostic.

const BAR_W = 13;
type BarStyle = "blocks" | "diamonds" | "dots" | "shades";
const BAR_STYLES: BarStyle[] = ["blocks", "diamonds", "dots", "shades"];
function formatCtxWindow(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  return `${Math.round(tokens / 1000)}k`;
}
// Context-fill bar glyphs. `exact` = filled cells (fractional, 0..BAR_W). Each
// style returns fill + track separately so renderers can color them
// independently (fill = accent, track = grey). The bar bounds itself — no brackets.
function barGlyphs(style: BarStyle, exact: number): { fill: string; track: string } {
  const rest = (n: number, g: string) => g.repeat(Math.max(0, n));
  switch (style) {
    case "diamonds": // ◆ filled vs ◇ hollow
    {
      const full = Math.round(exact);
      return { fill: "◆".repeat(full), track: rest(BAR_W - full, "◇") };
    }
    case "dots": // ● filled vs ○ hollow
    {
      const full = Math.round(exact);
      return { fill: "●".repeat(full), track: rest(BAR_W - full, "○") };
    }
    case "shades": // ▓ fill, ▒ half, ░ track
    {
      const full = Math.floor(exact);
      const edge = exact - full >= 0.5 ? "▒" : "";
      return { fill: "▓".repeat(full) + edge, track: rest(BAR_W - full - edge.length, "░") };
    }
    case "blocks": // █ fill + 1/8-cell edge + ░ track
    default: {
      const full = Math.floor(exact);
      const e = Math.round((exact - full) * 8);
      if (e === 8) return { fill: "█".repeat(full + 1), track: rest(BAR_W - full - 1, "░") };
      const edge = ["", "▏", "▎", "▍", "▌", "▋", "▊", "▉"][e];
      return { fill: "█".repeat(full) + edge, track: rest(BAR_W - full - edge.length, "░") };
    }
  }
}
function ctxBar(percent: number, contextWindow?: number, autoCompact?: boolean): { fill: string; track: string; pctLabel: string; color: string } {
  const p = Math.max(0, Math.min(100, percent));
  const style = BAR_STYLES.includes(cfg.barStyle as BarStyle) ? (cfg.barStyle as BarStyle) : "blocks";
  const { fill, track } = barGlyphs(style, (p / 100) * BAR_W);
  const autoLabel = autoCompact ? " (auto)" : "";
  const pctLabel = contextWindow
    ? `${p.toFixed(1)}%/${formatCtxWindow(contextWindow)}${autoLabel}`
    : `${Math.round(p)}%${autoLabel}`;
  // Fill color name for theme.fg() renderers (footer): accent until the
  // amber/red thresholds kick in. Raw-ANSI renderers use barFill() instead.
  const color = p > 90 ? "error" : p > 70 ? "warning" : "accent";
  return { fill, track, pctLabel, color };
}

function homeRel(cwd: string): string {
  const home = process.env.USERPROFILE || process.env.HOME || "";
  if (home && cwd.toLowerCase().startsWith(home.toLowerCase())) {
    const rest = cwd.slice(home.length).replace(/^[\\/]/, "");
    return rest ? `~${cwd[home.length] || "\\"}${rest}` : "~";
  }
  return cwd;
}

// --- glowing "working" label ---------------------------------------------
// pi colors the working message via theme.fg("muted", ...), but embedded ANSI
// per-char overrides it, so we paint each char ourselves: a hot crest that
// travels left->right over a cool ember base. Animated by a timer that re-sets
// the message each tick (ctx.ui.setWorkingMessage).
const WORDS = [
  "Working", "Tomfoolering", "Bamboozling", "Conjuring", "Finagling",
  "Noodling", "Percolating", "Ruminating", "Scheming", "Wrangling",
  "Concocting", "Marinating", "Puttering", "Simmering", "Cogitating",
  "Hatching", "Tinkering", "Brewing", "Frolicking", "Smelting",
];
const GLOW_TICK_MS = 90;
const DOT_EVERY = 4; // ticks per dot step (.. slower than the crest)
const CREST_SPAN = 2.2; // crest half-width in chars

// Active palette + ANSI derived from it. Rebuilt by applyPalette() on load and
// on every palette change so the glow/prompt/sparkle repaint live.
let P: Palette = PALETTES.ember;

const lerp = (a: number, b: number, t: number) => Math.round(a + (b - a) * t);
const tc = (r: number, g: number, b: number, s: string) =>
  `\x1b[38;2;${r};${g};${b}m${s}\x1b[0m`;

// Grapheme/east-asian-width-aware measuring, wired to pi-tui's real implementation
// by loadHost() once it resolves. Our glyphs (✷ ✶ ✸ ✦ ○ ❀ ✿) are East-Asian-Width
// "Ambiguous" -- terminals that render them 2-col wide overflow raw .length math
// by exactly the miscounted glyphs. .length fallback covers only the sliver of
// time before session_start's loadHost() resolves.
// ponytail: fallback assumes 1 unit = 1 col; only wrong if a render fires that early.
let VW: (s: string) => number = (s) => s.length;

function glow(word: string, phase: number): string {
  let out = "";
  for (let i = 0; i < word.length; i++) {
    const t = Math.max(0, 1 - Math.abs(i - phase) / CREST_SPAN); // 1 at crest
    out += tc(
      lerp(P.base[0], P.crest[0], t),
      lerp(P.base[1], P.crest[1], t),
      lerp(P.base[2], P.crest[2], t),
      word[i],
    );
  }
  return out;
}

// --- turn stats (Claude Code style) ----------------------------------------
// While working: "(25s · ↓ 3.6k tokens)" appended to the working text.
// On settle: "✷ Worked for 53s" dim status line under the turn.
let turnStart: number | null = null; // first agent_start; survives auto-retry runs
let settledTokens = 0; // output tokens of finalized assistant messages this turn
let liveTokens = 0; // output tokens of the in-flight assistant message

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return `${n}`;
}

function turnStatsSuffix(): string {
  if (!cfg.turnStats || turnStart == null) return "";
  const s = Math.max(0, Math.floor((Date.now() - turnStart) / 1000));
  const t = s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${DIM_PRE} (${t} · ↓ ${fmtTokens(settledTokens + liveTokens)} tokens)${RST}`;
}

// sparkle spinner frames (rendered verbatim, so we add color).
// Match the working text's base shade so star + word read as one.
const RST = "\x1b[0m";
let BASE_PRE = ""; // \x1b[38;2;r;g;bm for the palette base — set by applyPalette
let DIM_PRE = ""; // dimmed palette base (turn-stats suffix) — set by applyPalette
let SPIN: string[] = []; // colored spinner frames — set by applyPalette

// header sweep animation state
let sweepPhase = 0; // sweep column offset (global, read by makeHeader render)
let sweepTimer: ReturnType<typeof setInterval> | undefined;
let hdrComp: any; // captured header component ref for invalidate

// Recompute palette + derived ANSI/glyphs. Cheap; safe to call on every change.
function applyPalette(): void {
  P = PALETTES[cfg.palette] || PALETTES.ember;
  BASE_PRE = `\x1b[38;2;${P.base[0]};${P.base[1]};${P.base[2]}m`;
  DIM_PRE = `\x1b[38;2;${Math.round(P.base[0] * 0.55)};${Math.round(P.base[1] * 0.55)};${Math.round(P.base[2] * 0.55)}m`;
  SPIN = P.spinner.map((f) => `${BASE_PRE}${f}${RST}`);
  PROMPT = tc(P.prompt[0], P.prompt[1], P.prompt[2], P.promptChar);
  STAR = tc(P.prompt[0], P.prompt[1], P.prompt[2], P.star);
}

let glowTimer: ReturnType<typeof setInterval> | undefined;

// --- rounded input box -----------------------------------------------------
// The stock editor draws only top/bottom ─ lines (editor.js: "no side borders").
// We subclass it and DECORATE the rendered rows instead of re-laying-out text:
//   - pure ─ rows  -> rounded ╭─╮ / ╰─╯
//   - other rows   -> overlay │ onto the existing left/right padding spaces
// Overlaying (not inserting) keeps every text column — and the embedded hardware
// cursor marker — exactly where it was, so the cursor stays aligned. Needs
// paddingX >= 1 so col 0 and the last col are spaces we can paint over.
const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

// prompt char + star, painted onto the box. Palette-colored; set by applyPalette.
let PROMPT = "";
let STAR = "";
const DIR_C: [number, number, number] = [150, 150, 150]; // dim grey (palette-agnostic)
// Bar FILL color: bright theme accent, amber above 70%, red above 90%. The
// track stays DIR_C grey (painted by the render sites). `host.T` is the shared
// theme proxy (live per render, follows palette switches); until loadHost()
// resolves we fall back to the palette base RGB.
const barFill = (p: number, fill: string): string => {
  if (!fill) return "";
  if (p > 90) return tc(248, 92, 92, fill);
  if (p > 70) return tc(248, 163, 92, fill);
  return host?.T?.fg ? host.T.fg("accent", fill) : tc(P.base[0], P.base[1], P.base[2], fill);
};

// Live status the box shows in its border rows. Set by the factory from ctx.
interface BoxInfo {
  model: string;
  thinkingLevel?: string;
  percent: number;
  contextWindow: number;
  dir: string;
  branch?: string;
  cacheHits?: number;
  diffAdded?: number;
  diffRemoved?: number;
}

const CTRLC_EXIT_MS = 500; // double-press window; warning label lives exactly this long

let _renderDiag = false; // one-time diagnostic flag

class EmberEditor extends CustomEditor {
  getInfo?: () => BoxInfo;
  private ctrlCWarnUntil = 0; // Date.now() deadline; render() shows exit hint until then

  setPaddingX(p: number): void {
    super.setPaddingX(Math.max(2, p)); // col0 = ❯/│, col1 = space, text from col2
  }

  handleInput(data: string): void {
    // Ctrl+C: if text → clear it. If empty → shutdown on double-press.
    // Bypass CustomEditor's actionHandlers loop (it never fires app.clear).
    if (this.keybindings?.matches(data, "app.clear")) {
      const text = this.getText();
      if (text.length > 0) {
        this.setText("");
        (this as any).tui?.requestRender();
      }
      else {
        const now = Date.now();
        if (now - ((this as any)._lastCtrlC || 0) < CTRLC_EXIT_MS) {
          (this as any)._ctx.shutdown?.();
        } else {
          // first press: show "press again to exit" for the double-press window,
          // then force one more render so the hint clears itself even if the
          // user never touches the keyboard again.
          this.ctrlCWarnUntil = now + CTRLC_EXIT_MS;
          (this as any).tui?.requestRender();
          setTimeout(() => (this as any).tui?.requestRender(), CTRLC_EXIT_MS);
        }
        (this as any)._lastCtrlC = now;
      }
      return; // don't pass to super
    }
    super.handleInput(data);
  }

  // Build a corner row with a right-aligned label baked into the ─ fill.
  // Keeps SAFE dashes + the corner clear so the rounding never gets clobbered.
  private corners(
    lc: string,
    rc: string,
    width: number,
    labelAnsi: string,
    labelLen: number,
  ): string {
    const paint = this.borderColor;
    const inner = Math.max(0, width - 2); // between corners
    const SAFE = 2;
    const PAD = 1;
    const need = labelLen + PAD * 2 + SAFE;
    if (!labelLen || inner < need + 1) {
      return paint(lc) + paint("─".repeat(inner)) + paint(rc); // no room -> plain
    }
    return (
      paint(lc) +
      paint("─".repeat(inner - need)) +
      " ".repeat(PAD) +
      labelAnsi +
      " ".repeat(PAD) +
      paint("─".repeat(SAFE)) +
      paint(rc)
    );
  }

  // Build a corner row with both left and right labels.
  // Both labels get same style as corners(): space + label + space, surrounded by dashes.
  private cornersLR(
    lc: string,
    rc: string,
    width: number,
    leftLabel: string,
    leftLen: number,
    rightLabel: string,
    rightLen: number,
  ): string {
    const paint = this.borderColor;
    const inner = Math.max(0, width - 2);
    const SAFE = 2;
    const PAD = 1;
    // lc + fillL + PAD + left + PAD + fillR + PAD + right + PAD + SAFE + rc = width
    const leftNeed = leftLen + PAD * 2;
    const rightNeed = rightLen + PAD * 2 + SAFE;
    // lc(1) + sp(1) + left + sp(1) + fill + sp(1) + right + sp(1) + safe(2) + rc(1) = width
    // fill = width - leftLen - rightLen - 8 = inner - leftLen - rightLen - 6
    const fill = inner - leftLen - rightLen - 6;
    if (fill < 0) {
      return paint(lc) + paint("─".repeat(inner)) + paint(rc); // not enough room
    }
    // lc + space + left + space + fill + space + right + space + SAFE + rc = width
    return (
      paint(lc) +
      " " + leftLabel + " " +
      "─".repeat(Math.max(0, fill)) +
      " " + rightLabel + " " +
      paint("─".repeat(SAFE)) +
      paint(rc)
    );
  }

  // left-truncate a string to max visible chars, prefixing … when cut
  private fitTail(s: string, max: number): string {
    return VW(s) <= max ? s : "…" + s.slice(-(max - 1));
  }

  render(width: number): string[] {
    const rawLines = super.render(width);
    if (!cfg.roundedBox) return rawLines; // box disabled -> stock rendering
    const paint = this.borderColor; // respects theme + bash-mode color cue
    const V = paint("│");

    // Detect scroll indicator line ("↑ N more ──────────────") from editor output.
    // When content overflows, CustomEditor replaces the top border with this.
    // We extract the scroll text, bake it into our top border, and drop the raw line.
    const scrollRe = /^(.+?\s+more)\s*─*$/;
    let scrollLabel: string | null = null;
    const _stripPure = (ls: string[], side: "start" | "end") => {
      // Check if the first/last line is a pure ── or scroll indicator
      const idx = side === "start" ? 0 : ls.length - 1;
      const line = stripAnsi(ls[idx]);
      if (/^─+$/.test(line) || scrollRe.test(line)) {
        if (scrollRe.test(line) && !/^─+$/.test(line)) {
          const m = line.match(scrollRe);
          if (m) scrollLabel = scrollLabel ?? m[1]; // capture first scroll label found
        }
        const rest = side === "start" ? ls.slice(1) : ls.slice(0, -1);
        return rest;
      }
      return ls;
    };

    // Strip original top/border rows (scroll indicator or plain ──)
    if (rawLines.length > 0 && !_renderDiag) {
      const raw0 = stripAnsi(rawLines[0]);
      const hexChars = [...raw0].map(c => c.charCodeAt(0).toString(16)).join(' ');
      console.error(`DIAG: raw[0]=[${raw0}] hex=[${hexChars}] scrollMatch=${scrollRe.test(raw0)}`);
      _renderDiag = true;
    }
    let contentLines = _stripPure(rawLines, "start");
    contentLines = _stripPure(contentLines, "end");

    // Ensure bottom border exists
    const dash = "─".repeat(width);
    const _checkPure = (ls: string[]) =>
      ls.map((l: string, i: number) => (/^─+$/.test(stripAnsi(l)) ? i : -1)).filter((i: number) => i >= 0);
    const _pure = _checkPure(contentLines);
    const renderLines = _pure.length > 0
      ? contentLines // bottom border present
      : [...contentLines, dash]; // synthesize bottom

    // Bottom border index in renderLines
    const pure = _checkPure(renderLines);
    const botI = pure[pure.length - 1] ?? (renderLines.length - 1);
    const promptI = 0; // first content row gets the prompt char

    // Compose the labels (width-aware so long model/dir truncate, not drop).
    const info = cfg.borderStatus ? this.getInfo?.() : undefined;
    const budget = Math.max(0, width - 2) - 2 /*SAFE*/ - 2 /*PAD*/;
    let topLabel = "", topLen = 0, botLabel = "", botLen = 0;
    // Left label: scroll indicator (only when content overflows)
    let leftScrollLabel = "", leftScrollLen = 0;
    if (scrollLabel) {
      leftScrollLabel = tc(P.base[0], P.base[1], P.base[2], scrollLabel);
      leftScrollLen = VW(scrollLabel);
    }
    // Right label: model name (account for left scroll label when present)
    const availForRight = leftScrollLen > 0 ? budget - leftScrollLen - 1 : budget;
    if (info && bsOn("model")) {
      if (info.thinkingLevel) {
        // effort level is the label terminator -> no trailing star (avoids "… ○ xhigh ○")
        const model = this.fitTail(info.model + ` ○ ${info.thinkingLevel}`, Math.max(0, availForRight));
        topLabel = tc(P.base[0], P.base[1], P.base[2], model);
        topLen = VW(topLabel);
      } else {
        const starRoom = VW(" " + STAR);
        const model = this.fitTail(info.model, Math.max(0, availForRight - starRoom));
        topLabel = tc(P.base[0], P.base[1], P.base[2], model) + " " + STAR;
        topLen = VW(topLabel);
      }
    }

      // Bottom label: progress bar + percentage + path + branch + cacheHits + diffStats (each optional)
      if (info) {
        const parts: string[] = [];
        if (bsOn("progress") || bsOn("percentage")) {
          const bar = ctxBar(info.percent);
          // fill = accent (amber/red near full ctx), track + label = dim grey
          parts.push(barFill(info.percent, bar.fill) + tc(DIR_C[0], DIR_C[1], DIR_C[2], `${bar.track} ${bar.pctLabel}`));
        }
        if (bsOn("cacheHits") && info.cacheHits > 0) {
          const fmt = info.cacheHits >= 1_000_000 ? `${(info.cacheHits / 1_000_000).toFixed(1)}M` : info.cacheHits >= 1_000 ? `${Math.round(info.cacheHits / 1000)}k` : `${info.cacheHits}`;
          parts.push(tc(DIR_C[0], DIR_C[1], DIR_C[2], `cache: ${fmt}`));
        }
        if (bsOn("path")) {
          const DIR_MAX = 48;
          const dir = this.fitTail(info.dir, Math.min(DIR_MAX, Math.max(0, budget - parts.reduce((s, p) => s + VW(p), 0))));
          if (dir.length >= 1) parts.push(tc(DIR_C[0], DIR_C[1], DIR_C[2], dir));
        }
        if (bsOn("branch") && info.branch) {
          parts.push(tc(DIR_C[0], DIR_C[1], DIR_C[2], `(${info.branch})`));
        }
        if (bsOn("diffStats") && (info.diffAdded > 0 || info.diffRemoved > 0)) {
          const added = info.diffAdded > 0 ? tc(0, 180, 80, `+${info.diffAdded}`) : "";
          const removed = info.diffRemoved > 0 ? tc(180, 0, 0, `-${info.diffRemoved}`) : "";
          const sep = added && removed ? " " : "";
          parts.push(added + sep + removed);
        }
        if (parts.length) {
          botLabel = parts.join(paint(" ") + paint("─".repeat(2)) + paint(" "));
          botLen = VW(botLabel);
        }
      }
    if (Date.now() < this.ctrlCWarnUntil) {
      const warn = "press ctrl+c again to exit";
      const [r, g, b] = P.prompt;
      botLabel = `\x1b[3m\x1b[38;2;${r};${g};${b}m${warn}${RST}`; // \x1b[3m = italic
      botLen = VW(warn);
    }

    const bodyLines = renderLines.map((line, i) => {
      if (i === botI) return this.corners("╰", "╯", width, botLabel, botLen);
      let out = line;
      const left = i === promptI && cfg.promptChar ? PROMPT : V; // ❯ on first row
      if (out.startsWith(" ")) out = left + out.slice(1);
      if (out.endsWith(" ")) out = out.slice(0, -1) + V;
      return out;
    });
    const topBorder = leftScrollLabel
      ? this.cornersLR("╭", "╮", width, leftScrollLabel, leftScrollLen, topLabel, topLen)
      : this.corners("╭", "╮", width, topLabel, topLen);
    return [topBorder, ...bodyLines];
  }
}

// Cached border data (git branch, cache hits, diff stats) — updated periodically
let borderCache = { branch: "", cacheHits: 0, diffAdded: 0, diffRemoved: 0 };
let borderCacheTimer: NodeJS.Timeout | null = null;
let borderCtx: any = undefined; // active ctx for border cache updates

// Update cached border data (uses borderCtx, not captured ctx)
function updateBorderCache(): void {
  const ctx = borderCtx;
  if (!ctx) return;
  const cwd = ctx.sessionManager?.getCwd?.() ?? ctx.cwd ?? "";
  try {
    const { execSync } = require("child_process");
    // Git branch
    try {
      // ponytail: execSync inherits stderr by default — git CRLF/fatal messages would
      // otherwise paint raw onto the TTY every tick, over the fullscreen UI.
      borderCache.branch = execSync("git branch --show-current", { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || "";
    } catch {
      borderCache.branch = "";
    }
    // Diff stats (staged + unstaged)
    try {
      const diff = execSync("git diff --numstat", { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
      let added = 0, removed = 0;
      if (diff) {
        for (const line of diff.split("\n")) {
          const [a, r] = line.split("\t");
          if (a !== "-" && r !== "-") {
            added += parseInt(a, 10) || 0;
            removed += parseInt(r, 10) || 0;
          }
        }
      }
      borderCache.diffAdded = added;
      borderCache.diffRemoved = removed;
    } catch {
      borderCache.diffAdded = 0;
      borderCache.diffRemoved = 0;
    }
  } catch {
    /* non-git dir, ignore */
  }
  // Cache hits from message history (use ctx, not borderCtx — already captured above)
  try {
    const branch = borderCtx?.sessionManager?.getBranch?.();
    if (branch) {
      let cacheRead = 0;
      for (const entry of branch) {
        if (entry.usage?.cacheRead) cacheRead += entry.usage.cacheRead;
      }
      borderCache.cacheHits = cacheRead;
    }
  } catch {
    borderCache.cacheHits = 0;
  }
}

// Editor factory bound to a ctx, feeding the box live model / context% / cwd.
function makeEditor(ctx: any) {
  return (tui: any, theme: any, keybindings: any) => {
    const ed = new EmberEditor(tui, theme, keybindings);
    (ed as any)._ctx = ctx;
    borderCtx = ctx; // track active ctx for border cache updates
    // Start periodic cache updates
    if (!borderCacheTimer) {
      updateBorderCache();
      borderCacheTimer = setInterval(updateBorderCache, 3000);
    }
    ed.getInfo = () => {
      const u = ctx.getContextUsage?.();
      const cwd = ctx.sessionManager?.getCwd?.() ?? ctx.cwd ?? "";
      const tl = ctx.thinkingLevel;
      return {
        model: ctx.model?.id || "no-model",
        // show effort only when the model supports thinking and it's turned on
        thinkingLevel: ctx.model?.reasoning && tl && tl !== "off" ? tl : undefined,
        percent: u && u.percent != null ? u.percent : 0,
        contextWindow: u?.contextWindow ?? 0,
        dir: homeRel(cwd),
        branch: borderCache.branch,
        cacheHits: borderCache.cacheHits,
        diffAdded: borderCache.diffAdded,
        diffRemoved: borderCache.diffRemoved,
      };
    };
    return ed;
  };
}

// Re-apply toggles that are wired once (editor swap). prompt/status read cfg
// live, so re-registering the editor is enough to refresh them on screen.
function applyEditor(ctx: any): void {
  ctx.ui.setEditorComponent(cfg.roundedBox ? makeEditor(ctx) : undefined);
}

// --- custom startup header -------------------------------------------------
// Replaces pi's built-in logo+hints block (interactive-mode setExtensionHeader).
// Layout: big "PI" block letters (vertical palette gradient) on the left, the
// same info pi shows today (version, key hints, onboarding) on the right, and a
// palette-colored divider underneath. Reads P + the live theme on every render,
// so palette switches recolor it for free (setTheme invalidates -> re-render).
const LOGO = [
  "██████╗ ██╗",
  "██╔══██╗██║",
  "██████╔╝██║",
  "██╔═══╝ ██║",
  "██║     ██║",
  "╚═╝     ╚═╝",
];
const LOGOW = 11; // visible width of every LOGO row
const HDR_GAP = 3; // columns between logo and info
const HDR_SWEEP_MS = 40; // sweep animation tick
const HDR_SWEEP_ROWS = 3; // row half-width for vertical sweep
const HDR_SWEEP_TICK = 0.4; // rows advanced per tick (slower traversal)

// ponytail: hint text is hardcoded to pi's defaults; drifts if the user rebinds
// keys. It's cosmetic — the real keybindings still work. Edit here if needed.
const HDR_HINTS = "escape/ctrl+c interrupt · ctrl+c/ctrl+d clear/exit · / commands · ! bash · ctrl+o more";
const HDR_ONB1 = "Press ctrl+o to show full startup help and loaded resources.";
const HDR_ONB2 = "Pi can explain its own features and look up its docs. Ask it how to use or extend Pi.";

// right-truncate a plain string to max chars, … when cut
const clip = (s: string, max: number): string =>
  max <= 0 ? "" : s.length <= max ? s : max <= 1 ? s.slice(0, max) : s.slice(0, max - 1) + "…";

function makeHeader(ctx: any) {
  return (_tui: any, theme: any) => ({
    invalidate() {},
    dispose() {},
    render(width: number): string[] {
      const rows = LOGO.length;
      // vertical gradient: bright crest at top -> ember base at bottom
      // overlay a horizontal sweep: a hot band traveling top→bottom,
      // making each logo row glow left→right as the sweep column passes.
      const logo = LOGO.map((ln, rowI) => {
        let chars = "";
        for (let colI = 0; colI < ln.length; colI++) {
          if (ln[colI] !== "█") { chars += ln[colI]; continue; }
          // vertical sweep: brightness based on row distance to sweep line
          const dist = rowI - sweepPhase;
          const t = Math.max(0, 1 - Math.abs(dist) / HDR_SWEEP_ROWS);
          // vertical gradient base, brightened by sweep proximity
          const vertT = rows > 1 ? rowI / (rows - 1) : 0;
          const br = lerp(P.crest[0], P.base[0], vertT);
          const bg = lerp(P.crest[1], P.base[1], vertT);
          const bb = lerp(P.crest[2], P.base[2], vertT);
          chars += tc(
            lerp(br, 255, t),
            lerp(bg, 255, t),
            lerp(bb, 255, t),
            ln[colI],
          );
        }
        return chars;
      });

      // info lines keyed to logo rows (sparse: blanks where undefined)
      const ver = piVersion();
      const info: ({ t: string; c: (s: string) => string } | undefined)[] = [];
      info[0] = { t: ver ? `pi v${ver}` : "pi", c: (s) => theme.bold(theme.fg("accent", s)) };
      info[2] = { t: HDR_HINTS, c: (s) => theme.fg("muted", s) };
      info[3] = { t: HDR_ONB1, c: (s) => theme.fg("dim", s) };
      info[5] = { t: HDR_ONB2, c: (s) => theme.fg("dim", s) };

      const avail = width - LOGOW - HDR_GAP;
      const out: string[] = [];
      for (let i = 0; i < rows; i++) {
        const slot = info[i];
        const right = slot ? slot.c(clip(slot.t, avail)) : "";
        out.push(logo[i] + " ".repeat(HDR_GAP) + right);
      }

      // palette-colored divider
      const d: RGB = [
        Math.round(P.base[0] * 0.5),
        Math.round(P.base[1] * 0.5),
        Math.round(P.base[2] * 0.5),
      ];
      out.push(tc(d[0], d[1], d[2], "─".repeat(Math.max(0, width))));
      return out;
    },
  });
}

function startHeaderSweep(ctx: any): void {
  const factory = makeHeader(ctx);
  // Start the crest fully off the top edge (row 0 must read as dark on frame 1)
  // and run only until it clears the bottom edge -- no idle tail once it's gone.
  const start = -HDR_SWEEP_ROWS;
  const end = LOGO.length - 1 + HDR_SWEEP_ROWS;
  const totalTicks = Math.ceil((end - start) / HDR_SWEEP_TICK) + 1;
  sweepPhase = start;
  if (sweepTimer) clearInterval(sweepTimer);
  let ticks = 0;
  sweepTimer = setInterval(() => {
    sweepPhase += HDR_SWEEP_TICK;
    try { ctx.ui.setHeader(factory); } catch { /* disposed */ }
    if (++ticks >= totalTicks) {
      clearInterval(sweepTimer);
      sweepTimer = undefined;
      sweepPhase = end + HDR_SWEEP_ROWS; // past threshold -> plain gradient, no crest residue
      try { ctx.ui.setHeader(factory); } catch { /* disposed */ }
    }
  }, HDR_SWEEP_MS);
  ctx.ui.setHeader(factory); // initial render
}

function stopHeaderSweep(): void {
  if (sweepTimer) { clearInterval(sweepTimer); sweepTimer = undefined; }
}

function applyHeader(ctx: any): void {
  if (cfg.customHeader) {
    startHeaderSweep(ctx);
  } else {
    ctx.ui.setHeader?.(undefined);
    stopHeaderSweep();
  }
}

// --- ember thinking box (inline) -------------------------------------------
// We DON'T re-render thinking ourselves or touch the message — that would drop
// it from LLM context. Instead we monkeypatch the host's AssistantMessageComponent
// (the component that already renders the inline thinking block) so its thinking
// trace is drawn inside our rounded ember box. Live, in-place, context untouched.

const THINK_GREY: [number, number, number] = [120, 120, 120]; // done = muted

function fmtDur(ms: number): string {
  const s = Math.max(1, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

// Live AssistantMessageComponents, for recoloring history on palette change.
// Host components bake theme colors at updateContent time and aren't rebuilt by
// setTheme, so we re-run updateContent on each to repaint with the new palette.
// ponytail: strong Set leaks detached components; bounded by session msg count.
const liveMsgs = new Set<any>();
function rebuildLiveMessages(): void {
  for (const c of liveMsgs) {
    try {
      if (c.lastMessage) c.updateContent(c.lastMessage);
    } catch {
      /* detached/disposed component -> ignore */
    }
  }
}

// InteractiveMode singleton capture. We patch renderWidgets on the prototype
// so the very first call (during InteractiveMode.init()) stores the instance.
// This lets us call switchTuiMode("fullscreen") from the extension's session_start
// handler, using pi's native TuiAltScreen instead of manual alt-screen escapes.
let interactiveModeInstance: any = undefined;
let _immCaptured = false;
function captureInteractiveMode(): void {
  if (_immCaptured) return;
  _immCaptured = true;
  loadHost().then(({ tui }) => {
    const imMod: any = tui;
    // interactive-mode.js is not exported from pi-tui; deep-import it
    const { pathToFileURL } = require("node:url");
    const pkg = join(
      process.env.APPDATA || join(process.env.USERPROFILE || ".", "AppData", "Roaming"),
      "npm", "node_modules", "@earendil-works", "pi-coding-agent",
    );
    const url = (p: string) => pathToFileURL(join(pkg, p)).href;
    import(url("dist/modes/interactive/interactive-mode.js")).then((im: any) => {
      const origRenderWidgets = im.InteractiveMode.prototype.renderWidgets;
      im.InteractiveMode.prototype.renderWidgets = function (...args: any[]) {
        if (!interactiveModeInstance) interactiveModeInstance = this;
        return origRenderWidgets.apply(this, args);
      };
    }).catch(() => { /* deep import failed — non-fatal */ });
  }).catch(() => {});
}

// Memoized deep-import of the host's internals. The package `exports` map only
// exposes ".", so subpath imports must go by absolute file URL. Shared by the
// thinking patch and the palette picker (both need pi-tui + the theme proxy).
let host: { tui: any; T: any; themeMod: any; stackMod: any; syntMod: any } | undefined;
let footerContainerRef: any = undefined; // captured from ctx during session_start
let stackPatched = false;
async function loadHost(): Promise<{ tui: any; T: any; themeMod: any; stackMod: any }> {
  if (host) return host;
  const { pathToFileURL } = await import("node:url");
  const pkg = join(
    process.env.APPDATA || join(process.env.USERPROFILE || ".", "AppData", "Roaming"),
    "npm", "node_modules", "@earendil-works", "pi-coding-agent",
  );
  const url = (p: string) => pathToFileURL(join(pkg, p)).href;
  const tui: any = await import(url("node_modules/@earendil-works/pi-tui/dist/index.js"));
  const stackMod: any = await import(url("node_modules/@earendil-works/pi-tui/dist/components/stack.js"));
  const themeMod: any = await import(url("dist/modes/interactive/theme/theme.js"));
  const syntMod: any = await import(url("dist/utils/syntax-highlight.js"));
  VW = tui.visibleWidth;
  host = { tui, T: themeMod.theme, themeMod, stackMod, syntMod };

  // Patch allocateStackSizes once: when roundedBox is on and footer renders 0 lines,
  // override minSize for the footerContainer entry so it collapses to 0 instead
  // of the host's minSize: 1 (which leaves a blank line).
  if (!stackPatched) {
    stackPatched = true;
    try {
      const origAllocate = stackMod.allocateStackSizes;
      stackMod.allocateStackSizes = function (...args: any[]) {
        const [entries, intrinsicSizes] = args as [any[], number[]];
        if (cfg.roundedBox && footerContainerRef) {
          for (const entry of entries) {
            if (entry.component === footerContainerRef) {
              const prev = entry.minSize;
              entry.minSize = 0;
              const result = origAllocate(...args);
              entry.minSize = prev;
              return result;
            }
          }
        }
        return origAllocate(...args);
      };
    } catch {
      /* already patched or non-configurable — ignore */
    }
  }

  return host;
}

// Patch the host's assistant-message renderer once. Replaces only the thinking
// branch of updateContent; text, tool calls, abort/error paths stay
// byte-for-byte the host's own.
let patched = false;
async function patchThinking(): Promise<void> {
  if (patched) return;
  const { pathToFileURL } = await import("node:url");
  const pkg = join(
    process.env.APPDATA || join(process.env.USERPROFILE || ".", "AppData", "Roaming"),
    "npm", "node_modules", "@earendil-works", "pi-coding-agent",
  );
  const url = (p: string) => pathToFileURL(join(pkg, p)).href;
  const am: any = await import(url("dist/modes/interactive/components/assistant-message.js"));
  const { tui, T } = await loadHost();
  const { Spacer, Text, Markdown, Container } = tui;

  // Normalize indented code fences: some LLMs emit "   ```go" which certain
  // Markdown parsers silently reject (treating as literal text). Strip leading
  // whitespace ONLY from fence markers (opening/closing ``` lines), preserve
  // indentation inside the block body.
  function normalizeFences(text: string): string {
    // Normalize line endings first (\r\n breaks fence detection)
    text = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    // Convert fenced code blocks to indented (4-space) blocks.
    // Fallback for Markdown renderers that don't support fenced syntax.
    const out: string[] = [];
    let inFence = false;
    let fenceIndent = "";
    for (const line of text.split("\n")) {
      const leadingMatch = line.match(/^(\s*)/);
      const leading = leadingMatch ? leadingMatch[1] : "";
      const trimmed = line.trimStart();
      if (trimmed.startsWith("```") && trimmed.match(/^````*\s*\w*\s*$/)) {
        if (!inFence) {
          inFence = true;
          fenceIndent = leading; // remember fence indent
          continue; // skip opening fence
        } else {
          inFence = false;
          fenceIndent = "";
          continue; // skip closing fence
        }
      } else if (inFence) {
        // Strip the fence indent from body lines (LLMs often indent body with fence)
        let bodyLine = line;
        if (fenceIndent && bodyLine.startsWith(fenceIndent)) {
          bodyLine = bodyLine.slice(fenceIndent.length);
        }
        out.push("    " + bodyLine); // 4-space indent = code block in standard markdown
      } else {
        out.push(line);
      }
    }
    return out.join("\n");
  }

  // Width-aware ember box: Container subclass that renders a rounded border
  // around a Markdown child (so code blocks, headings, etc. render properly).
  // Timing lives on the OWNING component (one component = one assistant
  // message, stable across deltas) — stream events hand out fresh message
  // objects every delta, so keying timing by message identity never matched.
  class ThinkBox extends Container {
    text: string;
    comp: any;
    private _mdTheme: any;
    constructor(text: string, comp: any, mdTheme: any) {
      super();
      this.text = text;
      this.comp = comp;
      this._mdTheme = mdTheme;
      this.addChild(new Markdown(text, 0, 0, mdTheme));
    }
    render(width: number): string[] {
      const t0 = this.comp._thinkStart;
      const t1 = this.comp._thinkEnd;
      const active = t0 != null && t1 == null;
      const ms = t0 ? (t1 ?? Date.now()) - t0 : 0; // live elapsed while active
      const c = active ? P.base : THINK_GREY;
      const b = (s: string) => tc(c[0], c[1], c[2], s);

      // Render children at reduced width (border adds │ + space + space + │ = 4)
      const innerW = Math.max(2, width - 4);
      const childLines: string[] = [];
      for (const child of this.children) {
        childLines.push(...(child as any).render(innerW));
      }
      const padded = childLines.map((line: string) => b("│") + " " + line + " " + b("│"));

      // Label bottom-right: stays visible while the box grows upward from it.
      const title = !t0
        ? " thought "
        : active
          ? ` thinking for ${fmtDur(ms)} `
          : ` thought for ${fmtDur(ms)} `;
      const top = b("╭" + "─".repeat(Math.max(0, width - 2)) + "╮");
      const bot = b("╰" + "─".repeat(Math.max(0, width - 4 - VW(title))) + title + "──╯");
      return [top, ...padded, bot];
    }
  }

  // Reimplemented updateContent: identical to the host's except the non-hidden
  // thinking branch, which uses ThinkBox when cfg.thinkBox is on.
  am.AssistantMessageComponent.prototype.updateContent = function (message: any) {
    this.lastMessage = message;
    liveMsgs.add(this); // track for palette-change recolor
    // Reasoning timing, keyed on this component (stable across the message's
    // delta updates). start: first update carrying non-empty thinking.
    // end: message finalized, or content after the thinking block appeared.
    // NOTE: in-flight messages have stopReason === "pending" (every pi-ai
    // provider), NOT null — null/undefined only on reloaded history messages.
    const live = message.stopReason == null || message.stopReason === "pending";
    const thinkIdx = message.content.findIndex((c: any) => c.type === "thinking" && c.thinking?.trim());
    // Only start the clock while the message is still live — a finalized
    // (reloaded/history) message has no recoverable timing, shows " thought ".
    if (thinkIdx >= 0 && !this._thinkStart && live) this._thinkStart = Date.now();
    const contentAfterThink = thinkIdx >= 0 &&
      message.content.slice(thinkIdx + 1).some(
        (c: any) => (c.type === "text" && c.text?.trim()) || c.type === "toolCall",
      );
    if (this._thinkStart && !this._thinkEnd && (!live || contentAfterThink)) {
      this._thinkEnd = Date.now();
    }
    this.contentContainer.clear();
    const visible = (c: any) =>
      (c.type === "text" && c.text.trim()) || (c.type === "thinking" && c.thinking.trim());
    if (message.content.some(visible)) this.contentContainer.addChild(new Spacer(1));
    for (let i = 0; i < message.content.length; i++) {
      const content = message.content[i];
      if (content.type === "text" && content.text.trim()) {
        this.contentContainer.addChild(
          new Markdown(normalizeFences(content.text.trim()), 1, 0, this.markdownTheme),
        );
      } else if (content.type === "thinking" && content.thinking.trim()) {
        const after = message.content.slice(i + 1).some(visible);
        const thinkingText = normalizeFences(content.thinking.trim());
        if (this.hideThinkingBlock || cfg.collapseThinking) {
          this.contentContainer.addChild(
            new Text(T.italic(T.fg("thinkingText", this.hiddenThinkingLabel)), 1, 0),
          );
        } else if (cfg.thinkBox) {
          this.contentContainer.addChild(new ThinkBox(thinkingText, this, this.markdownTheme));
        } else {
          this.contentContainer.addChild(
            new Markdown(thinkingText, 1, 0, this.markdownTheme, {
              color: (t: string) => T.fg("thinkingText", t),
              italic: true,
            }),
          );
        }
        if (after) this.contentContainer.addChild(new Spacer(1));
      }
    }
    const hasToolCalls = message.content.some((c: any) => c.type === "toolCall");
    this.hasToolCalls = hasToolCalls;
    if (!hasToolCalls) {
      if (message.stopReason === "aborted") {
        const msg =
          message.errorMessage && message.errorMessage !== "Request was aborted"
            ? message.errorMessage
            : "Operation aborted";
        this.contentContainer.addChild(new Spacer(1));
        this.contentContainer.addChild(new Text(T.fg("error", msg), 1, 0));
      } else if (message.stopReason === "error") {
        this.contentContainer.addChild(new Spacer(1));
        this.contentContainer.addChild(
          new Text(T.fg("error", `Error: ${message.errorMessage || "Unknown error"}`), 1, 0),
        );
      }
    }
  };
  patched = true;
}

// Patch the package-update notification once. The host bakes its body text with
// theme.fg() at creation (startup = ember), so it never recolors on palette
// change while everything around it does. We swap the baked Text for a live
// component that re-reads the theme proxy each render. Borders already use a
// live color fn, so we keep them. ponytail: no re-wrap — these lines are short;
// only fixing package updates (the line the user hit), not the version banner.
let patchedNotif = false;
async function patchNotifications(): Promise<void> {
  if (patchedNotif) return;
  patchedNotif = true;
  const { pathToFileURL } = await import("node:url");
  const pkg = join(
    process.env.APPDATA || join(process.env.USERPROFILE || ".", "AppData", "Roaming"),
    "npm", "node_modules", "@earendil-works", "pi-coding-agent",
  );
  const url = (p: string) => pathToFileURL(join(pkg, p)).href;
  const im: any = await import(url("dist/modes/interactive/interactive-mode.js"));
  const db: any = await import(url("dist/modes/interactive/components/dynamic-border.js"));
  const { tui, T } = await loadHost();
  const { Spacer } = tui;
  const { DynamicBorder } = db;

  // Re-reads T per render -> recolors with the active palette's theme.
  class LiveText {
    fn: () => string;
    constructor(fn: () => string) {
      this.fn = fn;
    }
    invalidate(): void {}
    dispose(): void {}
    render(_width: number): string[] {
      return this.fn().split("\n").map((l) => " " + l); // paddingX=1, matches host
    }
  }

  // Hide the Context / Extensions / Themes startup info block.
  // User can still see it via ctrl+o (different code path).
  im.InteractiveMode.prototype.showLoadedResources = function (_options?: any) {
    this.loadedResourcesContainer?.clear();
  };

  im.InteractiveMode.prototype.showNewVersionNotification = function (release: any) {
    // Host bakes "warning" (amber in every palette) into a one-shot Text. Make it
    // live + accent-tinted so it follows the active palette like the package box.
    const changelogUrl = "https://pi.dev/changelog";
    const body = () => {
      const action = T.fg("accent", `pi update`);
      const instruction = T.fg("muted", `New version ${release.version} is available. Run `) + action;
      const link = T.fg("accent", changelogUrl);
      const changelogLine = T.fg("muted", "Changelog: ") + link;
      return `${T.bold(T.fg("accent", "Update Available"))}\n${instruction}\n${changelogLine}`;
    };
    this.chatContainer.addChild(new Spacer(1));
    this.chatContainer.addChild(new DynamicBorder((t: string) => T.fg("accent", t)));
    this.chatContainer.addChild(new LiveText(body));
    const note = release.note?.trim();
    if (note) {
      this.chatContainer.addChild(new Spacer(1));
      this.chatContainer.addChild(new LiveText(() => T.fg("muted", note)));
      this.chatContainer.addChild(new Spacer(1));
    }
    this.chatContainer.addChild(new DynamicBorder((t: string) => T.fg("accent", t)));
    this.ui.requestRender();
  };

  im.InteractiveMode.prototype.showPackageUpdateNotification = function (packages: string[]) {
    // Host styles this box with "warning" (amber in every palette). Repaint the
    // title + borders with palette "accent" so it follows the active palette.
    const body = () => {
      const action = T.fg("accent", `pi update --extensions`);
      const instruction = T.fg("muted", "Package updates are available. Run ") + action;
      const lines = packages.map((p) => `- ${p}`).join("\n");
      return `${T.bold(T.fg("accent", "Package Updates Available"))}\n${instruction}\n${T.fg("muted", "Packages:")}\n${lines}`;
    };
    this.chatContainer.addChild(new Spacer(1));
    this.chatContainer.addChild(new DynamicBorder((t: string) => T.fg("accent", t)));
    this.chatContainer.addChild(new LiveText(body));
    this.chatContainer.addChild(new DynamicBorder((t: string) => T.fg("accent", t)));
    this.ui.requestRender();
  };
}

// Signature-based language detection for UNLABELED fences. hljs v10's
// highlightAuto misidentifies prose (English sentences come back "mipsasm")
// and exposes no relevance score, so use explicit signatures for the
// languages LLMs actually emit. First match wins; no match -> plain color.
// ponytail: a wrong guess only costs slightly-off colors, never a crash.
function detectLang(src: string): string | undefined {
  const t = src.trim();
  const head = src.slice(0, 2000); // signatures live near the top
  if (t.startsWith("{") || t.startsWith("[")) {
    try {
      JSON.parse(t);
      return "json"; // exact check, no false positives
    } catch {
      /* not json */
    }
  }
  if (/<\?xml/.test(head)) return "xml";
  if (/<\?php/.test(head)) return "php";
  if (/^#!.*\bpython/.test(head)) return "python"; // covers /usr/bin/python3 and env python3
  if (/^#!\s*\S*(node|deno|bun)\b/.test(head)) return "javascript";
  if (/^#!/.test(head)) return "bash";
  if (/#\s*include\s*</.test(head)) return "cpp";
  // java BEFORE go: java's "package a.b;" would match go's bare "package x"
  if (/^\s*package\s+[\w.]+;/m.test(head) || /\bpublic\s+(static\s+)?(void|class|final|int|String|boolean)\b/.test(head))
    return "java";
  if (/^\s{0,3}(package|func)\s+\w+/m.test(head)) return "go";
  if (/\bfn\s+\w+\s*\(/.test(head) || /^\s*use\s+[\w:]+;/.test(head)) return "rust";
  if (/\bnamespace\s+\w+/.test(head) || /\busing\s+System[.;]/.test(head)) return "csharp";
  if (/\bdef\s+\w+\s*[\(:]/.test(head) || /^\s{0,3}from\s+[\w.]+\s+import\b/m.test(head)) return "python";
  if (/^\s*(def|class)\s+[\w:]+(\s*\||\s*)$/m.test(head) && /\bend\b/m.test(head)) return "ruby";
  if (/^\s*(SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM|CREATE\s+(TABLE|VIEW|INDEX))\b/im.test(head)) return "sql";
  if (/^\$\s+\S/m.test(head) || /\b(sudo|apt-get|pip3?|brew|cargo|chmod)\s+\w+/m.test(head)) return "bash";
  if (/<(!DOCTYPE\s+html|html|head|body|div|span|meta|link|script|table|ul|ol|li|h[1-6])\b/i.test(head)) return "html";
  if (/<\w+[^>]*>/.test(head)) return "xml";
  if (
    /\binterface\s+\w+/.test(head) ||
    /\btype\s+\w+\s*=[^{]/.test(head) ||
    /:\s*(string|number|boolean|void|never|unknown)\b/.test(head)
  )
    return "typescript";
  if (
    /\b(const|let|var)\s+\w+\s*=[^=]/.test(head) ||
    /\bfunction\s+\w+\s*\(/.test(head) ||
    /=>\s*{/.test(head) ||
    /^\s*import\s+['"]|^\s*export\s+(default|const|function|class)/m.test(head)
  )
    return "javascript";
  // yaml last: "key: value" lines are the weakest signature (object literals
  // etc. must be claimed by the rules above first)
  if ((head.match(/^[\t ]*[\w.-]+:/gm) || []).length >= 2 && !/[;{}=]/.test(head)) return "yaml";
  return undefined;
}

// The host's Markdown component hardcodes literal ``` fence lines for code
// blocks (only color/indent are themeable). Replace the "code" token branch
// with a rounded box matching the extension's visual language.
let patchedCodeBlocks = false;
async function patchCodeBlocks(): Promise<void> {
  if (patchedCodeBlocks) return;
  patchedCodeBlocks = true;
  const { tui, syntMod } = await loadHost();
  const MD = tui.Markdown;
  const orig = MD.prototype.renderToken;
  MD.prototype.renderToken = function (token: any, width: number, nextTokenType: string | undefined, styleContext: any) {
    if (token?.type !== "code") return orig.call(this, token, width, nextTokenType, styleContext);
    const w = width; // contentWidth from render()
    if (w < 10) return orig.call(this, token, width, nextTokenType, styleContext); // too narrow for a box
    const th = this.theme;
    const src: string = token.text ?? "";
    // Explicit fence lang wins; only unlabeled fences get detected.
    const lang: string | undefined = token.lang
      ? syntMod.supportsLanguage(token.lang) || undefined
      : detectLang(src);
    let body: string[] = th.highlightCode
      ? th.highlightCode(src, lang)
      : src.split("\n").map((l: string) => th.codeBlock(l));
    if (body.length && body[body.length - 1] === "") body.pop(); // trailing newline guard
    body = body.flatMap((l) => (tui.visibleWidth(l) <= w - 4 ? [l] : tui.wrapTextWithAnsi(l, w - 4)));
    const border = (s: string) => th.codeBlockBorder(s);
    const labelLang = token.lang ?? lang; // detected lang shows in the border too
    const label = labelLang ? ` ${labelLang} ` : "";
    const L = tui.visibleWidth(label);
    if (w - 3 - L < 1) return orig.call(this, token, width, nextTokenType, styleContext); // label too long
    return [
      border("╭─" + label + "─".repeat(w - 3 - L) + "╮"),
      ...body.map((l) => border("│ ") + l + " ".repeat(Math.max(0, w - 4 - tui.visibleWidth(l))) + border(" │")),
      border("╰" + "─".repeat(w - 2) + "╯"),
      // mirror host spacing: blank line after block unless a space token follows
      ...(nextTokenType && nextTokenType !== "space" ? [""] : []),
    ];
  };
}

// ---- Mouse: click-to-place-cursor + right-click paste in the chat input ---
// pi's TuiAltScreen consumes every mouse event itself: left clicks become
// screen text-selection, wheel scrolls, right click (win32) pastes ANYWHERE
// (handleRightClickPaste ignores x/y). The editor component never sees mouse
// input, so there is no built-in way to click the input box to move the
// cursor. We intercept both in the TuiAltScreen handlers:
//  - left release over the editor box that was a plain click (no drag)
//    -> translate (x,y) to (cursorLine, cursorCol) with the editor's OWN
//    layout primitives (render/layoutText/buildVisualLineMap/segment) so
//    wrapping, wide chars and paste markers match the on-screen text, then
//    set the cursor. Press/drag stay native so highlight-to-copy in the
//    input still works (host copies the selection on release; a zero-length
//    selection copies nothing).
//  - right press inside the editor box -> the host's clipboard paste, with
//    the editor focused first so the paste lands in the input even if focus
//    drifted. Outside the box: false (every downstream handler ignores the
//    right button, so the click is a clean no-op).
// Editor detection is by constructor name, NOT instanceof: the extension's bare
// import resolves to %USERPROFILE%\\node_modules (a SECOND pi-coding-agent copy),
// while the running host uses the %APPDATA%\\npm copy — cross-copy instanceof
// would never match the host's editor.

// The layout box tree only descends through VStack/ScrollView nodes — a
// Container (which wraps the editor slot) is a LEAF box (children: []) that
// renders its whole subtree at once. So to find the editor we probe each leaf
// box's COMPONENT subtree: if it contains an editor, recompute child rects
// from rendered row counts (Container.render concatenates children's rows
// with no gaps, so offsets are cumulative heights).
function hasEditorDescendant(comp: any): boolean {
  if (!comp) return false;
  if (/Editor$/.test(comp.constructor?.name ?? "")) return true; // EmberEditor, host CustomEditor/Editor — any copy
  const kids = Array.isArray(comp.children) ? comp.children : [];
  for (const k of kids) if (hasEditorDescendant(k)) return true;
  return false;
}

// Hit-test (x, y) against a component subtree rendered at rect.x/y/width.
function probeEditorAt(comp: any, x: number, y: number, rect: { x: number; y: number; width: number }, depth = 0): { comp: any; rect: any } | undefined {
  if (!comp || depth > 4) return undefined;
  if (/Editor$/.test(comp.constructor?.name ?? "")) {
    if (x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height) return { comp, rect };
    return undefined;
  }
  const kids = Array.isArray(comp.children) ? comp.children : [];
  if (!kids.length) return undefined;
  let yOff = rect.y;
  for (const kid of kids) {
    let h = 0;
    try { h = kid.render(rect.width).length; } catch { h = 0; }
    const hit = probeEditorAt(kid, x, y, { x: rect.x, y: yOff, width: rect.width, height: h }, depth + 1);
    if (hit) return hit;
    yOff += h;
  }
  return undefined;
}

// Find the editor under (x, y) -> { comp, rect } (screen coords) | undefined.
function findEditorBoxAt(tui: any, x: number, y: number): { comp: any; rect: any } | undefined {
  let found: { comp: any; rect: any } | undefined;
  const visit = (box: any) => {
    if (found || !box) return;
    const r = box.rect;
    if (r && hasEditorDescendant(box.component)) {
      // box.lineOffset shifts painted rows down when the box is height-clamped;
      // lift the virtual origin so screen coords line up with child rows.
      const lo = box.lineOffset ?? 0;
      found = probeEditorAt(box.component, x, y, { x: r.x, y: r.y - lo, width: r.width });
    }
    for (const c of box.children || []) visit(c);
  };
  const root = tui?.currentLayout?.root;
  if (root) visit(root);
  return found;
}

// Border-ish rows of the editor box (plain ── lines, rounded corners, scroll
// indicators). Content rows are the contiguous run after row 0 that matches
// none of these; rows after the bottom border are the autocomplete list.
// Content rows are always safe from false positives: rounded mode wraps them
// in │/❯, plain mode indents them by paddingX ≥ 2 spaces.
const ED_BORDER_RE = /^─+$|^╰.*╯$|^─+\s*[↑↓]\s*\d+\s+more/;
const edRowIsBorder = (s: string): boolean => ED_BORDER_RE.test(stripAnsi(s));

// Visible column -> string offset in a plain text line, using the editor's own
// grapheme segmentation (the same input wordWrapLine gets, so it matches the
// wrapping exactly). A click on either half of a wide char lands before it.
function colToOffset(ed: any, text: string, col: number): number {
  let w = 0;
  let off = 0;
  for (const seg of ed.segment(text, "grapheme")) {
    const s: string = seg.segment;
    const gw = VW(s);
    if (col === w) return off;
    if (col < w + gw) return gw === 1 ? off + s.length : off;
    w += gw;
    off += s.length;
  }
  return off;
}

// Box-local click -> { kind: "cursor", line, col } | { kind: "border" } |
// { kind: "pass" } (autocomplete row: keep host behavior) | null (bail: let
// the host handle it). Re-renders the editor at its box width for the exact
// on-screen rows; render() only adjusts scrollOffset to keep the cursor
// visible, which is a no-op right after a real render.
function editorClickTarget(ed: any, rect: { x: number; y: number; width: number }, x: number, y: number): any {
  const width = rect?.width;
  if (!width) return null;
  let rows: string[];
  try {
    rows = ed.render(width);
  } catch {
    return null;
  }
  const r = y - rect.y;
  const c = x - rect.x;
  if (r < 0 || r >= rows.length || c < 0) return null; // out of box -> host
  if (r === 0) return { kind: "border" }; // top border / scroll indicator
  // Find the bottom border: first border row after the content run starts.
  let k = 1;
  while (k < rows.length && !edRowIsBorder(rows[k])) k++;
  if (r >= k) {
    return r === k ? { kind: "border" } : { kind: "pass" }; // bottom border / autocomplete list
  }
  const layoutIdx = (ed.scrollOffset ?? 0) + (r - 1);
  const padX = Math.min(ed.paddingX ?? 0, Math.max(0, Math.floor((width - 1) / 2)));
  const W = ed.lastWidth ?? Math.max(1, width - 2 * padX);
  const ll = ed.layoutText(W)[layoutIdx];
  if (!ll) return { kind: "border" }; // ponytail: layout drift -> no-op
  const strOffset = colToOffset(ed, ll.text, Math.max(0, c - padX));
  const vl = ed.buildVisualLineMap(W)[layoutIdx];
  if (!vl) return { kind: "cursor", line: 0, col: 0 };
  const lineLen = (ed.state.lines[vl.logicalLine] || "").length;
  return {
    kind: "cursor",
    line: vl.logicalLine,
    col: Math.max(0, Math.min(vl.startCol + strOffset, lineLen)),
  };
}

let patchedEditorMouse = false;
async function patchEditorMouse(): Promise<void> {
  if (patchedEditorMouse) return;
  patchedEditorMouse = true;
  try {
    const { tui } = await loadHost();
    const proto = tui.TuiAltScreen?.prototype;
    if (!proto) return;

    // Left release over the editor that was a plain click (no drag) -> move
    // the cursor. Press/drag/release are otherwise fully native: the host
    // sets its selection anchor on press, extends it on drag, and copies to
    // the clipboard on release — so highlight-to-copy in the input still
    // works (a zero-length selection copies nothing, verified in
    // getSelectionBounds: anchor==focus -> undefined -> early return).
    const origSelect = proto.handleSelectionMouseEvent;
    if (typeof origSelect === "function") {
      proto.handleSelectionMouseEvent = function (event: any) {
        try {
          if (event && event.release && (event.button & 3) === 0 && !this.hasOverlay?.()) {
            const wasPress = !!this.selectionPressActive;
            const dragged = !!this.selectionDragged;
            const out = origSelect.call(this, event); // finalize native selection (copies if dragged)
            // A true click: press+release without drag, and the host ended
            // with a zero-length selection (covers press-elsewhere-release-here
            // edge: non-zero bounds -> skip).
            if (wasPress && !dragged && !this.getSelectionBounds?.()) {
              const box = findEditorBoxAt(this, event.x, event.y);
              if (box) {
                const t = editorClickTarget(box.comp, box.rect, event.x, event.y);
                if (t?.kind === "cursor") {
                  if (this.getFocusedComponent?.() !== box.comp) this.setFocus?.(box.comp);
                  box.comp.state.cursorLine = t.line;
                  box.comp.setCursorCol(t.col); // also clears sticky visual column
                  this.requestRender?.();
                }
                // border/pass -> no-op (host already no-op'd a zero-length selection)
              }
            }
            return out;
          }
          return origSelect.call(this, event);
        } catch {
          return false;
        }
      };
    }

    // Right press over the editor -> host clipboard paste (focus first so it
    // lands in the input). Outside the editor: no paste (the win32 shortcut is
    // otherwise screen-wide).
    const origRight = proto.handleRightClickPaste;
    if (typeof origRight === "function") {
      proto.handleRightClickPaste = function (event: any) {
        try {
          if (!event || event.release || event.button !== 2) return origRight.call(this, event);
          const box = findEditorBoxAt(this, event.x, event.y);
          if (!box) return false; // outside the editor -> clean no-op
          if (this.getFocusedComponent?.() !== box.comp) this.setFocus?.(box.comp);
          return origRight.call(this, event);
        } catch {
          return false;
        }
      };
    }
  } catch { /* host internals unavailable -> no mouse niceties */ }
}

// Live preview: swap brand RGB + pair the pi theme. setTheme triggers a full
// re-render so the visible transcript recolors. No editor swap here — the picker
// occupies the editor slot during selection, so touching it would clobber it.
function previewPalette(ctx: any, name: string): void {
  cfg.palette = name;
  applyPalette();
  ctx.ui.setTheme?.(P.theme); // activate new theme proxy (invalidates)
  rebuildLiveMessages(); // re-bake past messages with the now-current theme
  ctx.ui.setTheme?.(P.theme); // idempotent: force a render of the rebuilt children
}

// Commit: preview + refresh the editor component (safe once the picker closed).
function usePalette(ctx: any, name: string): void {
  previewPalette(ctx, name);
  applyEditor(ctx);
}

// Palette picker with LIVE hover preview. ctx.ui.select can't preview on
// highlight, so we drive pi-tui's SelectList directly via ctx.ui.custom
// (non-overlay, editor slot): onSelectionChange previews, Enter commits, Esc
// reverts to the starting palette.
async function pickPalette(ctx: any): Promise<void> {
  const { tui, themeMod } = await loadHost();
  const { SelectList } = tui;
  const names = Object.keys(PALETTES);
  const original = cfg.palette;
  const items = names.map((n) => ({
    value: n,
    label: n,
    description: n === original ? "current" : undefined,
  }));
  // Non-overlay: the component replaces the editor slot and gets keyboard focus
  // (showExtensionCustom calls setFocus on it), so a bare SelectList renders in
  // place and receives input. Overlay mode floats with no width -> misplaced.
  const chosen: string | undefined = await ctx.ui.custom(
    (_tui: any, _theme: any, _kb: any, done: (v: string | undefined) => void) => {
      const list = new SelectList(items, 8, themeMod.getSelectListTheme());
      list.setSelectedIndex(Math.max(0, names.indexOf(original)));
      list.onSelectionChange = (it: any) => previewPalette(ctx, it.value); // live preview
      list.onSelect = (it: any) => done(it.value);
      list.onCancel = () => done(undefined);
      return list;
    },
  );
  if (chosen && PALETTES[chosen]) {
    usePalette(ctx, chosen);
    saveCfg();
    ctx.ui.notify(`palette: ${chosen}`);
  } else {
    usePalette(ctx, original); // reverted -> restore starting palette
  }
}

// Pass-through component: renders a live preview line above a SelectList and
// forwards input to it. Lets the picker show what the hovered style looks like
// at the REAL ctx % (the editor border is not visible while a non-overlay
// picker occupies the editor slot).
class BarStylePreviewList {
  constructor(private list: any, private previewLine: () => string) {}
  render(width: number): string[] {
    return [this.previewLine(), ...this.list.render(width)];
  }
  handleInput(data: string): void {
    this.list.handleInput(data);
  }
  invalidate(): void {
    this.list.invalidate();
  }
  dispose(): void {
    this.list.dispose?.();
  }
}

// Bar-style picker with LIVE preview. Non-overlay: it takes the editor slot,
// exactly where the /status-bar menu just was. Hovering a style updates
// cfg.barStyle; the preview line (re-read every render pass) shows that style
// at the real ctx % in the real threshold color. Each row also carries a
// sample bar at 65% so every style is visible at a glance. Enter commits,
// Esc reverts the preview (the restored editor re-bakes its border from cfg).
async function pickBarStyle(ctx: any): Promise<void> {
  const { tui, themeMod } = await loadHost();
  const { SelectList } = tui;
  const original: BarStyle = BAR_STYLES.includes(cfg.barStyle as BarStyle) ? (cfg.barStyle as BarStyle) : "blocks";
  const items = BAR_STYLES.map((s) => {
    const g = barGlyphs(s, 0.65 * BAR_W); // sample bar at 65% + name
    return { value: s, label: `${g.fill}${g.track}  ${s}`, description: s === original ? "current" : undefined };
  });
  const previewLine = () => {
    const p = ctx.getContextUsage?.()?.percent ?? 0;
    const style: BarStyle = BAR_STYLES.includes(cfg.barStyle as BarStyle) ? (cfg.barStyle as BarStyle) : "blocks";
    const g = barGlyphs(style, (p / 100) * BAR_W);
    // live preview: hovered style at real ctx %, accent fill + grey track
    return `  ${barFill(p, g.fill)}${tc(DIR_C[0], DIR_C[1], DIR_C[2], g.track)}${DIM_PRE} ${Math.round(p)}% of context${RST}`;
  };
  const chosen: string | undefined = await ctx.ui.custom(
    (_tui: any, _theme: any, _kb: any, done: (v: string | undefined) => void) => {
      const list = new SelectList(items, 8, themeMod.getSelectListTheme());
      list.setSelectedIndex(Math.max(0, BAR_STYLES.indexOf(original)));
      list.onSelectionChange = (it: any) => { cfg.barStyle = it.value; }; // preview line reads it live
      list.onSelect = (it: any) => done(it.value);
      list.onCancel = () => done(undefined);
      return new BarStylePreviewList(list, previewLine);
    },
  );
  if (chosen && BAR_STYLES.includes(chosen as BarStyle)) {
    cfg.barStyle = chosen;
    saveCfg();
    ctx.ui.notify(`Bar style: ${chosen}`);
  } else {
    cfg.barStyle = original; // Esc -> revert preview
  }
}

// Toggle table drives both the menu and persistence.
const TOGGLES: { name: string; get: () => boolean; set: (v: boolean) => void; apply?: (ctx: any) => void }[] = [
  { name: "Rounded input box", get: () => cfg.roundedBox, set: (v) => (cfg.roundedBox = v) },
  { name: "❯ prompt char", get: () => cfg.promptChar, set: (v) => (cfg.promptChar = v) },
  { name: "Glowing working text", get: () => cfg.glowText, set: (v) => (cfg.glowText = v) },
  { name: "Sparkle spinner", get: () => cfg.sparkleSpinner, set: (v) => (cfg.sparkleSpinner = v) },
  { name: "Turn stats (elapsed/tokens)", get: () => cfg.turnStats, set: (v) => (cfg.turnStats = v) },
  { name: "Live thinking box", get: () => cfg.thinkBox, set: (v) => (cfg.thinkBox = v) },
  { name: "Collapse thinking", get: () => cfg.collapseThinking, set: (v) => (cfg.collapseThinking = v), apply: (ctx: any) => rebuildLiveMessages() },
  { name: "Custom header", get: () => cfg.customHeader, set: (v) => (cfg.customHeader = v) },
];

export default function (pi: ExtensionAPI) {
  loadCfg();
  applyPalette();
  captureInteractiveMode(); // patch InteractiveMode.prototype.renderWidgets before instance is created

  pi.on("session_start", (_e, ctx) => {
    if (ctx.mode !== "tui") return;
    // Capture footer container for allocateStackSizes patch (collapse to 0 when roundedBox).
    footerContainerRef = ctx.footerContainer;
    // Switch to pi's native fullscreen mode (TuiAltScreen) — replaces our manual
    // \x1b[?1049h / doRender patch with the built-in ScrollView, proper mouse
    // handling, cursor positioning, and differential rendering.
    if (interactiveModeInstance) {
      interactiveModeInstance.switchTuiMode("fullscreen");
      // Recolor scrollbar with palette base instead of theme.bg("scrollbarThumb") (muted).
      interactiveModeInstance.settingsManager?.setFullscreenScrollbar("auto");
      interactiveModeInstance.transcriptScrollView.scrollbarStyle = (text: string) =>
        `\x1b[48;2;${P.base[0]};${P.base[1]};${P.base[2]}m${text}\x1b[49m`;
      // Boost scroll sensitivity (default = 1 line per wheel tick)
      (interactiveModeInstance.renderer as any).wheelScrollLines = 3;
    }
    ctx.ui.setTheme?.(P.theme); // pair the pi theme to the active palette
    applyEditor(ctx);
    applyHeader(ctx); // swap pi's logo/hints for the PI banner
    // Defer async ops (loadHost imports, patching) to next tick so pi's initial
    // prompt renders faster — the dynamic imports are the biggest delay source.
    setTimeout(() => {
      patchThinking().catch((e) => {
        console.error("patchThinking failed:", e);
        appendFileSync(join(homedir(), ".pi/agent/logs/patch.log"), "patchThinking ERROR: " + (e as Error).message + "\n");
      }); // ember-box the inline thinking trace
      patchNotifications().catch(() => {}); // recolor package-update line on palette change
      patchCodeBlocks().catch(() => {}); // rounded boxes for markdown code blocks
      patchEditorMouse().catch(() => {}); // click-to-place-cursor + right-click paste in the chat input
    }, 0);

    // Status lives in the box border. Footer is hidden when roundedBox is on
    // (allocateStackSizes is patched to collapse footer to 0 lines).
    ctx.ui.setFooter((_tui: any, theme: any, footerData: any) => ({
      invalidate() {},
      dispose() {},
      render(width: number): string[] {
        if (cfg.roundedBox || !cfg.borderStatus) return [];
        const u = ctx.getContextUsage?.();
        const bar = ctxBar(u && u.percent != null ? u.percent : 0);
        const model = ctx.model?.id || "no-model";
        const branch = footerData.getGitBranch?.();
        const cwd = ctx.sessionManager?.getCwd?.() ?? ctx.cwd ?? "";

        const parts: string[] = [];
        if (bsOn("path")) parts.push(homeRel(cwd) + (branch ? ` (${branch})` : ""));
        const hasBar = bsOn("progress") || bsOn("percentage");
        if (hasBar) parts.push(`${bar.fill}${bar.track} ${bar.pctLabel}`);
        if (bsOn("model")) parts.push(model);
        if (parts.length === 0) return [];

        // The bar keeps its own split colors (accent fill, grey track/label);
        // every other right-side part is dim. Gap math uses plain lengths.
        const rightRaw = parts.slice(1);
        const right = rightRaw
          .map((s, i) => (i === 0 && hasBar
            ? theme.fg(bar.color, bar.fill) + theme.fg("dim", bar.track + ` ${bar.pctLabel}`)
            : theme.fg("dim", s)))
          .join("  ");
        const gap = rightRaw.length ? Math.max(2, width - parts[0].length - rightRaw.join("  ").length - 4) : 0;
        return [
          theme.fg("dim", parts[0]) +
            (right ? " ".repeat(gap) + right : "") +
            theme.fg("accent", "✷") +
            " ",
        ];
      },
    }));
  });

  // Output-token accounting. usage.output updates per stream delta on providers
  // that report it live (Anthropic); others fill it in at message end — the
  // counter still lands correctly, just jumps instead of ticking.
  pi.on("message_start", (e) => {
    if (e.message.role === "assistant") liveTokens = 0;
  });
  pi.on("message_update", (e) => {
    if (e.message.role === "assistant") liveTokens = e.message.usage?.output ?? 0;
  });
  pi.on("message_end", (e) => {
    if (e.message.role === "assistant") {
      settledTokens += e.message.usage?.output ?? 0;
      liveTokens = 0;
    }
  });

  pi.on("agent_start", (_e, ctx) => {
    if (turnStart == null) turnStart = Date.now(); // keep first start across auto-retry runs
    ctx.ui.setWorkingIndicator(cfg.sparkleSpinner ? { frames: SPIN, intervalMs: 120 } : undefined);
    if (!cfg.glowText) {
      if (!cfg.turnStats) return; // plain default "Working..." message
      glowTimer = setInterval(() => {
        ctx.ui.setWorkingMessage(BASE_PRE + "Working" + RST + turnStatsSuffix());
      }, 1000); // 1s resolution is all the stats clock needs
      return;
    }

    const word = WORDS[Math.floor(Math.random() * WORDS.length)]; // pick per turn
    let phase = -CREST_SPAN; // crest enters from the left edge
    let tick = 0;
    if (glowTimer) clearInterval(glowTimer);
    glowTimer = setInterval(() => {
      phase += 0.5;
      if (phase > word.length + CREST_SPAN) phase = -CREST_SPAN; // loop crest
      const dots = ".".repeat(Math.floor(tick / DOT_EVERY) % 4).padEnd(3); // . .. ... cycle, padded so the stats suffix stays in a fixed column
      tick++;
      ctx.ui.setWorkingMessage(glow(word, phase) + BASE_PRE + dots + RST + turnStatsSuffix());
    }, GLOW_TICK_MS);
  });

  pi.on("agent_end", (_e, ctx) => {
    if (glowTimer) {
      clearInterval(glowTimer);
      glowTimer = undefined;
    }
    ctx.ui.setWorkingMessage(); // restore default "Working..."
    ctx.ui.setWorkingIndicator(); // restore default spinner
  });

  // Turn fully finished (no auto-retry/queued continuation pending). The final
  // message is already in the chat at this point, so the status line lands
  // right under the turn.
  pi.on("agent_settled", (_e, ctx) => {
    const start = turnStart;
    turnStart = null;
    settledTokens = 0;
    liveTokens = 0;
    if (start == null || !cfg.turnStats || ctx.mode !== "tui") return;
    const im = interactiveModeInstance;
    if (!im?.chatContainer) return;
    const s = Math.max(1, Math.round((Date.now() - start) / 1000));
    const dur = s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
    // showStatus bakes theme.fg("dim"); the star's embedded ANSI overrides it.
    im.showStatus(STAR + ` Worked for ${dur}`);
  });

  pi.on("session_shutdown", () => {
    footerContainerRef = undefined;
    borderCtx = undefined;
    turnStart = null;
    settledTokens = 0;
    liveTokens = 0;
    if (borderCacheTimer) { clearInterval(borderCacheTimer); borderCacheTimer = null; }
  });

  // /pi-reimagined — toggle features. Loops until the user closes the menu.
  pi.registerCommand("pi-reimagined", {
    description: "Toggle pi reimagined UI features + palette",
    handler: async (_args: string, ctx: any) => {
      if (ctx.mode !== "tui") return;
      const PALETTE_ROW = "Palette ▸";
      const STATUS_ROW = "Status ▸";
      for (;;) {
        const opts = TOGGLES.map((t) => `${t.get() ? "[x]" : "[ ]"} ${t.name}`);
        opts.push(`${PALETTE_ROW} ${cfg.palette}`);
        opts.push("Close");
        const choice = await ctx.ui.select("pi reimagined settings", opts);
        if (!choice || choice === "Close") break;
        if (choice.startsWith(PALETTE_ROW)) {
          await pickPalette(ctx);
          continue;
        }
        const t = TOGGLES.find((x) => choice.endsWith(x.name));
        if (!t) break;
        t.set(!t.get());
        saveCfg();
        applyEditor(ctx); // refresh box / prompt / status live
        applyHeader(ctx); // refresh header on toggle
        t.apply?.(ctx); // per-toggle side effects (e.g. rebuild live messages)
        ctx.ui.notify(`${t.name}: ${t.get() ? "on" : "off"}`);
      }
    },
  });

  // /status-bar — configure border status elements
  pi.registerCommand("status-bar", {
    description: "Toggle border status elements + bar style",
    handler: async (_args: string, ctx: any) => {
      if (ctx.mode !== "tui") return;
      // Ensure borderStatus is an object (upgrade from legacy true)
      if (cfg.borderStatus === true) {
        cfg.borderStatus = { ...borderDefault };
      }
      const bs = cfg.borderStatus as Partial<BorderStatus>;
      for (;;) {
        const opts = [
          `${bs.model ? "[x]" : "[ ]"} Model name          (top)`,
          `${bs.progress ? "[x]" : "[ ]"} Progress bar        (bottom)`,
          `${bs.percentage ? "[x]" : "[ ]"} Percentage          (bottom)`,
          `Bar style: ${cfg.barStyle}`,
          `${bs.cacheHits ? "[x]" : "[ ]"} Cache hits          (bottom)`,
          `${bs.path ? "[x]" : "[ ]"} Path                (bottom)`,
          `${bs.branch ? "[x]" : "[ ]"} Git branch          (bottom)`,
          `${bs.diffStats ? "[x]" : "[ ]"} Diff stats          (bottom)`,
          "Close",
        ];
        const choice = await ctx.ui.select("Status bar elements", opts);
        if (!choice || choice === "Close") break;
        if (choice.startsWith("Bar style")) {
          await pickBarStyle(ctx); // live preview picker (non-overlay, takes the editor slot)
          continue;
        }
        if (choice.includes("Model")) bs.model = !bs.model;
        else if (choice.includes("Progress")) bs.progress = !bs.progress;
        else if (choice.includes("Percentage")) bs.percentage = !bs.percentage;
        else if (choice.includes("Cache")) bs.cacheHits = !bs.cacheHits;
        else if (choice.includes("Path")) bs.path = !bs.path;
        else if (choice.includes("Git")) bs.branch = !bs.branch;
        else if (choice.includes("Diff")) bs.diffStats = !bs.diffStats;
        else break;
        saveCfg();
        applyEditor(ctx);
        const name = choice.replace(/\[.\] /, "").split(" ")[0];
        ctx.ui.notify(`${name}: ${choice.includes("[x]") ? "on" : "off"}`);
      }
    },
  });
}
