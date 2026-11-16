import { NextRequest, NextResponse } from "next/server";
import { requireAccess } from "@/lib/security";
import { isValidUiSession } from "@/lib/remote/gateway";
import { decideApproval, pendingApprovals } from "@/lib/approvals/queue";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = requireAccess(req, 60, 60_000, isValidUiSession);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  return NextResponse.json({ approvals: pendingApprovals() });
}

// Only the authenticated owner UI can approve. Telegram/Discord can request a tool, never approve it.
export async function POST(req: NextRequest) {
  const auth = requireAccess(req, 30, 60_000, isValidUiSession);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const body = await req.json().catch(() => ({}));
  const id = typeof body.id === "string" ? body.id : "";
  const action = body.action === "approve" ? true : body.action === "reject" ? false : null;
  if (!id || action === null) return NextResponse.json({ error: "Need id and action approve|reject." }, { status: 400 });
  try {
    return NextResponse.json({ status: await decideApproval(id, action) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed." }, { status: 400 });
  }
}
