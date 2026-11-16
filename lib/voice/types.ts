// Shared types for the voice architecture (speech recognition + speech
// output). Kept in one place so speechRecognition.ts, onlineTTS.ts, and
// voiceRouter.ts agree on shape without importing from each other.

export type VoiceEngine = "online" | "browser";
export type EngineReadiness = "loading" | "ready" | "unavailable";

export interface SpeakOptions {
  /** Speech rate. Only applies to the browser voice — ignored by online TTS. */
  rate?: number;
  /** Speech pitch. Only applies to the browser voice — ignored by online TTS. */
  pitch?: number;
  onStart?: () => void;
  onEnd?: () => void;
}
