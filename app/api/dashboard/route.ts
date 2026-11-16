import { NextRequest, NextResponse } from "next/server";
import { requireAccess } from "@/lib/security";
import { isValidUiSession } from "@/lib/remote/gateway";
import { buildSnapshot } from "@/lib/dashboard/snapshot";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = requireAccess(req, 120, 60_000, isValidUiSession);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    return NextResponse.json(await buildSnapshot(), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Dashboard failed." }, { status: 500 });
  }
}
