# pi reimagined

A reimagined TUI for the [pi coding agent](https://github.com/earendil-works/pi).
One extension + four themes that restyle the interactive mode.

## Features

- **Rounded input box** with live status baked into the border (model + thinking level, context bar, cwd, git branch, diff stats). Four context-bar glyph styles; each element toggleable via `/status-bar`.
- **Custom `PI` startup header** — block-letter logo in a vertical palette gradient, the usual version/hints/onboarding to the right, palette-colored divider.
- **Glowing working text** — a hot crest travels over a cool ember base while the agent runs.
- **Sparkle spinner** — per-palette glyph sequence (ember sparkle, void twinkle, ocean bubbles, forest bloom).
- **Turn stats** — elapsed time + output tokens in the working text, `✷ Worked for Xs` under each finished turn.
- **Inline thinking box** — the reasoning trace drawn in a live box, timed (`thinking` → `thought for Xs`). Context untouched.
- **Rounded code-block boxes** — language label in the border, syntax highlighting, conservative language detection for unlabeled fences.
- **Mouse in the chat input** — click to place the cursor, right-click to paste; highlight-to-copy still works.
- **Switchable palettes** with live hover preview: `ember` (default), `void`, `ocean`, `forest`. Each pairs brand RGB with a matching theme.
- **Palette-aware update notices** — version + package update banners recolored to follow the active palette instead of a fixed amber.

Toggle any feature or switch palette via `/pi-reimagined`; configure border status elements and bar style via `/status-bar`.

## Install

Via pi (recommended):

```
pi install npm:@quartermaster-labs/pi-reimagined
```

Or manually: copy `pi-reimagined.ts` into your pi extensions dir and the four
`themes/*.json` into your pi themes dir:

```
~/.pi/agent/extensions/pi-reimagined.ts
~/.pi/agent/themes/{ember,void,ocean,forest}.json
```

Restart pi. Run `/pi-reimagined` to configure.

Requires Node >= 22.19 (same as pi).

## Palettes

| Palette | Accent | Spinner |
|---------|--------|---------|
| ember   | orange | `✷ ✶ ✸` sparkle |
| void    | purple | `✦ ⋆` star + dots |
| ocean   | blue   | `○ ◯` bubbles |
| forest  | green  | `❀ ✿` bloom |

## Known limitations

- **Path-coupled host imports.** Some effects (inline thinking box, palette
  recolor of host components) deep-import pi internals by absolute path under
  `%APPDATA%/npm/node_modules/@earendil-works/pi-coding-agent`. This is
  Windows/npm-global specific and will not resolve on other layouts (mac/linux,
  local installs) as-is. Needs a portable host-path resolver before a real
  publish.
- Terminal-native scrollback that has already been committed (above the active
  render region) does not always recolor on a live palette switch.

## License

MIT © radu0120
