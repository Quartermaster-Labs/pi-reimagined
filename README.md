# pi reimagined

A reimagined TUI for the [pi coding agent](https://github.com/earendil-works/pi).
One extension + four themes that restyle the interactive mode.

## Features

- **Rounded input box** with live status baked into the border (model, context bar, cwd).
- **Custom `PI` startup header** — block-letter logo in a vertical palette gradient, the usual version/hints/onboarding to the right, palette-colored divider.
- **Glowing working text** — a hot crest travels over a cool ember base while the agent runs.
- **Sparkle spinner** — per-palette glyph sequence (ember sparkle, void twinkle, ocean bubbles, forest bloom).
- **Inline thinking box** — the reasoning trace drawn in a live box, timed (`thinking` → `thought for Xs`). Context untouched.
- **Switchable palettes** with live hover preview: `ember` (default), `void`, `ocean`, `forest`. Each pairs brand RGB with a matching theme.
- **Palette-aware package-update notice** — recolored to follow the active palette instead of a fixed amber.

Toggle any feature or switch palette via `/pi-reimagined`.

## Install

Copy `pi-reimagined.ts` into your pi extensions dir and the four `themes/*.json`
into your pi themes dir:

```
~/.pi/agent/extensions/pi-reimagined.ts
~/.pi/agent/themes/{ember,void,ocean,forest}.json
```

Restart pi. Run `/pi-reimagined` to configure.

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
