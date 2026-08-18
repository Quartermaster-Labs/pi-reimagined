# CLAUDE.md

Guidance for working in this repo.

## What this is

One pi-agent extension (`pi-reimagined.ts`) plus four theme JSONs that restyle
pi's interactive TUI. **pi** is a separate coding agent (`@earendil-works/pi-coding-agent`),
not Claude Code. Extensions are TypeScript exporting `export default function (pi: ExtensionAPI)`.

Live install lives at `~/.pi/agent/` (`extensions/pi-reimagined.ts`, `themes/*.json`).
This repo is the publishable copy. Edits here must be mirrored to the live dir to test.
package.json carries the `pi` manifest (`extensions: ./pi-reimagined.ts`,
`themes: ./themes`) — required for `pi install` discovery: package installs without
a manifest only pick up convention dirs (`extensions/`, `themes/`, …), so the
root-level `.ts` would be skipped. GOTCHA: once a manifest exists, resource types
you omit are DROPPED entirely, so both extensions and themes must stay listed.

## Architecture

- **Portable host-root resolution.** All monkey-patches deep-import pi internals
  by absolute `file://` URL and MUST hit the copy the host is RUNNING on (theme
  proxy + class prototypes are per-module-instance; a second copy patches
  nothing). `resolveHostRoot()` walks up from `process.argv[1]`'s realpath to the
  nearest ancestor package.json named `@earendil-works/pi-coding-agent`, verifying
  the deep-import surface (`dist/modes/interactive/theme/theme.js`) exists — the
  running process's entry module sits inside the pi install for every standard
  layout (Windows/macOS/Linux npm global, local, pnpm/bun global, dev checkout).
  Legacy Windows `%APPDATA%\npm` path is the last-resort fallback; null → the
  deep-import effects degrade away (base UI still works). All five deep-import
  sites (loadHost, captureInteractiveMode, patchThinking, patchNotifications,
  piVersion) go through it. Sync on purpose (piVersion needs it in a render
  callback). Regression: `node tests/test-host-resolver.mjs`.
- **Fullscreen mode.** `captureInteractiveMode()` patches `InteractiveMode.prototype.renderWidgets`
  to capture the singleton instance. `session_start` calls `switchTuiMode("fullscreen")`
  to activate pi's native `TuiAltScreen` — built-in ScrollView with `follow: "end"` (auto-
  scroll to bottom, releases for manual scroll), proper mouse handling, cursor positioning,
  and differential rendering. No manual `\x1b[?1049h` or doRender patches.
- **Palette system.** `PALETTES` map (ember/void/ocean/forest). Each entry = brand
  RGB (`base`, `crest`, `prompt`) the theme JSON can't express + glyphs (`promptChar`,
  `star`, `spinner`) + the name of a paired theme JSON. `applyPalette()` rebuilds the
  derived ANSI (`BASE_PRE`, `SPIN`, `PROMPT`, `STAR`) into module-level `let`s.
  Palette picker (`/pi-reimagined > Palette`) uses pi-tui's `SelectList` with live hover
  preview (`onSelectionChange` calls `previewPalette`). Switching a palette drives both
  the brand RGB and `ctx.ui.setTheme(P.theme)`, then `rebuildLiveMessages()` re-bakes
  past messages with the new theme proxy.
- **Rounded input box** — `EmberEditor extends CustomEditor`, decorates rendered rows
  (corners, side `│`, prompt `❯`, status baked into border). Border status is
  granular: model name (top), progress bar + percentage + path + branch + cache hits
  + diff stats (bottom), each independently toggleable via `/status-bar`. The top
  model label normally ends in a `✷` star; when the model supports reasoning and
  thinking is on (`ctx.model.reasoning && ctx.thinkingLevel !== "off"`) it ends in
  `○ <level>` instead (e.g. `gpt-x ○ xhigh`) — the level reads as the label
  terminator, so the star is dropped (avoids `… ○ xhigh ○`). The ctx-fill
  bar has 4 glyph styles (`cfg.barStyle`, picked in `/status-bar`): blocks (█ + 1/8-cell
  edge + ░, default), diamonds (◆◇), dots (●○), shades (▓▒░). Two-color render:
  fill = bright theme accent (amber >70%, red >90% — `barFill()`), track + pct label =
  dim grey; the accent reads live from the shared theme proxy (`host.T.fg("accent")`)
  so palette switches recolor it. (A braille style was tried and dropped — its ⠸
  dotted track read as noise.) The picker is a NON-overlay `BarStylePreviewList` (pass-through
  Component: preview line + `SelectList`) that takes the editor slot — exactly where
  the /status-bar menu just was (overlays composite over the whole screen incl. editor
  rows, so a bottom anchor would cover the box). Each row shows a sample bar at 65%,
  and the top preview line re-reads `cfg.barStyle` per render: hovering a style
  previews it at the REAL ctx % in the real threshold color (the border itself is
  invisible while the picker occupies the slot). Ctrl+C
  double-press exits (first press shows italic warning for 500ms). Scrolling handled by
  TuiAltScreen's ScrollView, not manual scrollOffset.
- **Custom header** — `ctx.ui.setHeader(factory)`; `PI` block letters with a vertical
  palette gradient + animated horizontal crest sweep (top→bottom), host info on the
  right, palette divider. Sweep runs once at startup then settles to plain gradient.
- **Inline thinking box** — monkeypatches `AssistantMessageComponent.prototype.updateContent`
  (only the thinking branch) so reasoning renders in a live rounded box with timing in the
  **bottom-right** border (" thinking for Xs " counting live while active, " thought for Xs "
  grey when done). `collapseThinking` toggle hides thinking behind a muted italic label.
  Context untouched.
  - Timing is keyed on the **component** (`this._thinkStart/_thinkEnd`), set in
    `updateContent`: one `AssistantMessageComponent` = one assistant message, stable across
    deltas. DON'T key by message object — the stream hands out a fresh `event.message` per
    delta (`this.streamingMessage = event.message`), so a `WeakMap` on message identity
    never matched (was the "always thought for 1s" bug). History/reloaded messages arrive
    finalized → no clock started → plain " thought " label.
- **Code-block boxes** — monkeypatches `Markdown.prototype.renderToken` (pi-tui): the host
  hardcodes literal ``` fence lines for `code` tokens (only color/indent are themeable). The
  `code` branch is replaced with a rounded box (╭╮╰╯, lang label in the top border, content
  wrapped via `wrapTextWithAnsi` to width-4). Falls back to the host branch when the width is
  < 10 or the lang label overflows. Border/content colors still come from the instance's
  markdown theme (`codeBlockBorder`/`codeBlock`/`highlightCode`), so palettes apply for free.
  - **Syntax highlighting + language detection.** Highlighting was already wired: the host's
    `highlightCode` (dist/utils/syntax-highlight.js, highlight.js v10 + palette-derived theme)
    is called with the effective lang. UNLABELED fences get a conservative `detectLang()`
    signature match (json via JSON.parse, shebangs, per-language regexes; ordered specific →
    general, yaml last). NO `hljs.highlightAuto` — it misidentifies prose ("mipsasm") and v10
    exposes no relevance score. A detected lang is used for both highlighting and the border
    label. Detection is per-render (cheap regexes on the first 2KB); no cache — the host
    itself re-highlights every frame. Wrong guess = slightly-off colors only.
- **Update-notification recolor** — monkeypatches both `showNewVersionNotification` and
  `showPackageUpdateNotification`: the host bakes `theme.fg("warning", …)` (amber in every
  palette) into one-shot `Text` children that `rebuildLiveMessages()` never touches. Both are
  rewritten with live `LiveText` bodies + `DynamicBorder` accent borders that re-read the shared
  theme proxy per render, so the boxes follow the active palette. (Version box drops OSC8
  hyperlink + Markdown note rendering — ponytail: URL stays visible as text.)
- **Mode line (mode-extension adapter)** — Claude-Code-style line on the host's
  `belowEditor` widget slot (`ctx.ui.setWidget("pi-reimagined:mode", …, {placement: "belowEditor"})`),
  rendering active modes reported by OTHER extensions (plan/auto/…); when none are
  active it always falls back to `⏸ manual` (the line is never empty while the
  `modeLine` toggle is on). Labels read `<icon> <mode> mode on` (Claude Code
  style; manual/plan use a double space — their icons read tight at one).
  Per-mode icon + FIXED rgb (independent of palette, CC parity: manual
  grey 156,163,175 / plan teal 45,212,191 / auto yellow 234,179,8 / auto-accept
  purple 168,85,247) in `MODE_META`; icons: ⏸ manual / ⏺ plan / ⏵⏵ auto +
  auto-accept (final user pick after the color-emoji attempt — in their terminal
  ⏸ renders as the color pause box while ⏺/⏵ render plain, which is accepted),
  overridable per key via `cfg.modeGlyphs`; unknown modes get palette star + grey.
  Two adapters: (1) event contract — `pi.events.emit("pi-reimagined:mode", {key, label?, active})`
  on change + answering our `pi-reimagined:mode:hello` (emitted on session_start) with current state
  for load-order independence; (2) status mirror — `InteractiveMode.prototype.setExtensionStatus`
  is patched (in `captureInteractiveMode`) so `ctx.ui.setStatus("plan-mode", …)` (the key the pi
  plan-mode example uses) maps to a mode label via `cfg.modeAliases` (default
  `{"plan-mode": "plan"}`); `footerDataProvider.clearExtensionStatuses` is instance-wrapped on
  instance capture because `resetExtensionUI` bypasses setExtensionStatus on clears.
  The widget component duck-types pi-tui (invalidate/dispose/render) and reads `modeStates`
  (Map key→label) + `host.T` LIVE per render — label/palette changes repaint without
  re-registering; `refreshModeLine()` only toggles widget presence. `modeWidgetLive` tracks
  presence so label-only updates don't churn `renderWidgets()`. Toggle: `/pi-reimagined > Mode line`.
  Contract + config documented in README "Mode line" section.
- **Mouse in the chat input** — `TuiAltScreen` consumes every mouse event itself
  (left = screen selection, wheel = scroll, right = win32 paste anywhere, ignores
  x/y); the editor component never sees mouse input. `patchEditorMouse()` patches
  two TuiAltScreen prototypes:
  - `handleSelectionMouseEvent`: plain left **release** over the editor box that was a
    true click → click-to-place-cursor. True click = `selectionPressActive` on
    release, `selectionDragged` false, AND `getSelectionBounds()` empty (covers
    press-elsewhere-release-here). Press/drag/release are otherwise fully native —
    the host anchors on press, extends on drag, and copies the selection on release,
    so **highlight-to-copy in the input still works** (a zero-length selection copies
    nothing: `getSelectionBounds` returns undefined when anchor==focus, so the
    clipboard is never clobbered by a plain click). `editorClickTarget()` maps (x,y)
    → (cursorLine, cursorCol) using the editor's OWN layout primitives so wrapping,
    wide chars and paste markers match the on-screen text: `ed.render(width)` for
    the exact rows (render() only re-adjusts scrollOffset, a no-op right after a
    real render), `layoutText(W)` for the row text, `buildVisualLineMap(W)` for
    visual→logical line, `segment(text,"grapheme")` for col→string offset (W =
    `ed.lastWidth`; padX = `min(paddingX, floor((width-1)/2))`). Rows: 0 = top
    border (no-op), content run = cursor, first border row after the run = bottom
    border (no-op), rows after = autocomplete list (falls through to host
    selection). Skipped while `hasOverlay()`. The click also `setFocus`es the
    editor if focus drifted.
  - `handleRightClickPaste`: right press inside the editor box → host clipboard paste,
    with `setFocus(editor)` first so the paste lands in the input (the host's
    `onRightClickPaste` injects bracketed paste into `getFocusedComponent()`). Outside
    the box return false — downstream handlers (scrollbar/selection) ignore the right
    button, so the click is a clean no-op.
  Editor box detection (`findEditorBoxAt`): hit-test the layout box tree
  (`currentLayout.root`, boxes carry `component` + `rect` + `children`). CRITICAL:
  the tree only descends through VStack/ScrollView nodes — a `Container` (the host
  wraps the editor slot in one) is a LEAF box (children: []) that renders its whole
  subtree at once, so the editor never appears as its own box. Each leaf box's
  COMPONENT subtree is therefore probed (`hasEditorDescendant` name check, then
  `probeEditorAt` recomputes child rects from rendered row counts —
  `Container.render` concatenates children's rows with no gaps, offsets are
  cumulative heights; `box.lineOffset` shifts the virtual origin for
  height-clamped boxes). Matched by constructor name `/Editor$/` (EmberEditor, host
  CustomEditor/Editor).
  **Name match, not `instanceof`**: the extension's bare imports resolve to
  `%USERPROFILE%\node_modules\@earendil-works\pi-coding-agent` — a SECOND copy — while the
  running host uses the `%APPDATA%\npm` one that `loadHost()` patches. Cross-copy
  `instanceof` never matches (class identity verified FALSE). Duck-type by name/shape
  whenever you need to recognize host classes.
  Regression harness: `node tests/test-mouse.mjs` — drives the real host `Editor` (from the
  `%APPDATA%\npm` pi-tui copy) through the extracted `findEditorBoxAt` +
  `editorClickTarget` (fake frame: VStack root → leaf Container box holding the
  editor) for wrapping, CJK wide chars, `scrollOffset`, the rounded box, and
  container probing (spacer sibling, nested container). `node --check pi-reimagined.ts`
  is the TS syntax gate.
- **Loaded resources hidden** — monkeypatches `InteractiveMode.prototype.showLoadedResources`
  to clear the startup Context/Extensions/Themes info block (still accessible via ctrl+o).
- **Glow text** — `agent_start` picks a random fun word ("Bamboozling", "Smelting", …)
  and animates a per-char glow sweep (crest traveling left→right) via `setWorkingMessage`.
- **Sparkle spinner** — `setWorkingIndicator` with palette-specific frames (e.g. dots
  coalescing into a star for void).
- **Turn stats (Claude Code style)** — `agent_start` records turn start (kept across
  auto-retry runs; only reset on `agent_settled`), `message_update` tracks the in-flight
  `usage.output`, `message_end` banks it into the turn total. The working text gets a
  dimmed `(25s · ↓ 2.4k tokens · 1.2k reasoning)` suffix in both glow and plain modes.
  `usage.reasoning` is a SUBSET of output per the pi-ai `Usage` contract (verified
  across provider code: Anthropic `output_tokens` ⊇ `thinking_tokens`, OpenAI
  `completion_tokens` ⊇ `reasoning_tokens`, Google adds `thoughtsTokenCount` into
  output) — the display uses a CLEAN SPLIT: `↓` shows non-reasoning output only
  (`total − reasoning`), reasoning shown separately; the two numbers are disjoint and
  sum to the raw output total (part omitted when nothing is reported; `↓ 0 tokens` is
  dropped on pure-thinking messages).
  **Live estimation:** most local/OpenAI-compatible backends send usage only in the
  FINAL stream chunk (verified on llama-server b10483 via Quartermaster), which would
  leave the counter flat the whole turn. So while no live usage is reported, tokens are
  ESTIMATED from the streamed content chars (`streamedEstimate`: thinking + text +
  toolCall partialJson ÷ `EST_CHARS_PER_TOKEN` 3.0, a compromise between GPT-family ~4
  and CJK-efficient tokenizers ~2.5); real usage always replaces the estimate at
  `message_end`. Estimated numbers carry a `~` prefix (`↓ ~3.6k tokens`); the reasoning
  part falls back to the thinking-text estimate when the provider reports no breakdown.
  On `agent_settled`
  the final message is already in the chat (and the live suffix already vanished on
  `agent_end`), so the host's own `showStatus()` (dim line + spacer, dedupes back-to-back
  statuses) adds "✷ Worked for 53s · ↓ 2.4k tokens (1.2k reasoning)" right under the
  turn — that line carries the final count. (On backends that never report a reasoning
  breakdown, both numbers keep `~` forever: the raw total is real but the split is
  estimated; the only way to fully clean numbers is a server-side fix — stream usage
  per chunk + `completion_tokens_details.reasoning_tokens` in the backend.)
  Toggle: `/pi-reimagined > Turn stats`.
- **Footer** — custom `setFooter` single-line status bar (path, progress, model). Hidden
  (returns empty) when `roundedBox` is on. The host's fullscreen dock reserves the footer
  slot with a hardcoded `minSize: 1`, which leaks a blank line under the mode line while
  the footer renders empty. Fix: mutate that entry's `minSize` **live** — the dock entries
  are plain objects in `VStack.entries` that `allocateStackSizes` reads fresh every frame,
  so `syncFooterSlot()` flips `minSize` to 0/1 and the next render reflows. The entry is
  found by walking `interactiveModeInstance.fullscreenLayoutRoot` (built in the host
  `init()`, before `session_start`) down to the footer container. GOTCHA: `ctx` does NOT
  expose the footer container — the ref must come from the captured host instance
  (`interactiveModeInstance.footerContainer`, a private class field); `ctx.footerContainer`
  was always undefined. Earlier we tried to monkey-patch `allocateStackSizes`'s export —
  that is DEAD (see Key host facts: ESM namespace is frozen); it never ran and the
  permanent blank line under the input survived for a while because of it. RELOAD
  GOTCHA: `/reload` fires `session_shutdown` with `reason: "reload"` followed by
  `session_start` — the layout and its dock entry SURVIVE, so the shutdown handler
  must NOT restore `minSize: 1` on reload (that re-opened the blank line); and a
  re-imported module's `session_start` can fire before its first `renderWidgets`
  capture, so `syncFooterSlot()` self-heals by re-capturing when the entry ref is
  lost (capture is sync-free to keep that recursion-safe).
- **Scrollbar** — `scrollbarStyle` set to palette base RGB; `wheelScrollLines` boosted to 3.
- **Config** — `~/.pi/agent/pi-reimagined.config.json` (feature toggles + palette +
  granular `BorderStatus` + `barStyle`). `BorderStatus` is either `true` (all defaults) or a partial
  object with per-element bools (model, progress, percentage, path, branch, cacheHits,
  diffStats). `barStyle` ∈ blocks/diamonds/dots/shades (invalid values fall
  back to blocks). Runtime state, gitignored, not part of source.

## Key host facts (learned the hard way)

- The package `exports` map only exposes public entrypoints (`.`, `./rpc-entry`,
  `./client`) — no host internals. Host internals are deep-imported by absolute
  `file://` URL under the root found by `resolveHostRoot()` (portable: argv[1]
  walk-up + legacy Windows fallback — see Architecture). Memoized in `loadHost()`.
  Remaining non-portable case: single-file/bundled pi builds (bun binary) have no
  on-disk `dist/` — the deep-import effects degrade away, base UI still works.
- `ctx.ui.setTheme` only invalidates; it does NOT rebuild host components. Components bake
  theme colors at construction. To recolor history we re-run `updateContent` on tracked
  `liveMsgs`, or use a live-rendering component that re-reads the theme proxy each render.
- pi-tui `Container.render` re-renders the whole tree every pass; the TUI diffs full
  `previousLines`. A changed line above the viewport triggers `fullRender(true)` (clears
  scrollback). Committed terminal scrollback otherwise stays frozen.
- The theme proxy exported from `dist/modes/interactive/theme/theme.js` is shared with the
  host; `loadHost().T` is the same object `setTheme` mutates.
- Notifications fire once at process start (`run()` after `init()`), so the monkeypatch
  installed in `session_start` is in place before they fire.
- pi-tui `VStack`/`Stack` entries are **plain mutable objects** in `stack.entries`; the
  layout reads each entry's `minSize`/`maxSize`/`shrink` fresh on every render. To change a
  slot's reserved size at runtime, mutate the entry in place (that's how the footer slot
  collapses — see Footer). Do NOT try to monkey-patch `allocateStackSizes`'s module export:
  the deep-imported `stack.js` is an ESM namespace object whose exports are frozen
  (assignment throws, swallowed by our catch) and pi's own `layout.js` holds a live import
  binding to the original — the patched export never runs. Regression: `node tests/test-layout.mjs`.
- `execSync` **inherits stderr by default** (stdio `['ignore','pipe','inherit']`), unlike `spawnSync`. A child's stderr (e.g. git CRLF warnings from `git diff` under `core.autocrlf`) writes raw to the TTY, painting over the fullscreen UI and desyncing the renderer's diff → full redraws. Always pass `stdio: ["ignore","pipe","ignore"]` on extension-side `execSync` calls.
- `theme.fg("warning", …)` is amber in every shipped palette — don't use it for anything
  meant to be palette-tinted; use `accent`.
- Streaming assistant messages carry `stopReason: "pending"` (every pi-ai provider),
  NOT null. `stopReason == null` only happens on reloaded/history messages. Treat
  `stopReason == null || === "pending"` as "live".
- pi-tui's `TUI.render` scrolls the real terminal buffer (`tui.js`: pushes `\r\n`, tracks
  `viewportTop`) — scrolling to prior messages is native terminal scrollback, not an
  app-managed viewport. **Never manually enter alt-screen** (`\x1b[?1049h`) — use pi's
  `InteractiveMode.switchTuiMode("fullscreen")` which activates `TuiAltScreen` with
  proper ScrollView management. Manual alt-screen breaks scrollback and conflicts with
  pi's internal renderer lifecycle.

## Conventions

- Identity: author is **radu0120** (github.com/Radu0120); the repo lives under the
  **Quartermaster-Labs** GitHub org and npm org **@quartermaster-labs**
  (same pattern as pi-on-demand-context).
- No emoji. Text-presentation dingbats only (`✷ ✶ ✸ ✦ ○ ❀ ✿`); avoid glyphs that render
  as colored emoji or carry VS16.
- Keep it lazy: shortest diff that works, mark deliberate shortcuts with `ponytail:` comments.

## Commands

- `/pi-reimagined` — toggle features (rounded box, prompt char, glow text, sparkle
  spinner, turn stats, think box, collapse thinking, custom header) + open palette picker
- `/status-bar` — toggle individual border status elements (model, progress bar,
  percentage, cache hits, path, git branch, diff stats) + open the bar-style picker
  (live hover preview in the border)

## Testing

- `node --check pi-reimagined.ts` — TS syntax gate (fast first check).
- `node tests/test-mouse.mjs` — mouse regression harness (editor box probing +
  click targeting; wrapping, CJK wide chars, scrollOffset, rounded box, container
  probing; needs a local host copy under `%APPDATA%\npm`).
- `node tests/test-host-resolver.mjs` — host-root resolver regression (mac/linux/
  pnpm/bun/dev/win fixture trees, negatives, real-disk fallback chain).
- `node tests/test-layout.mjs` — footer-slot minSize mechanism (frozen ESM namespace
  proves the old export patch dead; live `Stack.entries` mutation collapses the footer
  slot; capture walk over a host-shaped `VStack([scroll, VStack(dock)])`; needs a local
  host copy under `%APPDATA%\npm`).
- Everything else verified live in pi: after editing, copy `pi-reimagined.ts` to
  `~/.pi/agent/extensions/` and **fully restart pi** (new process; extension reload
  does not re-fire `session_start` or re-emit startup notifications).
