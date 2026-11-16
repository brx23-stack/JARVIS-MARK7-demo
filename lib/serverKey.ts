// In-memory provider selection and API-key storage.
// Cloud keys are never written to disk. Ollama needs no API key.

export type ProviderId = "groq" | "nvidia" | "gemini" | "openai" | "anthropic" | "ollama";

export const PROVIDER_IDS: ProviderId[] = ["groq", "nvidia", "gemini", "openai", "anthropic", "ollama"];

export const PROVIDER_LABELS: Record<ProviderId, string> = {
  groq: "Groq",
  nvidia: "NVIDIA",
  gemini: "Gemini",
  openai: "OpenAI",
  anthropic: "Claude",
  ollama: "Ollama",
};

export function isProviderId(value: string): value is ProviderId {
  return (PROVIDER_IDS as string[]).includes(value);
}

const apiKeys: Record<ProviderId, string | null> = {
  groq: null,
  nvidia: null,
  gemini: null,
  openai: null,
  anthropic: null,
  ollama: null,
};

let activeProvider: ProviderId | null = null;

export function getApiKey(provider: ProviderId): string | null {
  if (provider === "ollama") return "not-needed";
  return apiKeys[provider];
}

export function setApiKey(provider: ProviderId, key: string): void {
  apiKeys[provider] = key;
  activeProvider = provider;
}

export function activateProvider(provider: ProviderId): void {
  activeProvider = provider;
}

export function clearApiKey(provider: ProviderId): void {
  apiKeys[provider] = null;
  if (activeProvider === provider) {
    activeProvider = PROVIDER_IDS.find((p) => p === "ollama" || Boolean(apiKeys[p])) ?? null;
  }
}

export function getConfiguredProviders(): ProviderId[] {
  return PROVIDER_IDS.filter((p) => p === "ollama" || Boolean(apiKeys[p]));
}

export function getActiveProvider(): ProviderId | null {
  if (activeProvider === "ollama") return activeProvider;
  if (activeProvider && apiKeys[activeProvider]) return activeProvider;
  activeProvider = PROVIDER_IDS.find((p) => p === "ollama" && process.env.LLM_PROVIDER === "ollama")
    ?? PROVIDER_IDS.find((p) => p !== "ollama" && Boolean(apiKeys[p]))
    ?? null;
  return activeProvider;
}
