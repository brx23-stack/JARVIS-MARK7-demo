import { NextRequest, NextResponse } from "next/server";
import { createUiSession, isRemoteEnabled, isValidUiSession } from "@/lib/remote/gateway";
import { isConfiguredAccessToken, rateLimit, verifyAccessToken, getClientKey } from "@/lib/security";

export const dynamic = "force-dynamic";

function setSession(response: NextResponse, token: string) {
  response.cookies.set("jarvis_remote_ui", token, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 24 * 60 * 60,
  });
  return response;
}

export async function GET(req: NextRequest) {
  const existing = req.cookies.get("jarvis_remote_ui")?.value;
  if (!isValidUiSession(existing)) {
    return NextResponse.json({ authenticated: false, error: "JARVIS authentication required" }, { status: 401 });
  }
  return NextResponse.json(
    { authenticated: true, ready: true, enabled: isRemoteEnabled() },
    { headers: { "cache-control": "no-store" } },
  );
}

export async function POST(req: NextRequest) {
  if (!isConfiguredAccessToken()) {
    return NextResponse.json({ error: "JARVIS_ACCESS_TOKEN is not configured" }, { status: 503 });
  }
  if (!rateLimit(`auth:${getClientKey(req)}`, 5, 60_000)) {
    return NextResponse.json({ error: "Too many authentication attempts. Try again shortly." }, { status: 429 });
  }

  let body: { token?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!verifyAccessToken(typeof body.token === "string" ? body.token : "")) {
    return NextResponse.json({ error: "Invalid JARVIS access token" }, { status: 401 });
  }

  const session = createUiSession();
  return setSession(
    NextResponse.json(
      { authenticated: true, ready: true, enabled: isRemoteEnabled() },
      { headers: { "cache-control": "no-store" } },
    ),
    session,
  );
}
