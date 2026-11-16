import crypto from "node:crypto";
import type { NextRequest } from "next/server";

const GLOBAL_KEY = "__jarvisMark7Security";
type Bucket = { count: number; resetAt: number };
type SecurityState = { limits: Map<string, Bucket> };
const globalStore = globalThis as typeof globalThis & { [GLOBAL_KEY]?: SecurityState };

function state(): SecurityState {
  if (!globalStore[GLOBAL_KEY]) globalStore[GLOBAL_KEY] = { limits: new Map() };
  return globalStore[GLOBAL_KEY]!;
}

const MIN_TOKEN_LENGTH = 16;
// Values copied from .env.example or typical defaults must never work as a login.
const PLACEHOLDER_TOKEN = /^(replace|change|your|example|test|password|secret|token|admin|default|todo|xxx)|replace-with|changeme|change-me/i;

/** True when a token is long enough and is not a documented/example placeholder. */
export function isUsableToken(value: string): boolean {
  const v = value.trim();
  return v.length >= MIN_TOKEN_LENGTH && !PLACEHOLDER_TOKEN.test(v);
}

function configuredAccessToken(): string {
  // Keep the existing admin token as a backwards-compatible fallback, while
  // allowing deployments to use a separate browser/API access secret.
  // Placeholder or too-short values are treated as "not configured" (fail closed).
  const primary = (process.env.JARVIS_ACCESS_TOKEN || "").trim();
  if (primary) return isUsableToken(primary) ? primary : "";
  const fallback = (process.env.REMOTE_ADMIN_TOKEN || "").trim();
  return isUsableToken(fallback) ? fallback : "";
}

function safeEqual(a: string, b: string): boolean {
  if (!a || !b) return false;
  const aa = Buffer.from(a);
  const bb = Buffer.from(b);
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

export function isConfiguredAccessToken(): boolean {
  return Boolean(configuredAccessToken());
}

export function verifyAccessToken(candidate: string): boolean {
  return safeEqual(candidate.trim(), configuredAccessToken());
}

export function getClientKey(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || req.headers.get("x-real-ip")?.trim() || "unknown";
}

export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const s = state();
  const existing = s.limits.get(key);
  if (!existing || existing.resetAt <= now) {
    s.limits.set(key, { count: 1, resetAt: now + windowMs });
    if (s.limits.size > 5000) {
      for (const [k, bucket] of s.limits) if (bucket.resetAt <= now) s.limits.delete(k);
    }
    return true;
  }
  if (existing.count >= limit) return false;
  existing.count += 1;
  return true;
}

export function requireAccess(
  req: NextRequest,
  limit = 60,
  windowMs = 60_000,
  sessionValidator?: (token: string | undefined) => boolean,
): { ok: true } | { ok: false; status: 401 | 429; error: string } {
  const candidate = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() || "";
  const session = req.cookies.get("jarvis_remote_ui")?.value || "";
  const authenticated = verifyAccessToken(candidate) || Boolean(sessionValidator?.(session));

  if (!authenticated) return { ok: false, status: 401, error: "JARVIS authentication required" };
  if (!rateLimit(`${getClientKey(req)}:${limit}:${windowMs}`, limit, windowMs)) {
    return { ok: false, status: 429, error: "Too many requests. Try again shortly." };
  }
  return { ok: true };
}
