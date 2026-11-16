import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let tmp = "";
const origCwd = process.cwd();
let store: typeof import("../../lib/memory/store.ts");

before(async () => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-mem-")));
  process.chdir(tmp); // the store resolves ./data from cwd at import time
  store = await import("../../lib/memory/store.ts");
});
after(() => { process.chdir(origCwd); fs.rmSync(tmp, { recursive: true, force: true }); });

test("concurrent rememberFact calls are all kept (no lost updates)", async () => {
  await Promise.all(Array.from({ length: 25 }, (_, i) => store.rememberFact(`k${i}`, `v${i}`)));
  const all = await store.recallAllFacts();
  assert.equal(Object.keys(all).length, 25);
  assert.equal(all.k24.value, "v24");
});

test("concurrent remember and forget stay consistent", async () => {
  await Promise.all([store.rememberFact("a", "1"), store.forgetFact("k0"), store.rememberFact("b", "2")]);
  const all = await store.recallAllFacts();
  assert.equal("k0" in all, false);
  assert.equal(all.a.value, "1");
  assert.equal(all.b.value, "2");
});

test("one failed write does not block later writes", async () => {
  const tmpName = path.join(tmp, "data", `memory.json.tmp-${process.pid}`);
  fs.mkdirSync(tmpName); // makes the temp-file write fail with EISDIR
  await assert.rejects(() => store.rememberFact("will-fail", "x"));
  fs.rmdirSync(tmpName);
  await store.rememberFact("after-failure", "ok");
  assert.equal(await store.recallFact("after-failure"), "ok");
});

test("an unreadable memory.json is backed up, not silently destroyed", async () => {
  fs.writeFileSync(path.join(tmp, "data", "memory.json"), "{ this is not json");
  assert.deepEqual(await store.recallAllFacts(), {});
  const backups = fs.readdirSync(path.join(tmp, "data")).filter((f) => f.startsWith("memory.json.corrupt-"));
  assert.equal(backups.length >= 1, true);
});
