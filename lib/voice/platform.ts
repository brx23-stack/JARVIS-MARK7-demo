// Informational only: used purely to label the diagnostics panel (e.g.
// "PLATFORM: ANDROID"). Nothing in the voice pipeline branches on this —
// the browser's own "speechSynthesis" and speech-recognition APIs are used
// the same way on every platform, which is what makes the same code path
// work unmodified on Windows, Android, and everywhere else a browser runs.

export type DetectedPlatform = "ANDROID" | "IOS" | "WINDOWS" | "MACOS" | "LINUX" | "UNKNOWN";

export function detectPlatform(): DetectedPlatform {
  if (typeof navigator === "undefined") return "UNKNOWN";
  const ua = navigator.userAgent || "";
  if (/android/i.test(ua)) return "ANDROID";
  if (/iphone|ipad|ipod/i.test(ua)) return "IOS";
  if (/windows/i.test(ua)) return "WINDOWS";
  if (/macintosh|mac os x/i.test(ua)) return "MACOS";
  if (/linux/i.test(ua)) return "LINUX";
  return "UNKNOWN";
}
