// Thin wrapper around the browser's built-in Web Speech (recognition) API.
//
// This is speech-to-text only — it is unrelated to speech OUTPUT
// (see voiceRouter.ts / onlineTTS.ts), and is untouched by that logic.
// Kept as a single implementation so there is never more than one
// microphone stream or recognition instance active at a time.

/* eslint-disable @typescript-eslint/no-explicit-any */

interface MinimalRecognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: any) => void) | null;
  onerror: ((event: any) => void) | null;
  onend: (() => void) | null;
}

function isLocalOnlyPrivacyMode(): boolean {
  return typeof document !== "undefined" && document.documentElement.dataset.jarvisPrivacyMode === "local_only";
}

function getRecognitionCtor(): (new () => MinimalRecognition) | null {
  if (typeof window === "undefined") return null;
  const w = window as any;
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function preferredSpeechLanguage(): string {
  if (typeof navigator === "undefined") return "en-US";
  // Let the device/browser choose its normal speech locale instead of
  // hard-coding en-US. This improves recognition for regional accents and
  // multilingual users while keeping the AI itself language-agnostic.
  const candidates = [navigator.language, ...(navigator.languages ?? [])].filter(Boolean);
  return candidates[0] || "en-US";
}

export function isVoiceSupported(): boolean {
  if (isLocalOnlyPrivacyMode()) return false;
  return (
    typeof window !== "undefined" &&
    getRecognitionCtor() !== null &&
    "speechSynthesis" in window
  );
}

export interface ListenCallbacks {
  /** Called once with the top recognized transcript. `alternatives` holds
   * every ranked guess the recognizer offered (transcript is always
   * alternatives[0]) — callers that care about domain-specific words the
   * top guess might have mangled can consult the rest. */
  onResult: (transcript: string, alternatives: string[]) => void;
  /** Called if recognition fails (permission denied, no speech, etc). */
  onError: (message: string) => void;
  /** Called when listening stops, whether by result, error, or silence timeout. */
  onEnd: () => void;
}

export class VoiceListener {
  private recognition: MinimalRecognition | null = null;
  private finished = false;

  start(callbacks: ListenCallbacks) {
    if (isLocalOnlyPrivacyMode()) {
      callbacks.onError("Voice capture is disabled in local-only mode until a verified local speech engine is configured.");
      return;
    }
    const Ctor = getRecognitionCtor();
    if (!Ctor) {
      callbacks.onError("Speech recognition isn't supported in this browser.");
      return;
    }

    const recognition = new Ctor();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.maxAlternatives = 5;
    recognition.lang = preferredSpeechLanguage();
    this.finished = false;

    recognition.onresult = (event: any) => {
      const result = event.results?.[0];
      const alternatives: string[] = [];
      if (result) {
        for (let i = 0; i < result.length; i++) {
          const t = result[i]?.transcript;
          if (t) alternatives.push(t.trim());
        }
      }
      const transcript = alternatives[0] ?? "";
      this.finished = true;
      callbacks.onResult(transcript, alternatives);
    };

    recognition.onerror = (event: any) => {
      this.finished = true;
      const reason = event?.error === "not-allowed" ? "Microphone access denied" : event?.error || "Speech recognition error";
      callbacks.onError(reason);
    };

    recognition.onend = () => {
      callbacks.onEnd();
    };

    this.recognition = recognition;
    recognition.start();
  }

  stop() {
    if (!this.recognition) return;
    // If nothing was recognized yet, abort() skips firing a result.
    if (this.finished) this.recognition.stop();
    else this.recognition.abort();
    this.recognition = null;
  }
}

// ——— Wake word ("Hey Jarvis") ———
// Matches "hey jarvis" (with an optional comma either side) anywhere in the
// transcript, case-insensitively, and returns whatever was said after it —
// which lets the user say the wake word and the command in one breath.
//
// "Jarvis" isn't a common word in most speech models' training data, so the
// browser frequently mishears it as a similar-sounding real name or phrase.
// The alternation below covers the mishearings that show up repeatedly in
// testing (Chrome/Android and Chrome/desktop). "hey" gets the same
// treatment, since it's often heard as "hay" or "a". This trades a very
// small amount of false-wake risk for a much lower rate of the wake word
// being said correctly but simply not recognized.
const WAKE_REGEX =
  /\b(hey|hay|hi|ay)[,]?\s+(jarvis|jarviss|jervis|jarvis'?s|jarvus|jarvez|garvis|harvis|travis|jarvic|jarvises|jarvish|jarvies|jarvisy)\b[,]?\s*/i;

function matchWakePhrase(text: string): string | null {
  const match = WAKE_REGEX.exec(text);
  if (!match) return null;
  return text.slice(match.index + match[0].length).trim();
}

export interface WakeCallbacks {
  /** Fires once when "Hey Jarvis" is heard. `command` holds any speech that
   * followed it in the same breath — empty if the user paused after the wake word.
   * `alternatives` holds every other ranked guess for that same trailing
   * speech (deduped, `command` included) — useful for callers matching
   * domain-specific words the top guess might have mangled. */
  onWake: (command: string, alternatives: string[]) => void;
  /** Fires only on a real failure (e.g. mic permission denied), not routine silence. */
  onError?: (message: string) => void;
}

/**
 * Keeps the mic open in the background listening only for "Hey Jarvis".
 * Browsers auto-stop continuous recognition after a while, so this restarts
 * itself for as long as it's active. Call stop() to release the mic.
 */
export class WakeWordListener {
  private recognition: MinimalRecognition | null = null;
  private active = false;

  start(callbacks: WakeCallbacks) {
    if (isLocalOnlyPrivacyMode()) {
      callbacks.onError?.("Wake-word listening is disabled in local-only mode until a verified local speech engine is configured.");
      return;
    }
    if (!getRecognitionCtor()) {
      callbacks.onError?.("Speech recognition isn't supported in this browser.");
      return;
    }
    this.active = true;
    this.launch(callbacks);
  }

  private launch(callbacks: WakeCallbacks) {
    const Ctor = getRecognitionCtor();
    if (!Ctor || !this.active) return;

    const recognition = new Ctor();
    recognition.continuous = true;
    // Interim (not-yet-final) results let us react the instant the wake
    // phrase appears, rather than waiting — sometimes several seconds, in
    // continuous mode — for the browser to decide the utterance is over.
    recognition.interimResults = true;
    recognition.maxAlternatives = 5;
    recognition.lang = preferredSpeechLanguage();

    recognition.onresult = (event: any) => {
      // event.resultIndex is where the results *new* to this event start;
      // everything before it was already checked on a previous call.
      const startIndex = event.resultIndex ?? event.results.length - 1;
      for (let i = startIndex; i < event.results.length; i++) {
        const result = event.results[i];
        // Check every alternative, not just the top guess — the wake
        // phrase often shows up in alternative #2 or #3 even when the
        // browser's best guess mangled it. Collect the trailing "command"
        // text from every alternative that does contain the phrase, so the
        // caller can pick whichever one actually names something real.
        let primary: string | null = null;
        const alternatives: string[] = [];
        for (let alt = 0; alt < result.length; alt++) {
          const command = matchWakePhrase(result[alt]?.transcript ?? "");
          if (command !== null) {
            if (primary === null) primary = command;
            if (!alternatives.includes(command)) alternatives.push(command);
          }
        }
        if (primary !== null) {
          this.stop();
          callbacks.onWake(primary, alternatives);
          return;
        }
      }
    };

    recognition.onerror = (event: any) => {
      // "no-speech" / "aborted" happen constantly while idling in the
      // background — only a real permission failure should surface.
      if (event?.error === "not-allowed") {
        this.active = false;
        callbacks.onError?.("Microphone access denied");
      }
    };

    recognition.onend = () => {
      // A short delay here (matching the retry delay below) avoids
      // rapid-fire mic re-acquisition if the browser keeps ending recognition
      // quickly — back-to-back restarts with no gap are what tend to cause
      // visible stutter on Android Chrome.
      if (this.active) setTimeout(() => this.active && this.launch(callbacks), 250);
    };

    this.recognition = recognition;
    try {
      recognition.start();
    } catch {
      setTimeout(() => {
        if (this.active) this.launch(callbacks);
      }, 300);
    }
  }

  stop() {
    this.active = false;
    this.recognition?.abort();
    this.recognition = null;
  }
}
