// Harness: extracts the host-root resolver from pi-reimagined.ts and runs it
// against fixture package trees mimicking the install layouts that matter:
// Windows/macOS/Linux npm global, pnpm global, dev checkout, plus negatives
// and the end-to-end fallback chain on the real disk.
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, realpathSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import vm from "node:vm";

// --- extract the resolver section from the extension source ---
const src = readFileSync(new URL("../pi-reimagined.ts", import.meta.url), "utf8");
const start = src.indexOf("// --- host package root resolution (portable)");
const end = src.indexOf("// pi version, read once");
if (start < 0 || end <= start) throw new Error("resolver section markers not found");
// Strip the TS annotations present in this section (explicit forms — a
// generic `: type` regex could eat real JS object properties).
const section = src
  .slice(start, end)
  .split("let hostRootCache: string | null | undefined;").join("let hostRootCache;")
  .split("function findHostRootFromPath(entry: string | undefined): string | null {").join("function findHostRootFromPath(entry) {")
  .split("function pkgRootNamed(dir: string): string | null {").join("function pkgRootNamed(dir) {")
  .replace(/function (resolveHostRoot|legacyWindowsHostRoot)\(\): string \| null \{/g, "function $1() {")
  .split("let start: string;").join("let start;");

const ctx = { process, realpathSync, existsSync, readFileSync, join, dirname };
vm.createContext(ctx);
vm.runInContext(
  section + "\nthis.__fns = { resolveHostRoot, findHostRootFromPath, pkgRootNamed, legacyWindowsHostRoot };",
  ctx,
);
const { resolveHostRoot, findHostRootFromPath, pkgRootNamed, legacyWindowsHostRoot } = ctx.__fns;

// --- fixtures ---
const base = join(tmpdir(), `pi-host-resolver-${process.pid}`);
rmSync(base, { recursive: true, force: true });

function makeTree(rel, { dist = true } = {}) {
  const root = join(base, rel);
  const distDir = join(root, "dist", "modes", "interactive", "theme");
  mkdirSync(distDir, { recursive: true });
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "@earendil-works/pi-coding-agent", version: "0.63.0" }));
  writeFileSync(join(root, "dist", "cli.js"), "console.log('pi');");
  if (dist) writeFileSync(join(distDir, "theme.js"), "export const theme = {};");
  return root;
}

const eq = (a, b) => (process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b);

let pass = 0;
let fail = 0;
function t(name, actual, expected) {
  const ok = expected === null ? actual === null : eq(actual, expected);
  if (ok) {
    pass++;
    console.log(`  ok  ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name}\n       expected ${expected}\n       actual   ${actual}`);
  }
}

console.log("== install layouts (argv[1] -> package root) ==");
const layouts = [
  // [name, relRoot] — argv[1] is always <root>/dist/cli.js
  ["macOS npm global", "usr/local/lib/node_modules/@earendil-works/pi-coding-agent"],
  ["linux local install", "home/dev/tools/node_modules/@earendil-works/pi-coding-agent"],
  ["linux pnpm global", "local/share/pnpm/global/node_modules/.pnpm/@earendil-works+pi-coding-agent@0.63.0/node_modules/@earendil-works/pi-coding-agent"],
  ["bun global", "dot-bun/install/global/node_modules/@earendil-works/pi-coding-agent"],
  ["windows npm global (fixture)", "AppData/npm/node_modules/@earendil-works/pi-coding-agent"],
  ["dev checkout (no node_modules)", "pi-src"],
];
for (const [name, rel] of layouts) {
  const root = makeTree(rel);
  t(name, findHostRootFromPath(join(root, "dist", "cli.js")), root);
}

console.log("== negatives ==");
// Unrelated entry point, no pi ancestor anywhere up the tree.
mkdirSync(join(base, "opt", "myapp"), { recursive: true });
writeFileSync(join(base, "opt", "myapp", "main.js"), "console.log('x');");
t("unrelated entry -> null", findHostRootFromPath(join(base, "opt", "myapp", "main.js")), null);
t("undefined entry -> null", findHostRootFromPath(undefined), null);
// Name matches but the deep-import surface is missing (half-built checkout).
const half = makeTree("pi-src-half", { dist: false });
t("missing dist surface -> null", findHostRootFromPath(join(half, "dist", "cli.js")), null);
t("pkgRootNamed: wrong name -> null", pkgRootNamed(join(base, "opt", "myapp")), null);
t("pkgRootNamed: no package.json -> null", pkgRootNamed(base), null);

console.log("== end-to-end fallback chain (real disk) ==");
// In THIS process argv[1] is the test file (not inside pi), so the walk-up
// finds nothing and the legacy Windows fallback must kick in.
if (process.platform === "win32") {
  const realRoot = join(
    process.env.APPDATA || join(process.env.USERPROFILE || ".", "AppData", "Roaming"),
    "npm", "node_modules", "@earendil-works", "pi-coding-agent",
  );
  t("legacy win32 fallback -> real root", resolveHostRoot(), realRoot);
  t("cache: second call identical", resolveHostRoot(), resolveHostRoot());
} else {
  t("non-win32, no pi ancestor -> null", resolveHostRoot(), null);
}

console.log("== cross-copy note ==");
// Document the invariant the whole extension depends on: the root must be the
// RUNNING host's copy. argv[1] is the running process's entry module, so any
// layout where pi's bin resolves into its own install satisfies this. Nothing
// to assert cross-process here; the fixture tests above pin the walk-up logic.
console.log("  (invariant covered by layout fixtures above)");

rmSync(base, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
