import test from "node:test";
import assert from "node:assert/strict";
// @ts-ignore - plain .mjs script, no type declarations
import { applyToken, generateToken } from "../../scripts/setup.mjs";

test("generateToken makes 64 hex chars, different each time", () => {
  const a = generateToken();
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.notEqual(a, generateToken());
});

test("fills an empty JARVIS_ACCESS_TOKEN line", () => {
  const r = applyToken("A=1\nJARVIS_ACCESS_TOKEN=\nB=2\n", { token: "tok" });
  assert.equal(r.changed, true);
  assert.equal(r.text, "A=1\nJARVIS_ACCESS_TOKEN=tok\nB=2\n");
});

test("does not touch an existing token unless rotating", () => {
  const src = "JARVIS_ACCESS_TOKEN=keepme\n";
  const kept = applyToken(src, { token: "new" });
  assert.equal(kept.changed, false);
  assert.equal(kept.token, "keepme");
  assert.equal(kept.text, src);
  const rotated = applyToken(src, { rotate: true, token: "new" });
  assert.equal(rotated.text, "JARVIS_ACCESS_TOKEN=new\n");
});

test("appends the line when it is missing, and keeps CRLF files consistent", () => {
  assert.equal(applyToken("A=1", { token: "t" }).text, "A=1\nJARVIS_ACCESS_TOKEN=t\n");
  assert.equal(applyToken("A=1\r\nJARVIS_ACCESS_TOKEN=\r\n", { token: "t" }).text, "A=1\r\nJARVIS_ACCESS_TOKEN=t\r\n");
});

test("ignores comment lines that merely mention the variable", () => {
  const r = applyToken("# JARVIS_ACCESS_TOKEN=nope\nJARVIS_ACCESS_TOKEN=\n", { token: "t" });
  assert.equal(r.text, "# JARVIS_ACCESS_TOKEN=nope\nJARVIS_ACCESS_TOKEN=t\n");
});
