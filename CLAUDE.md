# CLAUDE.md

Guidance for working in this repo.

## What this is

One pi-agent extension (`pi-reimagined.ts`) plus four theme JSONs that restyle
pi's interactive TUI. **pi** is a separate coding agent (`@earendil-works/pi-coding-agent`),
not Claude Code. Extensions are TypeScript exporting `export default function (pi: ExtensionAPI)`.

Live install lives at `~/.pi/agent/` (`extensions/pi-reimagined.ts`, `themes/*.json`).
This repo is the publishable copy. Edits here must be mirrored to the live dir to test.

## Architecture

- **Palette system.** `PALETTES` map (ember/void/ocean/forest). Each entry = brand
  RGB (`base`, `crest`, `prompt`) the theme JSON can't express + glyphs (`promptChar`,
  `star`, `spinner`) + the name of a paired theme JSON. `applyPalette()` rebuilds the
  derived ANSI (`BASE_PRE`, `SPIN`, `PROMPT`, `STAR`) into module-level `let`s. Switching
  a palette drives both the brand RGB and `ctx.ui.setTheme(P.theme)`.
- **Rounded input box** — `EmberEditor extends CustomEditor`, decorates rendered rows
  (corners, side `│`, prompt `❯`, status baked into border).
- **Custom header** — `ctx.ui.setHeader(factory)`; `PI` block letters with a vertical
  palette gradient, host info on the right, palette divider.
- **Inline thinking box** — monkeypatches `AssistantMessageComponent.prototype.updateContent`
  (only the thinking branch) so reasoning renders in a live box. Context untouched.
- **Package-update recolor** — monkeypatches `InteractiveMode.prototype.showPackageUpdateNotification`,
  swapping the baked `Text` body for a live component and recoloring `warning`→`accent`
  so the box follows the palette.
- **Config** — `~/.pi/agent/pi-reimagined.config.json` (feature toggles + palette). Runtime
  state, gitignored, not part of source.

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
- `theme.fg("warning", …)` is amber in every shipped palette — don't use it for anything
  meant to be palette-tinted; use `accent`.
- pi-tui's `TUI.render` scrolls the real terminal buffer (`tui.js`: pushes `\r\n`, tracks
  `viewportTop`) — scrolling to prior messages is native terminal scrollback, not an
  app-managed viewport. Never enter the alternate screen buffer (`\x1b[?1049h`); alt-screen
  keeps no scrollback in virtually any terminal, so it silently breaks scroll-to-history.

## Conventions

- Author / repo identity: **radu0120** (github.com/Radu0120). Never attribute to "inwound".
- No emoji. Text-presentation dingbats only (`✷ ✶ ✸ ✦ ○ ❀ ✿`); avoid glyphs that render
  as colored emoji or carry VS16.
- Keep it lazy: shortest diff that works, mark deliberate shortcuts with `ponytail:` comments.

## Testing

No automated harness — verified live in pi. After editing, copy to the live dir and
**fully restart pi** (new process; extension reload does not re-fire `session_start` or
re-emit startup notifications). `PI_DEBUG_REDRAW=1` logs full-redraw reasons to
`~/.pi/agent/pi-debug.log`.
