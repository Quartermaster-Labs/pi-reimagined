// Harness: extracts the mouse-mapping functions from pi-reimagined.ts and
// drives them against the REAL host Editor class (same copy the running host
// uses). Verifies (x,y) -> (cursorLine, cursorCol) for the cases that matter.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import vm from "node:vm";

const PI_TUI = "C:/Users/radue/AppData/Roaming/npm/node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-tui/dist";
const { Editor, visibleWidth } = await import(pathToFileURL(`${PI_TUI}/index.js`).href);
const { wordWrapLine } = await import(pathToFileURL(`${PI_TUI}/components/editor.js`).href);

// --- extract the mouse section from the extension source ---
const src = readFileSync(new URL("../pi-reimagined.ts", import.meta.url), "utf8");
const start = src.indexOf("// ---- Mouse:");
// Stop before the TEMP diagnostics block (uses host-side fs helpers); fall
// back to the patch function when the temp block has been removed.
const tempIdx = src.indexOf("// --- TEMP mouse diagnostics");
const end = tempIdx > start ? tempIdx : src.indexOf("let patchedEditorMouse");
if (start < 0 || end <= start) throw new Error("mouse section markers not found");
let section = src.slice(start, end);
// Strip the TS annotations present in this section (explicit forms — a
// generic `: type` regex could eat real JS object properties).
section = section
  .split("rect: { x: number; y: number; width: number }").join("rect")
  .split(": { comp: any; rect: any } | undefined").join("")
  .replace(/: string\[\]/g, "")
  .replace(/: (string|number|boolean|void|any)\b/g, "")
  .replace(/\| undefined/g, "");
const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
const ctx = { VW: visibleWidth, stripAnsi, console };
vm.createContext(ctx);
vm.runInContext(section + "\nthis.__fns = { findEditorBoxAt, edRowIsBorder, colToOffset, editorClickTarget };", ctx);
const { findEditorBoxAt, editorClickTarget } = ctx.__fns;

// --- fake tui + real editor ---
const fakeTui = { terminal: { rows: 40, columns: 120 }, requestRender() {} };
const theme = { borderColor: (s) => s };

function makeEditor({ text = "", padX = 2, width = 100 } = {}) {
  const ed = new Editor(fakeTui, theme, { paddingX: padX });
  ed.state.lines = text.length ? text.split("\n") : [""];
  ed.state.cursorLine = 0;
  ed.state.cursorCol = 0;
  ed.focused = true;
  ed.render(width); // prime lastWidth + layout
  return ed;
}

// EmberEditor-style decorator: rounded box (corners + │ sides + ❯ prompt).
// Mirrors EmberEditor.render: strip the raw ─ borders, wrap content rows in
// side borders, add corner rows.
function makeRoundedEditor(opts = {}) {
  const ed = makeEditor(opts);
  const origRender = ed.render.bind(ed);
  const isBorder = (s) => /^─+$/.test(stripAnsi(s)) || /^─+\s*[↑↓]\s*\d+\s+more/.test(stripAnsi(s));
  ed.render = (width) => {
    const rows = [...origRender(width)];
    if (rows.length && isBorder(rows[0])) rows.shift();
    if (rows.length && isBorder(rows[rows.length - 1])) rows.pop();
    return [
      `╭${"─".repeat(width - 2)}╮`,
      ...rows.map((line, i) => {
        const left = i === 0 ? "❯" : "│";
        let out = line.startsWith(" ") ? left + line.slice(1) : left + line;
        if (out.endsWith(" ")) out = out.slice(0, -1) + "│";
        return out;
      }),
      `╰${"─".repeat(width - 2)}╯`,
    ];
  };
  return ed;
}

// Fake frame: VStack root -> leaf box whose component is a Container holding
// the editor (matches the real layout: Containers are leaf boxes with
// children:[]). `click()` runs the real findEditorBoxAt + editorClickTarget.
function makeFrame(W, containerKids) {
  const container = { constructor: { name: "Container" }, children: containerKids };
  const leaf = { component: container, rect: { x: 0, y: 0, width: W, height: 60 }, lineOffset: 0, children: [] };
  const root = { component: { constructor: { name: "VStack" }, children: [] }, rect: { x: 0, y: 0, width: W, height: 60 }, children: [leaf] };
  return { currentLayout: { root } };
}
function click(ed, W, x, y, kids) {
  const found = findEditorBoxAt(makeFrame(W, kids ?? [ed]), x, y);
  if (!found) return undefined;
  return editorClickTarget(found.comp, found.rect, x, y);
}

let pass = 0, fail = 0;
function check(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.log(`FAIL  ${name}\n      got  ${g}\n      want ${w}`); }
}

console.log("== plain editor ==");
{
  const W = 100;
  const ed = makeEditor({ text: "hello world", width: W });
  // text starts at padX=2; 'r' of world is text col 8 -> screen col 10
  check("simple line mid-word", click(ed, W, 2 + 8, 1), { kind: "cursor", line: 0, col: 8 });
  check("click before padding -> col 0", click(ed, W, 0, 1), { kind: "cursor", line: 0, col: 0 });
  check("click in right padding -> EOL", click(ed, W, 2 + 50, 1), { kind: "cursor", line: 0, col: 11 });
  check("top border row", click(ed, W, 50, 0), { kind: "border" });
  check("bottom border row", click(ed, W, 50, 2), { kind: "border" });

  const ed2 = makeEditor({ text: "abc\ndef", width: W });
  check("second line", click(ed2, W, 2 + 2, 2), { kind: "cursor", line: 1, col: 2 });

  const ed3 = makeEditor({ width: W });
  check("empty editor", click(ed3, W, 5, 1), { kind: "cursor", line: 0, col: 0 });
}

console.log("== wrapped line ==");
{
  const W = 20; // layoutWidth = 16
  const line = "aaaaaaaaaa bbbbbbbbbb"; // width 21 -> wraps after the space
  const chunks = wordWrapLine(line, 16);
  if (chunks.length !== 2) throw new Error("test setup: expected 2 chunks, got " + chunks.length);
  const ed = makeEditor({ text: line, width: W });
  // rows: 0 top border, 1 "aaaaaaaaaa ", 2 "bbbbbbbbbb", 3 bottom
  check("wrapped chunk 1", click(ed, W, 2 + 3, 1), { kind: "cursor", line: 0, col: 3 });
  check("wrapped chunk 2 maps back to logical line 0", click(ed, W, 2 + 5, 2), { kind: "cursor", line: 0, col: 11 + 5 });
}

console.log("== wide chars (CJK) ==");
{
  const W = 100;
  const ed = makeEditor({ text: "日本語test", width: W });
  // 日(2) 本(2) 語(2) t e s t  — text cols: 日[0,2) 本[2,4) 語[4,6) t[6] e[7] s[8] t[9]
  check("boundary after 2 CJK chars", click(ed, W, 2 + 4, 1), { kind: "cursor", line: 0, col: 2 });
  check("right half of wide char -> before it", click(ed, W, 2 + 3, 1), { kind: "cursor", line: 0, col: 1 });
  check("left half of first wide char -> col 0", click(ed, W, 2 + 1, 1), { kind: "cursor", line: 0, col: 0 });
  check("ascii after CJK", click(ed, W, 2 + 7, 1), { kind: "cursor", line: 0, col: 4 });
}

console.log("== scrollOffset ==");
{
  const W = 100;
  const lines = Array.from({ length: 15 }, (_, i) => `line-${i}`);
  const ed = makeEditor({ text: lines.join("\n"), width: W });
  ed.state.cursorLine = 14;
  ed.state.cursorCol = 0;
  ed.render(W); // scrollOffset should snap to keep line 14 visible
  const maxVisible = Math.max(5, Math.floor(40 * 0.3)); // 12
  const expectOffset = 14 - maxVisible + 1;
  if (ed.scrollOffset !== expectOffset) throw new Error(`test setup: scrollOffset ${ed.scrollOffset} != ${expectOffset}`);
  // top visible row = line 3; click mid-word "line-3" text col 4 -> "3"
  check("top visible row maps past scrollOffset", click(ed, W, 2 + 4, 1), { kind: "cursor", line: expectOffset, col: 4 });
  check("bottom visible row", click(ed, W, 2 + 2, maxVisible), { kind: "cursor", line: 14, col: 2 });
}

console.log("== rounded box (EmberEditor shape) ==");
{
  const W = 100;
  const ed = makeRoundedEditor({ text: "hello world\nsecond", width: W });
  check("rounded: first line via ❯ row", click(ed, W, 2 + 6, 1), { kind: "cursor", line: 0, col: 6 });
  check("rounded: second line", click(ed, W, 2 + 3, 2), { kind: "cursor", line: 1, col: 3 });
  check("rounded: top corner row", click(ed, W, 50, 0), { kind: "border" });
  check("rounded: bottom corner row", click(ed, W, 50, 3), { kind: "border" });
  // out of box -> undefined (no editor under the point; host handles it)
  check("outside box -> undefined", click(ed, W, 50, -1), undefined);
}

console.log("== container probing ==");
{
  const W = 100;
  // Sibling spacer before the editor: editor rows start at y=2
  const ed = makeEditor({ text: "hello", width: W });
  const spacer = { constructor: { name: "Spacer" }, render: () => ["", ""] };
  check("spacer sibling offsets editor rows", click(ed, W, 2 + 3, 3, [spacer, ed]), { kind: "cursor", line: 0, col: 3 });
  check("click on spacer -> undefined", click(ed, W, 5, 1, [spacer, ed]), undefined);
  // Nested container: Container > Container > editor
  const ed2 = makeEditor({ text: "abc", width: W });
  const inner = { constructor: { name: "Container" }, children: [ed2] };
  check("nested container", click(ed2, W, 2 + 1, 1, [inner]), { kind: "cursor", line: 0, col: 1 });
  // Container without an editor -> undefined
  const ed3 = makeEditor({ text: "abc", width: W });
  check("no editor in tree -> undefined", click(ed3, W, 2 + 1, 1, [spacer]), undefined);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
