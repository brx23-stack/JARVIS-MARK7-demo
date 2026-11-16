import { NextRequest, NextResponse } from "next/server";
import { requireAccess } from "@/lib/security";
import { isValidUiSession } from "@/lib/remote/gateway";
import { androidStatus, armAndroid, bridgeFetch, disarmAndroid } from "@/lib/agents/androidTools";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const a = requireAccess(req, 30, 60_000, isValidUiSession);
  if (!a.ok) return NextResponse.json({ error: a.error }, { status: a.status });
  if (process.env.JARVIS_EXPERIMENTAL_DEVICE_CONTROL !== "true" || process.env.ANDROID_HANDS_ENABLED !== "true") return NextResponse.json({ error: "Android control is excluded from the current MARK 7 release." }, { status: 410 });
  return NextResponse.json(androidStatus());
}

// POST {action: "arm"|"disarm"|"kill"|"resume", minutes?}. UI session only, so remote chat can't arm it.
export async function POST(req: NextRequest) {
  const a = requireAccess(req, 20, 60_000, isValidUiSession);
  if (!a.ok) return NextResponse.json({ error: a.error }, { status: a.status });
  if (process.env.JARVIS_EXPERIMENTAL_DEVICE_CONTROL !== "true" || process.env.ANDROID_HANDS_ENABLED !== "true") return NextResponse.json({ error: "Android control is excluded from the current MARK 7 release." }, { status: 410 });
  const body = await req.json().catch(() => ({}));
  switch (body?.action) {
    case "arm": return NextResponse.json(armAndroid(Number(body.minutes) || 10));
    case "disarm": return NextResponse.json(disarmAndroid());
    case "kill": {
      const st = disarmAndroid();
      await bridgeFetch("/kill", {}, 5_000).catch(() => {});
      return NextResponse.json(st);
    }
    case "resume": await bridgeFetch("/resume", {}, 5_000).catch(() => {}); return NextResponse.json(androidStatus());
    default: return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  }
}
