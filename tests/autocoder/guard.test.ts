import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { checkPath, isProtected, normalizeRel, type PathCheck } from "../../lib/autocoder/guard.ts";

const err = (r: PathCheck): string => (r.ok ? "" : r.error);
let tmp = "";
let outside = "";
const origCwd = process.cwd();
let symlinkOk = false;

before(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-guard-")));
  outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-outside-")));
  for (const d of ["app", "lib", "components"]) fs.mkdirSync(path.join(tmp, d));
  fs.writeFileSync(path.join(tmp, "lib", "security.ts"), "// x");
  try { fs.symlinkSync(outside, path.join(tmp, "lib", "link")); symlinkOk = true; } catch { /* no symlink rights */ }
  process.chdir(tmp);
});

after(() => {
  process.chdir(origCwd);
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.rmSync(outside, { recursive: true, force: true });
});

test("normalizeRel fixes slashes and leading ./", () => {
  assert.equal(normalizeRel(".\\lib\\a.ts"), "lib/a.ts");
  assert.equal(normalizeRel("./lib/a.ts"), "lib/a.ts");
});

test("isProtected blocks system files", () => {
  for (const p of [".env", ".env.local", "data/x.json", "package.json", "package-lock.json", "tsconfig.json",
    "lib/security.ts", "lib/serverKey.ts", "lib/autocoder/guard.ts", "lib/remote/gateway.ts",
    "app/api/remote/admin/route.ts", "android/policy.py", "android/server.py", "app/api/android/control/route.ts", "lib/privacy/policy.ts", "lib/evolution/store.ts", "lib/tools/execute.ts", "lib/voice/speechRecognition.ts", "app/api/chat/route.ts", "app/api/tts/route.ts", "lib/agents/androidTools.ts", "lib/agents/tool-registry.ts", "lib/plugins/loader.ts", "plugins/example-dice/index.ts"]) {
    assert.equal(isProtected(p), true, p);
  }
});

test("isProtected allows normal source files", () => {
  for (const p of ["components/Foo.tsx", "lib/briefing/dayData.ts", "app/page.tsx", "docs/a.md"]) {
    assert.equal(isProtected(p), false, p);
  }
});

test("AUTOCODER_PROTECTED adds extra patterns", () => {
  process.env.AUTOCODER_PROTECTED = "lib/secret/*,components/Locked.tsx";
  assert.equal(isProtected("lib/secret/a.ts"), true);
  assert.equal(isProtected("components/Locked.tsx"), true);
  assert.equal(isProtected("components/Open.tsx"), false);
  delete process.env.AUTOCODER_PROTECTED;
});

test("checkPath rejects path escapes", async () => {
  for (const p of ["../etc/passwd.ts", "lib/../../x.ts", "app/..\\..\\x.ts", "..", "lib/../../../x.ts"]) {
    assert.equal((await checkPath(p, { forWrite: false })).ok, false, p);
  }
});

test("checkPath rejects absolute, empty and null-byte paths", async () => {
  for (const p of ["/etc/passwd", "C:\\Windows\\x.ts", "", "   ", "lib/a\0.ts"]) {
    assert.equal((await checkPath(p, { forWrite: false })).ok, false, JSON.stringify(p));
  }
});

test("checkPath enforces folder and extension allowlists", async () => {
  assert.match(err(await checkPath("node_modules/x/index.ts", { forWrite: false })), /folder not allowed/);
  assert.match(err(await checkPath("lib/run.exe", { forWrite: false })), /file type not allowed/);
  assert.match(err(await checkPath("lib/data.json", { forWrite: false })), /file type not allowed/);
  assert.match(err(await checkPath("android/server.py", { forWrite: false })), /folder not allowed/);
});

test("protected files are readable but not writable", async () => {
  assert.equal((await checkPath("lib/security.ts", { forWrite: false })).ok, true);
  assert.match(err(await checkPath("lib/security.ts", { forWrite: true })), /protected file/);
});

test("checkPath allows a new file inside the project", async () => {
  const r = await checkPath("lib/new/feature.ts", { forWrite: true });
  assert.ok(r.ok);
  if (r.ok) assert.equal(r.abs, path.join(tmp, "lib", "new", "feature.ts"));
});

test("checkPath blocks symlinks that leave the project", async (t) => {
  if (!symlinkOk) return t.skip("symlinks not permitted here");
  assert.match(err(await checkPath("lib/link/x.ts", { forWrite: true })), /symlink escapes/);
});
