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
  Regression harness: `node test-mouse.mjs` — drives the real host `Editor` (from the
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
  dimmed `(25s · ↓ 3.6k tokens)` suffix in both glow and plain modes. On `agent_settled`
  the final message is already in the chat, so the host's own `showStatus()` (dim line +
  spacer, dedupes back-to-back statuses) adds "✷ Worked for 53s" right under the turn.
  Toggle: `/pi-reimagined > Turn stats`.
- **Footer** — custom `setFooter` single-line status bar (path, progress, model). Hidden
  (returns empty) when `roundedBox` is on; `allocateStackSizes` is patched to force
  footer minSize to 0 so no blank line leaks.
- **Scrollbar** — `scrollbarStyle` set to palette base RGB; `wheelScrollLines` boosted to 3.
- **Config** — `~/.pi/agent/pi-reimagined.config.json` (feature toggles + palette +
  granular `BorderStatus` + `barStyle`). `BorderStatus` is either `true` (all defaults) or a partial
  object with per-element bools (model, progress, percentage, path, branch, cacheHits,
  diffStats). `barStyle` ∈ blocks/diamonds/dots/shades (invalid values fall
  back to blocks). Runtime state, gitignored, not part of source.

## Key host facts (learned the hard way)

- The package `exports` map only exposes public entrypoints (`.`, `./rpc-entry`,
  `./client`) — no host internals. Host internals are deep-imported by absolute
  `file://` URL under `%APPDATA%/npm/node_modules/@earendil-works/pi-coding-agent`.
  Memoized in `loadHost()`. **This is the main publish blocker** — Windows/npm-global only.
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
- `allocateStackSizes` (from `pi-tui/dist/components/stack.js`) can be patched to override
  per-entry `minSize`. We use it to collapse the footer container to 0 lines when
  `roundedBox` is on (host default is minSize:1, which leaves a blank line).
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
- `node test-mouse.mjs` — mouse regression harness (editor box probing + click
  targeting; wrapping, CJK wide chars, scrollOffset, rounded box, container probing).
- Everything else verified live in pi: after editing, copy `pi-reimagined.ts` to
  `~/.pi/agent/extensions/` and **fully restart pi** (new process; extension reload
  does not re-fire `session_start` or re-emit startup notifications).
