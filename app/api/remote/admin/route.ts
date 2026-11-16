import { NextRequest, NextResponse } from "next/server";
import { isRemoteEnabled, publicRemoteStatus, setRemoteEnabled, verifyAdminToken } from "@/lib/remote/gateway";

export const dynamic = "force-dynamic";

function authorized(req: NextRequest): boolean {
  return verifyAdminToken(req.headers.get("x-jarvis-admin-token") || "");
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ ...publicRemoteStatus(), enabled: isRemoteEnabled() }, {
    headers: { "cache-control": "no-store" },
  });
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let body: { enabled?: boolean };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (typeof body.enabled !== "boolean") return NextResponse.json({ error: "enabled must be boolean" }, { status: 400 });
  setRemoteEnabled(body.enabled);
  return NextResponse.json({ enabled: isRemoteEnabled() }, { headers: { "cache-control": "no-store" } });
}
