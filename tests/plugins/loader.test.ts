import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { loadPlugins } from "../../lib/plugins/loader.ts";
import { PLUGINS } from "../../lib/plugins/manifest.generated.ts";
// @ts-ignore - plain .mjs script
import { scanPlugins, renderManifest } from "../../scripts/gen-plugins.mjs";

const quiet = { info() {}, warn() {} };
const tool = (name: string, extra: object = {}) => ({
  definition: { type: "function" as const, function: { name, description: "d", parameters: { type: "object" } } },
  handler: () => "ok",
  ...extra,
});
function run(entries: { dir: string; plugin: unknown }[], existing: string[] = [], switchValue = "") {
  const registered: string[] = [];
  const report = loadPlugins(entries, {
    register: (def) => { registered.push(def.function.name); },
    exists: (n) => existing.includes(n) || registered.includes(n),
    log: quiet, switchValue,
  });
  return { report, registered };
}

test("registers valid tools", () => {
  const { report, registered } = run([{ dir: "a", plugin: { name: "a", tools: [tool("do_it"), tool("do_more")] } }]);
  assert.deepEqual(registered, ["do_it", "do_more"]);
  assert.deepEqual(report.skipped, []);
});

test("never overrides an existing tool, and skips duplicates across plugins", () => {
  const { report, registered } = run([
    { dir: "a", plugin: { name: "a", tools: [tool("web_search"), tool("mine_one")] } },
    { dir: "b", plugin: { name: "b", tools: [tool("mine_one")] } },
  ], ["web_search"]);
  assert.deepEqual(registered, ["mine_one"]);
  assert.equal(report.skipped.length, 2);
});

test("bad plugins are skipped without stopping the rest", () => {
  const { report, registered } = run([
    { dir: "x", plugin: null },
    { dir: "y", plugin: { name: "Bad Name", tools: [] } },
    { dir: "z", plugin: { name: "z", tools: "nope" } },
    { dir: "w", plugin: { name: "w", tools: [tool("Bad-Tool"), tool("no_handler", { handler: 5 }), tool("fine_tool")] } },
  ]);
  assert.deepEqual(registered, ["fine_tool"]);
  assert.equal(report.skipped.length, 5);
});

test("a registration that throws is contained", () => {
  const report = loadPlugins([{ dir: "a", plugin: { name: "a", tools: [tool("boom_tool")] } }], {
    register: () => { throw new Error("nope"); }, exists: () => false, log: quiet, switchValue: "",
  });
  assert.deepEqual(report.loaded, []);
  assert.equal(report.skipped[0].reason, "nope");
});

test("JARVIS_PLUGINS=off loads nothing", () => {
  const { report, registered } = run([{ dir: "a", plugin: { name: "a", tools: [tool("do_it")] } }], [], "off");
  assert.equal(report.disabled, true);
  assert.deepEqual(registered, []);
});

test("the shipped example plugin loads and rolls dice", async () => {
  const { report, registered } = run(PLUGINS);
  assert.deepEqual(report.skipped, []);
  assert.ok(registered.includes("roll_dice"));
  const dice = (PLUGINS[0].plugin as any).tools[0];
  const out = String(dice.handler({ sides: 6, count: 3 }));
  assert.match(out, /^Rolled 3d6: \d, \d, \d \(total \d+\)$/);
  assert.match(String(dice.handler({ sides: "junk", count: 9999 })), /^Rolled 20d6:/);
});

test("manifest.generated.ts is in sync with plugins/ (run `npm run plugins` if this fails)", () => {
  const root = path.resolve(import.meta.dirname, "../..");
  const expected = renderManifest(scanPlugins(path.join(root, "plugins")));
  const actual = fs.readFileSync(path.join(root, "lib/plugins/manifest.generated.ts"), "utf8");
  assert.equal(actual, expected);
});
