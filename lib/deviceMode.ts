// Device-mode detection and fullscreen helpers for JARVIS MARK 7 Desktop Mode.
//
// The mode is resolved once, from the underlying platform — never from
// viewport width. That means resizing a desktop browser window down to a
// narrow width doesn't flip JARVIS into mobile behavior, and rotating a
// phone to landscape doesn't flip it into desktop behavior. Android/mobile
// keeps behaving exactly as it did before this feature existed.

export type DeviceMode = "desktop" | "mobile";

interface UserAgentDataLike {
  mobile?: boolean;
}

/**
 * Detects whether JARVIS is running on a desktop PC (Windows/macOS/Linux
 * browser) vs. a mobile/touch-first OS (Android, iOS/iPadOS).
 */
export function detectDeviceMode(): DeviceMode {
  if (typeof navigator === "undefined") return "desktop";

  // Chromium's User-Agent Client Hints (Chrome/Edge — exactly the browsers
  // this feature targets on Windows 10/11) report this directly and
  // reliably, independent of window size.
  const uaData = (navigator as Navigator & { userAgentData?: UserAgentDataLike })
    .userAgentData;
  if (uaData && typeof uaData.mobile === "boolean") {
    return uaData.mobile ? "mobile" : "desktop";
  }

  // Fallback for browsers without UA-CH (e.g. Firefox on desktop/Android).
  const ua = navigator.userAgent || "";
  const isMobileUA = /Android|iPhone|iPod|IEMobile|Windows Phone|BlackBerry|Opera Mini/i.test(
    ua,
  );
  // iPadOS identifies as "Macintosh" but exposes multi-touch — treat that
  // combination as mobile too, since it's a touch-first tablet, not a PC.
  const isTouchTablet = /Macintosh/i.test(ua) && (navigator.maxTouchPoints ?? 0) > 1;

  return isMobileUA || isTouchTablet ? "mobile" : "desktop";
}

export function isFullscreenSupported(): boolean {
  return typeof document !== "undefined" && Boolean(document.fullscreenEnabled);
}

export function isFullscreenActive(): boolean {
  return typeof document !== "undefined" && document.fullscreenElement !== null;
}

/** Toggles fullscreen on the whole app. Fails silently if denied/unsupported. */
export async function toggleFullscreen(): Promise<void> {
  if (typeof document === "undefined") return;
  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else {
      await document.documentElement.requestFullscreen();
    }
  } catch {
    // No user gesture, browser denial, or lack of support — the HUD simply
    // won't flip to "EXIT FULLSCREEN" and the app keeps working normally.
  }
}
