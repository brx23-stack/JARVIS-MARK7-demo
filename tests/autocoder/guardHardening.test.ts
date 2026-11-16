import test from "node:test";
import assert from "node:assert/strict";
import { isProtected, routeAuthProblem } from "../../lib/autocoder/guard.ts";

test("protected paths are protected regardless of letter case", () => {
  for (const p of ["lib/security.ts", "lib/Security.ts", "LIB/SECURITY.TS", "lib/Privacy/policy.ts", "lib/Autocoder/engine.ts",
    "app/api/Key/route.ts", "app/api/Autocoder/route.ts", "app/api/REMOTE/new/route.ts", "dockerfile", "Package.json", ".ENV.local"]) {
    assert.equal(isProtected(p), true, p);
  }
  assert.equal(isProtected("lib/weather/openMeteo.ts"), false);
  assert.equal(isProtected("components/Hello.tsx"), false);
});

test("new API routes must call requireAccess", () => {
  assert.match(routeAuthProblem("app/api/ping/route.ts", null, "export async function GET(){ return Response.json({}) }") ?? "", /requireAccess/);
  assert.equal(routeAuthProblem("app/api/ping/route.ts", null, "const a = requireAccess(req); export async function GET(){}"), null);
});

test("edits may not strip authentication from an existing route", () => {
  const before = "export async function GET(req){ const a = requireAccess(req); }";
  assert.match(routeAuthProblem("app/api/dashboard/route.ts", before, "export async function GET(req){ }") ?? "", /remove authentication/);
  assert.equal(routeAuthProblem("app/api/dashboard/route.ts", before, before + "\n// ok"), null);
});

test("non-route files are not subject to the route rule", () => {
  assert.equal(routeAuthProblem("lib/x.ts", null, "export const a = 1"), null);
  assert.equal(routeAuthProblem("app/page.tsx", "a", "b"), null);
});
