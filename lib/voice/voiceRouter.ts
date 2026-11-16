// ——— Voice output router ———
//
// Two ways JARVIS speaks:
//   - speak(text)            → always the browser's built-in "speechSynthesis"
//                               voice. Used for every local command response
//                               (theme changes, memory, diagnostics, the API
//                               popup, etc.) so they work with no internet
//                               and no AI provider connected.
//   - speakAIResponse(text)  → tries the optional online TTS provider first
//                               (see onlineTTS.ts / app/api/tts/route.ts) for
//                               AI-generated replies, and transparently falls
//                               back to the same browser voice as speak() if
//                               online TTS isn't configured or fails.
//
// Neither path ever hard-codes a specific voice or language — the browser's
// default voice for the current device is used automatically. Both paths
// share one speech queue so overlapping calls never talk over each other,
// and both are fully asynchronous: synthesis and playback never block the
// UI thread, the orb, the microphone, or hand tracking.

import { synthesizeOnline, checkOnlineTTSConfigured } from "./onlineTTS";
import type { SpeakOptions, VoiceEngine, EngineReadiness } from "./types";
import type { VoiceTone } from "@/app/api/tts/route";

export type { SpeakOptions, VoiceEngine, EngineReadiness } from "./types";
export { checkOnlineTTSConfigured } from "./onlineTTS";

// ——— Readiness (diagnostics) ———
// Reflects the browser voice only — the online engine has no "load" step,
// it's just a fetch per request, so its availability is reported separately
// via checkOnlineTTSConfigured().
let readiness: EngineReadiness = "loading";
const readinessListeners = new Set<(state: EngineReadiness) => void>();
const engineListeners = new Set<(engine: VoiceEngine) => void>();
let voicesReady = false;

function setReadiness(next: EngineReadiness) {
  if (readiness === next) return;
  readiness = next;
  readinessListeners.forEach((cb) => cb(readiness));
}

function notifyEngine(engine: VoiceEngine) {
  engineListeners.forEach((cb) => cb(engine));
}

export function getVoiceEngineStatus(): EngineReadiness {
  return readiness;
}

export function onVoiceReadinessChange(cb: (state: EngineReadiness) => void): () => void {
  readinessListeners.add(cb);
  cb(readiness);
  return () => readinessListeners.delete(cb);
}

export function onVoiceEngineChange(cb: (engine: VoiceEngine) => void): () => void {
  engineListeners.add(cb);
  return () => engineListeners.delete(cb);
}

/**
 * Warms up the browser's voice list. Harmless to call repeatedly or to skip
 * entirely — speak() works even if this never resolves. This just avoids a
 * quirk in some Chromium builds where the very first utterance is spoken
 * before getVoices() has populated, by giving `voiceschanged` a moment to
 * fire first when possible.
 */
export function preloadVoiceEngine(): void {
  if (typeof window === "undefined") return;
  if (!("speechSynthesis" in window)) {
    setReadiness("unavailable");
    return;
  }
  const check = () => {
    if (window.speechSynthesis.getVoices().length > 0) {
      voicesReady = true;
      setReadiness("ready");
    }
  };
  check();
  if (voicesReady) return;
  setReadiness("loading");
  window.speechSynthesis.onvoiceschanged = check;
  // Some browsers (older Android WebViews in particular) never populate
  // getVoices() or fire voiceschanged at all, yet speak() still works fine
  // with an implicit default voice — so a still-empty list after a couple
  // seconds is treated as ready, not as an error.
  setTimeout(() => {
    if (!voicesReady) setReadiness("ready");
  }, 2000);
}

// ——— Playback plumbing shared by both engines ———
let audioEl: HTMLAudioElement | null = null;
let currentUrl: string | null = null;
let activeToken = 0;
let audioUnlocked = false;
let unlockInstalled = false;

function getAudioEl(): HTMLAudioElement {
  if (!audioEl) {
    audioEl = new Audio();
    audioEl.preload = "auto";
  }
  return audioEl;
}

function releaseUrl() {
  if (currentUrl) {
    URL.revokeObjectURL(currentUrl);
    currentUrl = null;
  }
}

// Mobile browsers block audio playback (and sometimes speechSynthesis)
// until the page has seen a user gesture. This installs a one-time
// listener so the first tap/keypress anywhere unlocks audio ahead of the
// first real speak() call, instead of the first AI reply silently failing.
function installAudioUnlock() {
  if (unlockInstalled || typeof window === "undefined") return;
  unlockInstalled = true;
  const unlock = () => {
    audioUnlocked = true;
    window.removeEventListener("pointerdown", unlock);
    window.removeEventListener("touchstart", unlock);
    window.removeEventListener("keydown", unlock);
  };
  window.addEventListener("pointerdown", unlock, { passive: true });
  window.addEventListener("touchstart", unlock, { passive: true });
  window.addEventListener("keydown", unlock);
}

async function waitForAudioUnlock(): Promise<void> {
  if (audioUnlocked || typeof window === "undefined") return;
  installAudioUnlock();
  await new Promise<void>((resolve) => {
    const onUnlock = () => {
      audioUnlocked = true;
      window.removeEventListener("pointerdown", onUnlock);
      window.removeEventListener("touchstart", onUnlock);
      window.removeEventListener("keydown", onUnlock);
      resolve();
    };
    window.addEventListener("pointerdown", onUnlock, { once: true, passive: true });
    window.addEventListener("touchstart", onUnlock, { once: true, passive: true });
    window.addEventListener("keydown", onUnlock, { once: true });
  });
}

export function cancelSpeech(): void {
  activeToken++;
  speechQueue = [];
  if (typeof window !== "undefined" && "speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }
  if (audioEl) {
    audioEl.onended = null;
    audioEl.onerror = null;
    audioEl.pause();
    audioEl.removeAttribute("src");
    audioEl.load();
  }
  releaseUrl();
}

// ——— Speech queue ———
// Ensures local-command speech and AI-response speech never talk over each
// other, regardless of which engine (browser or online) produced them.
type SpeechJob = { token: number; run: (token: number) => Promise<void> };
let speechQueue: SpeechJob[] = [];
let queueRunning = false;

async function drainSpeechQueue() {
  if (queueRunning) return;
  queueRunning = true;
  try {
    while (speechQueue.length) {
      const job = speechQueue.shift()!;
      if (job.token !== activeToken) continue;
      try {
        await job.run(job.token);
      } catch (err) {
        console.error("[voice] speech job failed:", err);
      }
    }
  } finally {
    queueRunning = false;
  }
}

function enqueue(run: (token: number) => Promise<void>): Promise<void> {
  const token = activeToken;
  return new Promise<void>((resolve) => {
    speechQueue.push({
      token,
      run: async (t) => {
        await run(t);
        resolve();
      },
    });
    void drainSpeechQueue();
  });
}

// ——— Browser voice (speechSynthesis) ———
// No voice or language is ever hard-coded here — `new SpeechSynthesisUtterance`
// with no `.voice`/`.lang` override always speaks with the browser/device's
// current default voice, whatever that is on that machine.
function speakWithBrowserVoice(text: string, token: number, opts: SpeakOptions): Promise<void> {
  return new Promise<void>((resolve) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      opts.onEnd?.();
      resolve();
      return;
    }
    if (token !== activeToken) {
      opts.onEnd?.();
      resolve();
      return;
    }

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = opts.rate ?? 1.0;
    utterance.pitch = opts.pitch ?? 0.9;

    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };

    utterance.onstart = () => {
      if (token !== activeToken) return;
      notifyEngine("browser");
      opts.onStart?.();
    };
    utterance.onend = () => {
      opts.onEnd?.();
      finish();
    };
    utterance.onerror = () => {
      opts.onEnd?.();
      finish();
    };

    window.speechSynthesis.speak(utterance);
  });
}

async function playBlob(blob: Blob, token: number, opts: SpeakOptions): Promise<void> {
  if (typeof window === "undefined" || token !== activeToken) {
    opts.onEnd?.();
    return;
  }

  await waitForAudioUnlock();
  if (token !== activeToken) {
    opts.onEnd?.();
    return;
  }

  const audio = getAudioEl();
  releaseUrl();
  const url = URL.createObjectURL(blob);
  currentUrl = url;

  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      audio.onended = null;
      audio.onerror = null;
      if (token === activeToken) releaseUrl();
      opts.onEnd?.();
      resolve();
    };

    audio.onended = finish;
    audio.onerror = finish;
    audio.src = url;
    notifyEngine("online");

    audio.play().then(() => {
      if (token === activeToken) opts.onStart?.();
    }).catch((err) => {
      console.warn("[voice] online audio playback blocked:", err);
      finish();
    });
  });
}

function isLocalOnlyPrivacyMode(): boolean {
  return typeof document !== "undefined" && document.documentElement.dataset.jarvisPrivacyMode === "local_only";
}

/** Always speaks with the browser's default voice. Used for local commands. */
export function speak(text: string, opts: SpeakOptions = {}): Promise<void> {
  if (isLocalOnlyPrivacyMode()) { opts.onEnd?.(); return Promise.resolve(); }
  return enqueue((token) => speakWithBrowserVoice(text, token, opts));
}

/**
 * Speaks an AI-generated reply. Tries the configured online TTS provider
 * first; if it isn't configured or the request fails for any reason, falls
 * back to the same browser voice speak() uses, so the reply is always heard.
 */
export function speakAIResponse(text: string, opts: SpeakOptions = {}, tone: VoiceTone = "neutral"): Promise<void> {
  if (isLocalOnlyPrivacyMode()) { opts.onEnd?.(); return Promise.resolve(); }
  return enqueue(async (token) => {
    try {
      const blob = await synthesizeOnline(text, tone);
      if (token !== activeToken) {
        opts.onEnd?.();
        return;
      }
      await playBlob(blob, token, opts);
    } catch (err) {
      console.warn("[voice] online TTS unavailable, falling back to the browser voice:", err);
      if (token !== activeToken) {
        opts.onEnd?.();
        return;
      }
      await speakWithBrowserVoice(text, token, opts);
    }
  });
}

// Install autoplay-unlock detection without creating or playing audio during startup.
if (typeof window !== "undefined") installAudioUnlock();
