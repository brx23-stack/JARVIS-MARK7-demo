import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { isPrivateAddress, safeFetchText, assertUrlShape } from "../../lib/netGuard.ts";

function serve(handler: http.RequestListener): Promise<{ port: number; close: () => void }> {
  return new Promise((resolve) => {
    const srv = http.createServer(handler).listen(0, "127.0.0.1", () => {
      resolve({ port: (srv.address() as AddressInfo).port, close: () => srv.close() });
    });
  });
}
const clearEnv = () => { delete process.env.JARVIS_FETCH_ALLOW_PRIVATE; delete process.env.JARVIS_FETCH_ALLOW_HOSTS; };

test("isPrivateAddress flags loopback, private, link-local, metadata, ULA and mapped addresses", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fe80::1", "fd00::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:a9fe:a9fe", "::7f00:1", "not-an-ip"]) {
    assert.equal(isPrivateAddress(ip), true, ip);
  }
  for (const ip of ["8.8.8.8", "1.1.1.1", "172.32.0.1", "93.184.216.34", "2606:4700:4700::1111", "::ffff:8.8.8.8", "::ffff:808:808"]) {
    assert.equal(isPrivateAddress(ip), false, ip);
  }
});

test("assertUrlShape rejects non-http schemes and embedded credentials", () => {
  assert.throws(() => assertUrlShape("file:///etc/passwd"));
  assert.throws(() => assertUrlShape("ftp://example.com/x"));
  assert.throws(() => assertUrlShape("http://user:pw@example.com/"));
  assert.throws(() => assertUrlShape("not a url"));
  assert.equal(assertUrlShape("https://example.com/a").hostname, "example.com");
});

test("loopback and localhost are blocked by default", async () => {
  clearEnv();
  const s = await serve((_q, r) => r.end("SECRET"));
  try {
    await assert.rejects(() => safeFetchText(`http://127.0.0.1:${s.port}/`), /private or reserved/);
    await assert.rejects(() => safeFetchText(`http://localhost:${s.port}/`), /private or reserved/);
    await assert.rejects(() => safeFetchText(`http://[::1]:${s.port}/`), /private or reserved|ECONNREFUSED/);
  } finally { s.close(); }
});

test("owner opt-in (ALLOW_PRIVATE or ALLOW_HOSTS) permits LAN/loopback", async () => {
  const s = await serve((_q, r) => { r.setHeader("content-type", "text/plain"); r.end("hello"); });
  try {
    process.env.JARVIS_FETCH_ALLOW_PRIVATE = "true";
    assert.equal((await safeFetchText(`http://127.0.0.1:${s.port}/`)).body, "hello");
    clearEnv();
    process.env.JARVIS_FETCH_ALLOW_HOSTS = "127.0.0.1";
    assert.equal((await safeFetchText(`http://127.0.0.1:${s.port}/`)).body, "hello");
  } finally { clearEnv(); s.close(); }
});

test("every redirect hop is re-validated", async () => {
  const target = await serve((_q, r) => r.end("INTERNAL"));
  const redirector = await serve((_q, r) => { r.statusCode = 302; r.setHeader("location", `http://localhost:${target.port}/`); r.end(); });
  try {
    process.env.JARVIS_FETCH_ALLOW_HOSTS = "127.0.0.1"; // first hop allowed, 'localhost' hop is not
    await assert.rejects(() => safeFetchText(`http://127.0.0.1:${redirector.port}/`), /private or reserved/);
  } finally { clearEnv(); target.close(); redirector.close(); }
});

test("response body is capped", async () => {
  const s = await serve((_q, r) => r.end("x".repeat(3_000_000)));
  try {
    process.env.JARVIS_FETCH_ALLOW_PRIVATE = "true";
    const res = await safeFetchText(`http://127.0.0.1:${s.port}/`, { maxBytes: 1000 });
    assert.equal(res.truncated, true);
    assert.ok(res.body.length <= 1000);
  } finally { clearEnv(); s.close(); }
});
