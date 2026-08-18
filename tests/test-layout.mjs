// Harness: proves the footer-slot minSize fix against the REAL host modules:
// (1) the ESM namespace of stack.js is frozen — the old allocateStackSizes
//     export patch could NEVER install (assignment throws, was swallowed);
// (2) Stack.entries are plain objects read live every frame — mutating
//     entry.minSize in place changes allocateStackSizes output next call;
// (3) the capture walk (root.entries -> nested VStack.entries -> footer entry)
//     finds the right entry on a tree shaped like the host's fullscreen layout
//     (interactive-mode.js init(): VStack([scrollView, VStack(dock)]) where the
//     dock carries { footerContainer, minSize: 1 }).
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import assert from "node:assert";

const TUI = "C:/Users/radue/AppData/Roaming/npm/node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-tui/dist";
if (!existsSync(`${TUI}/components/stack.js`)) {
  console.error(`skip: host pi-tui not found under ${TUI} — set TUI path for your install`);
  process.exit(0);
}
const stackMod = await import(pathToFileURL(`${TUI}/components/stack.js`).href);
const { VStack } = await import(pathToFileURL(`${TUI}/components/v-stack.js`).href);
const { allocateStackSizes } = stackMod;

let pass = 0;
let fail = 0;
function t(name, fn) {
  try {
    fn();
    pass++;
    console.log(`  ok  ${name}`);
  } catch (e) {
    fail++;
    console.log(`  FAIL ${name}\n       ${e.message}`);
  }
}

// --- (1) old patch approach is dead: frozen ESM namespace ---
t("stack.js namespace is frozen (old export patch could never install)", () => {
  assert.throws(() => {
    "use strict";
    stackMod.allocateStackSizes = function () {};
  }, TypeError);
});

// --- host-shaped tree: root VStack([scroll, dock]), dock VStack with footer ---
const scroll = { render: () => [] };
const pending = { render: () => [] };
const editor = { render: () => ["e", "e", "e"] };
const footer = { render: () => [] };
const dock = new VStack([
  { component: pending, shrink: 1, minSize: 0 },
  { component: editor, shrink: 1, minSize: 3 },
  { component: footer, shrink: 1, minSize: 1 }, // the host's hardcoded slot
]);
const root = new VStack([
  { component: scroll, basis: 0, grow: 1, shrink: 1, minSize: 1 },
  { component: dock, basis: "auto", grow: 0, shrink: 1, minSize: 1 },
]);

const footerEntry = dock.entries.find((e) => e.component === footer);
assert.ok(footerEntry, "footer entry exists in dock");

// intrinsic [0,3,0]: the footer renders [] (0 lines) — same as the live host.
// --- (2) minSize: 1 forces the slot to 1 line even when the footer renders 0 ---
t("minSize 1 reserves a line for an empty footer (the blank line bug)", () => {
  const sizes = allocateStackSizes(dock.entries, [0, 3, 0], 5, 0);
  assert.strictEqual(sizes[2], 1);
});

// --- (3) capture walk finds the entry via root -> dock -> footer ---
function captureFooterDockEntry(root, footerRef) {
  if (!footerRef || !Array.isArray(root?.entries)) return undefined;
  for (const e of root.entries) {
    const sub = e.component?.entries;
    if (!Array.isArray(sub)) continue;
    const f = sub.find((x) => x.component === footerRef);
    if (f) return f;
  }
  return undefined;
}
t("capture walk finds the live footer dock entry", () => {
  assert.strictEqual(captureFooterDockEntry(root, footer), footerEntry);
  assert.strictEqual(captureFooterDockEntry(root, { render: () => [] }), undefined); // no match
});

// --- (4) live mutation takes effect on the next allocation ---
t("mutating entry.minSize to 0 collapses the slot (the fix)", () => {
  const found = captureFooterDockEntry(root, footer);
  found.minSize = 0; // syncFooterSlot() does exactly this
  const sizes = allocateStackSizes(dock.entries, [0, 3, 0], 5, 0);
  assert.strictEqual(sizes[2], 0);
  found.minSize = 1; // restore (session_shutdown does this)
  assert.strictEqual(allocateStackSizes(dock.entries, [0, 3, 0], 5, 0)[2], 1);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
