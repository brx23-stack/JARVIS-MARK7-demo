import { NextRequest, NextResponse } from "next/server";
import { parseTelegramRequest } from "@/lib/remote/telegram";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const result = await parseTelegramRequest(req);
    if (result.kind === "rejected") {
      console.warn("[remote] webhook rejected:", result.reason);
      return new NextResponse("Rejected", { status: 403 });
    }
    // Telegram only requires a 200 response; the reply (if any) is sent
    // later, asynchronously, once JARVIS has processed the command.
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (error) {
    console.error("[remote] webhook processing failed", error);
    return new NextResponse("Webhook error", { status: 400 });
  }
}
