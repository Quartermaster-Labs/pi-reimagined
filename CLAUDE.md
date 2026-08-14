# CLAUDE.md

Guidance for working in this repo.

## What this is

One pi-agent extension (`pi-reimagined.ts`) plus four theme JSONs that restyle
pi's interactive TUI. **pi** is a separate coding agent (`@earendil-works/pi-coding-agent`),
not Claude Code. Extensions are TypeScript exporting `export default function (pi: ExtensionAPI)`.

Live install lives at `~/.pi/agent/` (`extensions/pi-reimagined.ts`, `themes/*.json`).
This repo is the publishable copy. Edits here must be mirrored to the live dir to test.

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
  + diff stats (bottom), each independently toggleable via `/status-bar`. Ctrl+C
  double-press exits (first press shows italic warning for 500ms). Scrolling handled by
  TuiAltScreen's ScrollView, not manual scrollOffset.
- **Custom header** — `ctx.ui.setHeader(factory)`; `PI` block letters with a vertical
  palette gradient + animated horizontal crest sweep (top→bottom), host info on the
  right, palette divider. Sweep runs once at startup then settles to plain gradient.
- **Inline thinking box** — monkeypatches `AssistantMessageComponent.prototype.updateContent`
  (only the thinking branch) so reasoning renders in a live rounded box with timing in the
  **bottom-right** border (" thinking Xs " counting live while active, " thought for Xs "
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
- **Update-notification recolor** — monkeypatches both `showNewVersionNotification` and
  `showPackageUpdateNotification`: the host bakes `theme.fg("warning", …)` (amber in every
  palette) into one-shot `Text` children that `rebuildLiveMessages()` never touches. Both are
  rewritten with live `LiveText` bodies + `DynamicBorder` accent borders that re-read the shared
  theme proxy per render, so the boxes follow the active palette. (Version box drops OSC8
  hyperlink + Markdown note rendering — ponytail: URL stays visible as text.)
- **Loaded resources hidden** — monkeypatches `InteractiveMode.prototype.showLoadedResources`
  to clear the startup Context/Extensions/Themes info block (still accessible via ctrl+o).
- **Glow text** — `agent_start` picks a random fun word ("Bamboozling", "Smelting", …)
  and animates a per-char glow sweep (crest traveling left→right) via `setWorkingMessage`.
- **Sparkle spinner** — `setWorkingIndicator` with palette-specific frames (e.g. dots
  coalescing into a star for void).
- **Footer** — custom `setFooter` single-line status bar (path, progress, model). Hidden
  (returns empty) when `roundedBox` is on; `allocateStackSizes` is patched to force
  footer minSize to 0 so no blank line leaks.
- **Scrollbar** — `scrollbarStyle` set to palette base RGB; `wheelScrollLines` boosted to 3.
- **Config** — `~/.pi/agent/pi-reimagined.config.json` (feature toggles + palette +
  granular `BorderStatus`). `BorderStatus` is either `true` (all defaults) or a partial
  object with per-element bools (model, progress, percentage, path, branch, cacheHits,
  diffStats). Runtime state, gitignored, not part of source.

## Key host facts (learned the hard way)

- The package `exports` map only exposes `"."`. Host internals are deep-imported by
  absolute `file://` URL under `%APPDATA%/npm/node_modules/@earendil-works/pi-coding-agent`.
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

- Author / repo identity: **radu0120** (github.com/Radu0120). Never attribute to "inwound".
- No emoji. Text-presentation dingbats only (`✷ ✶ ✸ ✦ ○ ❀ ✿`); avoid glyphs that render
  as colored emoji or carry VS16.
- Keep it lazy: shortest diff that works, mark deliberate shortcuts with `ponytail:` comments.

## Commands

- `/pi-reimagined` — toggle features (rounded box, prompt char, glow text, sparkle
  spinner, think box, collapse thinking, custom header) + open palette picker
- `/status-bar` — toggle individual border status elements (model, progress bar,
  percentage, cache hits, path, git branch, diff stats)

## Testing

No automated harness — verified live in pi. After editing, copy to the live dir and
**fully restart pi** (new process; extension reload does not re-fire `session_start` or
re-emit startup notifications). `PI_DEBUG_REDRAW=1` logs full-redraw reasons to
`~/.pi/agent/pi-debug.log`.
