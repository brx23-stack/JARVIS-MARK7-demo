/** Runtime privacy policy shared by API routes.
 * `local_only` means the application must use the configured local Ollama
 * endpoint, disable online TTS, and expose only local-memory/time tools.
 * Browser Web Speech recognition is platform-dependent and is NOT certified
 * as on-device by this setting; see docs/PRIVACY.md.
 */
export type PrivacyMode = "standard" | "local_only";

export function getPrivacyMode(): PrivacyMode {
  return process.env.JARVIS_PRIVACY_MODE?.trim().toLowerCase() === "local_only"
    ? "local_only"
    : "standard";
}

export function isLocalOnlyMode(): boolean {
  return getPrivacyMode() === "local_only";
}

export function assertProviderAllowed(provider: string): void {
  if (!isLocalOnlyMode()) return;
  if (provider.toLowerCase() !== "ollama") {
    throw new Error("JARVIS is in local-only mode. Cloud AI providers are blocked.");
  }
  const endpoint = process.env.LOCAL_LLM_BASE_URL || "http://localhost:11434/v1";
  try {
    const url = new URL(endpoint);
    const localHosts = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error();
    if (!localHosts.has(url.hostname.toLowerCase())) throw new Error();
  } catch {
    throw new Error("JARVIS local-only mode requires LOCAL_LLM_BASE_URL to use localhost, 127.0.0.1, or ::1. Remote model endpoints are blocked.");
  }
}

// Device/host control is intentionally excluded from the current MARK 7 release.
// A future controller must use its own architecture and permission boundary.
const OUT_OF_SCOPE_DEVICE_TOOLS = new Set([
  "open_app", "set_system_volume", "media_control", "open_url",
  "browser_control", "screen_ocr", "smart_home_control", "smart_home_status",
]);

export function isToolInCurrentRelease(name: string): boolean {
  return !OUT_OF_SCOPE_DEVICE_TOOLS.has(name) && !name.startsWith("android_");
}

const LOCAL_ONLY_TOOLS = new Set([
  "remember_fact",
  "recall_fact",
  "forget_fact",
  "get_current_time",
]);

export function isToolAllowedInPrivacyMode(name: string): boolean {
  return isToolInCurrentRelease(name) && (!isLocalOnlyMode() || LOCAL_ONLY_TOOLS.has(name));
}

export function filterToolsForPrivacyMode<T extends { function?: { name?: string } }>(tools: T[]): T[] {
  return tools.filter((tool) => isToolAllowedInPrivacyMode(tool.function?.name || ""));
}
