import { NextRequest, NextResponse } from "next/server";
import { requireAccess } from "@/lib/security";
import { isValidUiSession } from "@/lib/remote/gateway";
import { isLocalOnlyMode } from "@/lib/privacy/policy";
import { listIntegrations, testIntegration } from "@/lib/system/integrations";

export const dynamic = "force-dynamic";

// GET  -> every integration, whether it is configured, and which env vars are missing (names only, never values).
// POST -> { id } runs one live test for that integration.
export async function GET(req: NextRequest) {
  const auth = requireAccess(req, 60, 60_000, isValidUiSession);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  return NextResponse.json({ integrations: listIntegrations() });
}

export async function POST(req: NextRequest) {
  const auth = requireAccess(req, 10, 60_000, isValidUiSession);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (isLocalOnlyMode()) return NextResponse.json({ error: "External integration tests are disabled by local-only privacy mode." }, { status: 403 });
  const body: { id?: unknown } = await req.json().catch(() => ({}));
  const id = typeof body.id === "string" ? body.id : "";
  const result = await testIntegration(id);
  if (!result) return NextResponse.json({ error: "Unknown integration." }, { status: 400 });
  return NextResponse.json({ result });
}
