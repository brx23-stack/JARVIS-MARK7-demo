// ——— Outbound request guard (SSRF protection) ———
//
// Used by tools that fetch URLs the MODEL chose (e.g. browser_fetch). Those URLs can be
// steered by prompt injection, so they must never reach the owner's private network,
// loopback services (Ollama, this app's own /api), or cloud metadata endpoints.
//
// Design notes
//  - Public internet stays fully reachable: this blocks destinations, not capabilities.
//  - Addresses are checked inside the socket `lookup` hook, i.e. on the exact IP that is
//    connected to. That closes the DNS-rebinding gap that a separate "resolve, then fetch"
//    check would leave open.
//  - Redirects are followed manually (max 5) and every hop is re-validated.
//  - The response body is capped, so a hostile server cannot exhaust memory.
//  - Owners who deliberately want LAN access can opt in:
//      JARVIS_FETCH_ALLOW_PRIVATE=true            (all private ranges)
//      JARVIS_FETCH_ALLOW_HOSTS=nas.local,192.168.1.20   (specific hosts only)

import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";

const blocked = new net.BlockList();
const V4: [string, number][] = [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15],
  ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
];
const V6: [string, number][] = [
  ["::", 96], ["64:ff9b::", 96], ["100::", 64],
  ["2001:db8::", 32], ["fc00::", 7], ["fe80::", 10], ["fec0::", 10], ["ff00::", 8],
];
for (const [a, p] of V4) blocked.addSubnet(a, p, "ipv4");
for (const [a, p] of V6) blocked.addSubnet(a, p, "ipv6");

// Expands an IPv6 literal to its 8 16-bit groups (handles "::" and a trailing dotted IPv4).
function ipv6Groups(ip: string): number[] | null {
  let text = ip.toLowerCase().split("%")[0];
  const dotted = text.match(/(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (dotted) {
    const [a, b, c, d] = dotted.slice(1).map(Number);
    text = text.slice(0, dotted.index) + ((a << 8) | b).toString(16) + ":" + ((c << 8) | d).toString(16);
  }
  const [head, tail] = text.split("::");
  const h = head ? head.split(":") : [];
  const t = tail === undefined ? [] : tail ? tail.split(":") : [];
  const fill = tail === undefined ? 0 : 8 - h.length - t.length;
  if (fill < 0 || (tail === undefined && h.length !== 8)) return null;
  const groups = [...h, ...Array(fill).fill("0"), ...t].map((g) => parseInt(g, 16));
  return groups.length === 8 && groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff) ? groups : null;
}

export function isPrivateAddress(ip: string): boolean {
  const family = net.isIP(ip);
  if (family === 4) return blocked.check(ip, "ipv4");
  if (family === 6) {
    const g = ipv6Groups(ip);
    if (!g) return true; // unparseable: fail closed
    // IPv4-mapped (::ffff:a.b.c.d): judge the embedded IPv4 address, whatever notation was used.
    if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) {
      return blocked.check(`${g[6] >> 8}.${g[6] & 255}.${g[7] >> 8}.${g[7] & 255}`, "ipv4");
    }
    return blocked.check(ip, "ipv6");
  }
  return true; // not an IP at all: fail closed
}

function allowedHosts(): string[] {
  return (process.env.JARVIS_FETCH_ALLOW_HOSTS || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
}
const allowAllPrivate = () => (process.env.JARVIS_FETCH_ALLOW_PRIVATE || "").trim().toLowerCase() === "true";

export class BlockedDestinationError extends Error {}

/** Throws BlockedDestinationError unless the URL is http(s) without embedded credentials. */
export function assertUrlShape(raw: string): URL {
  let url: URL;
  try { url = new URL(raw); } catch { throw new BlockedDestinationError("Invalid URL."); }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new BlockedDestinationError("Only http(s) URLs are allowed.");
  if (url.username || url.password) throw new BlockedDestinationError("URLs with embedded credentials are not allowed.");
  return url;
}

function hostAllowed(hostname: string): boolean {
  return allowAllPrivate() || allowedHosts().includes(hostname.toLowerCase());
}

// A `lookup` function for http(s).request that refuses private/loopback/metadata addresses.
function guardedLookup(hostname: string, options: any, callback: (...args: any[]) => void) {
  const permit = hostAllowed(hostname);
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err);
    const list = (addresses as unknown as { address: string; family: number }[]) || [];
    const bad = list.find((a) => isPrivateAddress(a.address));
    if (bad && !permit) {
      return callback(new BlockedDestinationError(`Blocked: ${hostname} resolves to a private or reserved address (${bad.address}). ` +
        "Set JARVIS_FETCH_ALLOW_HOSTS to permit a specific LAN host."));
    }
    if (options?.all) return callback(null, list);
    const first = list[0];
    if (!first) return callback(new Error(`No address found for ${hostname}`));
    callback(null, first.address, first.family);
  });
}

export type SafeFetchResult = { status: number; headers: http.IncomingHttpHeaders; body: string; finalUrl: string; truncated: boolean };

export async function safeFetchText(
  rawUrl: string,
  opts: { timeoutMs?: number; maxBytes?: number; maxRedirects?: number; userAgent?: string } = {},
): Promise<SafeFetchResult> {
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const maxBytes = opts.maxBytes ?? 1_000_000;
  const maxRedirects = opts.maxRedirects ?? 5;
  let url = assertUrlShape(rawUrl);

  for (let hop = 0; hop <= maxRedirects; hop++) {
    // Literal-IP hosts skip DNS, so the lookup hook never sees them: check them here.
    const literal = url.hostname.replace(/^\[|\]$/g, "");
    if (net.isIP(literal) && isPrivateAddress(literal) && !hostAllowed(url.hostname)) {
      throw new BlockedDestinationError(`Blocked: ${literal} is a private or reserved address.`);
    }
    const res = await new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string; truncated: boolean }>((resolve, reject) => {
      const lib = url.protocol === "https:" ? https : http;
      const req = lib.request(url, {
        method: "GET",
        lookup: guardedLookup as any,
        timeout: timeoutMs,
        headers: { "user-agent": opts.userAgent || "JARVIS-Mark7/1.0", accept: "text/html,text/plain,application/json;q=0.9,*/*;q=0.5" },
      }, (r) => {
        const chunks: Buffer[] = [];
        let size = 0;
        let truncated = false;
        r.on("data", (c: Buffer) => {
          size += c.length;
          if (size > maxBytes) {
            truncated = true;
            chunks.push(c.subarray(0, c.length - (size - maxBytes)));
            r.destroy();
            return;
          }
          chunks.push(c);
        });
        const done = () => resolve({ status: r.statusCode || 0, headers: r.headers, body: Buffer.concat(chunks).toString("utf8"), truncated });
        r.on("end", done);
        r.on("close", done);
        r.on("error", (e) => (truncated ? done() : reject(e)));
      });
      req.on("timeout", () => req.destroy(new Error("Request timed out.")));
      req.on("error", reject);
      req.end();
    });

    if (res.status >= 300 && res.status < 400 && res.headers.location) {
      if (hop === maxRedirects) throw new Error("Too many redirects.");
      url = assertUrlShape(new URL(String(res.headers.location), url).toString());
      continue;
    }
    return { ...res, finalUrl: url.toString() };
  }
  throw new Error("Too many redirects.");
}
