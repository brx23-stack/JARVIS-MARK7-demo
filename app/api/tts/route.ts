import { NextRequest, NextResponse } from "next/server";
import { requireAccess } from "@/lib/security";
import { isValidUiSession } from "@/lib/remote/gateway";
import { isLocalOnlyMode } from "@/lib/privacy/policy";

// ——— Online TTS provider (optional upgrade for spoken AI replies) ———
// Same shape as app/api/chat/route.ts's provider registry: pick a provider
// by env var, keep its credential server-side only, never send it to the
// browser. This route is the ONLY place an online-TTS API key is read.
//
// This is entirely optional. If it isn't configured (or a request to it
// fails for any reason — offline, provider outage, timeout, missing key),
// the browser falls back to the built-in "speechSynthesis" voice, so a
// spoken reply is never blocked on this route. Local commands never call
// this route at all — they always speak with the browser's default voice.
//
// Unlike the chat providers (which are entered live via the AI CONNECTION
// popup), the TTS key is configured once in .env.local — see .env.example.
// That keeps this optional feature from needing a second settings surface.

export const dynamic = "force-dynamic";

const REQUEST_TIMEOUT_MS = 15_000;
// AI replies are already constrained to short spoken sentences by the chat
// route's system prompt — this is just a hard safety cap, not a target.
const MAX_TTS_CHARS = 2000;

type TTSProvider = "elevenlabs" | "openai";
export type VoiceTone = "neutral" | "urgent" | "calm";

function isVoiceTone(value: unknown): value is VoiceTone {
  return value === "neutral" || value === "urgent" || value === "calm";
}

function getProvider(): TTSProvider {
  return (process.env.TTS_PROVIDER || "").toLowerCase() === "openai" ? "openai" : "elevenlabs";
}

function isConfigured(provider: TTSProvider): boolean {
  return provider === "openai" ? Boolean(process.env.OPENAI_API_KEY) : Boolean(process.env.ELEVENLABS_API_KEY);
}

async function synthesizeElevenLabs(text: string, tone: VoiceTone): Promise<ArrayBuffer> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error("ELEVENLABS_API_KEY is not set");

  // "Rachel" — one of ElevenLabs' default premade voices. Override with any
  // voice ID from your ElevenLabs account (a custom/cloned voice included).
  const voiceId = process.env.ELEVENLABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM";
  const model = process.env.ELEVENLABS_MODEL || "eleven_turbo_v2_5";

  // Tone → voice_settings. Higher stability reads as calmer/steadier;
  // lower stability lets more expressive variation through, which reads as
  // more urgent/alert. Kept as a small, deliberately narrow adjustment —
  // this is a nudge, not a full emotional performance.
  const voiceSettings: Record<VoiceTone, { stability: number; similarity_boost: number }> = {
    neutral: { stability: 0.5, similarity_boost: 0.75 },
    urgent: { stability: 0.3, similarity_boost: 0.8 },
    calm: { stability: 0.7, similarity_boost: 0.7 },
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        accept: "audio/mpeg",
        "xi-api-key": apiKey,
      },
      body: JSON.stringify({
        text,
        model_id: model,
        voice_settings: voiceSettings[tone],
      }),
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`ElevenLabs returned ${res.status}: ${errText.slice(0, 200)}`);
    }
    return await res.arrayBuffer();
  } finally {
    clearTimeout(timeout);
  }
}

async function synthesizeOpenAI(text: string, tone: VoiceTone): Promise<ArrayBuffer> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");

  // "onyx" — a deep, even male voice, a reasonable JARVIS-ish default.
  const voice = process.env.OPENAI_TTS_VOICE || "onyx";
  const model = process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts";

  // gpt-4o-mini-tts supports a free-text "instructions" field steering
  // delivery style — a more direct lever than ElevenLabs' numeric knobs.
  const instructions: Record<VoiceTone, string> = {
    neutral: "Speak in a calm, precise, even tone.",
    urgent: "Speak with a clear sense of urgency and alertness, but stay controlled — not panicked.",
    calm: "Speak slowly and reassuringly, very calm and measured.",
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model, voice, input: text, response_format: "mp3", instructions: instructions[tone] }),
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`OpenAI TTS returned ${res.status}: ${errText.slice(0, 200)}`);
    }
    return await res.arrayBuffer();
  } finally {
    clearTimeout(timeout);
  }
}

export async function POST(req: NextRequest) {
  const auth = requireAccess(req, 10, 60_000, isValidUiSession);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body: { text?: string; tone?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (isLocalOnlyMode()) {
    return NextResponse.json({ error: "Online TTS is disabled by local-only privacy mode. Use a verified local speech engine or the operating-system voice." }, { status: 403 });
  }

  const text = (body.text ?? "").trim().slice(0, MAX_TTS_CHARS);
  if (!text) {
    return NextResponse.json({ error: "Missing 'text'" }, { status: 400 });
  }

  // Tone is normally supplied by the caller (JarvisOrb classifies it from
  // the reply text/context — see estimateTone in JarvisOrb.tsx). This is
  // just a safety-net default if it's omitted or malformed.
  const tone: VoiceTone = isVoiceTone(body.tone) ? body.tone : "neutral";

  const provider = getProvider();
  if (!isConfigured(provider)) {
    return NextResponse.json(
      {
        error: `Online TTS is not configured (missing ${
          provider === "openai" ? "OPENAI_API_KEY" : "ELEVENLABS_API_KEY"
        } in the server environment). The browser's default voice will be used instead.`,
      },
      { status: 503 },
    );
  }

  try {
    const audio = provider === "openai" ? await synthesizeOpenAI(text, tone) : await synthesizeElevenLabs(text, tone);
    return new NextResponse(audio, {
      headers: {
        "content-type": "audio/mpeg",
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Online TTS request failed";
    console.warn("[tts]", message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
