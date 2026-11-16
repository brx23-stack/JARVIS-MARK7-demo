import { NextRequest, NextResponse } from "next/server";
import { parseDiscordRequest, discordResponse } from "@/lib/remote/discord";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const { result, rawBodyInvalid } = await parseDiscordRequest(req);
    if (rawBodyInvalid) {
      // Discord's docs require a bare 401 (not a JSON interaction response)
      // when signature verification fails.
      console.warn("[remote] webhook rejected:", result.kind === "rejected" ? result.reason : "");
      return new NextResponse("Invalid request signature", { status: 401 });
    }
    if (result.kind === "rejected") {
      console.warn("[remote] webhook rejected:", result.reason);
    }
    return discordResponse(result);
  } catch (error) {
    console.error("[remote] webhook processing failed", error);
    return new NextResponse("Webhook error", { status: 400 });
  }
}
