import { NextRequest, NextResponse } from "next/server";
import { requireAccess } from "@/lib/security";
import { isValidUiSession } from "@/lib/remote/gateway";
import { recordLearningEvent } from "@/lib/memory/learning";

export async function POST(req: NextRequest) {
  const auth = requireAccess(req, 120, 60_000, isValidUiSession);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const body = await req.json();
    const input = typeof body?.input === "string" ? body.input.trim() : "";
    const output = typeof body?.output === "string" ? body.output.trim() : "";
    if (!input) return NextResponse.json({ error: "Missing input" }, { status: 400 });
    await recordLearningEvent({ kind: "conversation", input, output: output || "Local command completed.", source: "local-command" });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Invalid learning event" }, { status: 400 });
  }
}
