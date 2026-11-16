import test from "node:test";
import assert from "node:assert/strict";
import { isUsableToken, isConfiguredAccessToken, verifyAccessToken } from "../../lib/security.ts";

const reset = () => { delete process.env.JARVIS_ACCESS_TOKEN; delete process.env.REMOTE_ADMIN_TOKEN; };

test("isUsableToken rejects short values and documented placeholders", () => {
  for (const v of ["", "short", "replace-with-a-long-random-admin-token", "replace-with-a-long-random-secret", "changeme-changeme-changeme", "your-token-goes-here-123"]) {
    assert.equal(isUsableToken(v), false, v);
  }
  assert.equal(isUsableToken("a".repeat(64)), true);
  assert.equal(isUsableToken("3f9a1c7e5b2d4086a1b3c5d7e9f01234"), true);
});

test("the .env.example placeholder cannot be used to log in (fail closed)", () => {
  reset();
  process.env.REMOTE_ADMIN_TOKEN = "replace-with-a-long-random-admin-token";
  assert.equal(isConfiguredAccessToken(), false);
  assert.equal(verifyAccessToken("replace-with-a-long-random-admin-token"), false);
  reset();
});

test("a placeholder JARVIS_ACCESS_TOKEN does not fall back to REMOTE_ADMIN_TOKEN", () => {
  reset();
  process.env.JARVIS_ACCESS_TOKEN = "changeme";
  process.env.REMOTE_ADMIN_TOKEN = "b".repeat(40);
  assert.equal(isConfiguredAccessToken(), false);
  reset();
});

test("a real token works, and REMOTE_ADMIN_TOKEN remains a valid fallback", () => {
  reset();
  process.env.JARVIS_ACCESS_TOKEN = "c".repeat(48);
  assert.equal(verifyAccessToken("c".repeat(48)), true);
  assert.equal(verifyAccessToken("d".repeat(48)), false);
  reset();
  process.env.REMOTE_ADMIN_TOKEN = "e".repeat(40);
  assert.equal(verifyAccessToken("e".repeat(40)), true);
  reset();
});
