import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireAccess } from "@/lib/security";
import { isValidUiSession } from "@/lib/remote/gateway";
import { getApiKey } from "@/lib/serverKey";
import { checkAndCount, guardStatus, limits, setKilled } from "@/lib/realtime/guard";
import { isLocalOnlyMode } from "@/lib/privacy/policy";

export const dynamic = "force-dynamic";

const deny = (a: { error: string; status: number }) =>
  NextResponse.json({ error: a.error }, { status: a.status });

// Mint a short-lived ek_ key. The real key never leaves the server.
export async function POST(req: NextRequest) {
  const auth = requireAccess(req, 5, 60_000, isValidUiSession);
  if (!auth.ok) return deny(auth);

  if (isLocalOnlyMode()) return NextResponse.json({ error: "Realtime cloud voice is disabled by local-only privacy mode." }, { status: 403 });

  const apiKey = getApiKey("openai") || process.env.OPENAI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "No OpenAI key. Add one in the AI popup or set OPENAI_API_KEY." }, { status: 503 });

  const gate = checkAndCount();
  if (!gate.ok) return deny(gate);

  const model = process.env.OPENAI_REALTIME_MODEL || "gpt-realtime-2";
  const l = limits();
  try {
    const res = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
      method: "POST",
      signal: AbortSignal.timeout(10_000),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "OpenAI-Safety-Identifier": crypto.createHash("sha256").update("jarvis-owner").digest("hex").slice(0, 32),
      },
      body: JSON.stringify({
        expires_after: { anchor: "created_at", seconds: 60 },
        session: {
          type: "realtime",
          model,
          instructions: process.env.REALTIME_INSTRUCTIONS || "You are JARVIS, a calm, concise voice assistant. Reply in one or two short sentences.",
          audio: { output: { voice: process.env.REALTIME_VOICE || "alloy" } },
        },
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.value) {
      return NextResponse.json({ error: `OpenAI refused the session (${res.status}): ${JSON.stringify(data?.error ?? data).slice(0, 300)}` }, { status: 502 });
    }
    return NextResponse.json({ value: data.value, expiresAt: data.expires_at, model, maxSessionSeconds: l.maxSessionSeconds }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Token request failed." }, { status: 502 });
  }
}

export async function GET(req: NextRequest) {
  const auth = requireAccess(req, 30, 60_000, isValidUiSession);
  if (!auth.ok) return deny(auth);
  return NextResponse.json(guardStatus());
}

// Kill switch: stop minting until PATCH {enabled:true} or a server restart.
export async function DELETE(req: NextRequest) {
  const auth = requireAccess(req, 10, 60_000, isValidUiSession);
  if (!auth.ok) return deny(auth);
  setKilled(true);
  return NextResponse.json({ killed: true });
}

export async function PATCH(req: NextRequest) {
  const auth = requireAccess(req, 10, 60_000, isValidUiSession);
  if (!auth.ok) return deny(auth);
  const body = await req.json().catch(() => ({}));
  setKilled(body?.enabled === true ? false : true);
  return NextResponse.json(guardStatus());
}
