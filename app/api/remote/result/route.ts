import { NextRequest, NextResponse } from "next/server";
import { deliverRemoteResult, finishClaimedCommand, isValidUiSession, ownsClaimedCommand } from "@/lib/remote/gateway";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  // Only a browser with a same-origin, HttpOnly UI session can submit a
  // result. Provider secrets remain server-side.
  if (!isValidUiSession(req.cookies.get("jarvis_remote_ui")?.value)) {
    return NextResponse.json({ error: "Remote UI session required" }, { status: 401 });
  }
  let body: { id?: string; source?: string; reply?: string; ok?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const id = typeof body.id === "string" ? body.id : "";
  const source = body.source;
  const reply = typeof body.reply === "string" ? body.reply.trim().slice(0, 1500) : "";
  const session = req.cookies.get("jarvis_remote_ui")?.value;
  if (!id || !reply || !["TELEGRAM", "DISCORD"].includes(String(source)) || !session || !ownsClaimedCommand(id, session, source as "TELEGRAM" | "DISCORD")) {
    return NextResponse.json({ error: "Invalid remote result" }, { status: 400 });
  }

  try {
    await deliverRemoteResult({
      id,
      source: source as "TELEGRAM" | "DISCORD",
      reply,
      ok: body.ok !== false,
    });
    finishClaimedCommand(id, session);
    return NextResponse.json({ delivered: true }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    console.error("[remote] result delivery failed", { id, source, error: String(error).slice(0, 180) });
    return NextResponse.json({ delivered: false }, { status: 502 });
  }
}
