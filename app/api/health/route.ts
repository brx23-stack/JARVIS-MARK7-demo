import { NextResponse } from "next/server";
export const dynamic = "force-dynamic";

function isTTSConfigured(): boolean {
  const provider = (process.env.TTS_PROVIDER || "").toLowerCase() === "openai" ? "openai" : "elevenlabs";
  return provider === "openai" ? Boolean(process.env.OPENAI_API_KEY) : Boolean(process.env.ELEVENLABS_API_KEY);
}

export async function GET() {
  return NextResponse.json(
    { ok: true, ttsConfigured: isTTSConfigured() },
    { headers: { "cache-control": "no-store" } },
  );
}
