// Online text-to-speech: used only for AI-generated responses.
//
// This module never holds, sees, or sends any TTS provider API key — it
// just POSTs plain text to our own server route (/api/tts), which is the
// only place credentials live (see app/api/tts/route.ts). If that request
// fails for any reason — offline, provider outage, timeout, missing
// server-side key, nothing configured at all — the caller (voiceRouter)
// falls back to the browser's built-in "speechSynthesis" voice, so an AI
// reply is always spoken by *something*.

import type { VoiceTone } from "@/app/api/tts/route";

const REQUEST_TIMEOUT_MS = 15_000;

/** Synthesizes speech via the configured online provider. Throws on any failure. */
export async function synthesizeOnline(text: string, tone: VoiceTone = "neutral"): Promise<Blob> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch("/api/tts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, tone }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      throw new Error(data?.error || `Online TTS request failed (${res.status})`);
    }
    return await res.blob();
  } finally {
    clearTimeout(timeout);
  }
}

/** Cheap server round-trip to check whether an online TTS provider is configured — used by diagnostics. */
export async function checkOnlineTTSConfigured(): Promise<boolean> {
  try {
    const res = await fetch("/api/health", { cache: "no-store" });
    const data = await res.json();
    return Boolean(data?.ttsConfigured);
  } catch {
    return false;
  }
}
