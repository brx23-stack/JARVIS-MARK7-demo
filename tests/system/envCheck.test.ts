import test from "node:test";
import assert from "node:assert/strict";
import { missingEnv, redact } from "../../lib/system/envCheck.ts";

test("missingEnv lists unset and blank vars only", () => {
  assert.deepEqual(missingEnv(["A", "B", "C"], { A: "x", B: "  ", C: undefined }), ["B", "C"]);
  assert.deepEqual(missingEnv(["A"], { A: "1" }), []);
});

test("redact hides secrets but ignores very short values", () => {
  assert.equal(redact("GET /bot123456:ABC/getMe failed", ["123456:ABC"]), "GET /bot***/getMe failed");
  assert.equal(redact("value is 1", ["1"]), "value is 1");
  assert.equal(redact("nothing", [undefined, ""]), "nothing");
});
