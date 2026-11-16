import { NextRequest, NextResponse } from "next/server";
import { requireAccess } from "@/lib/security";
import { isValidUiSession } from "@/lib/remote/gateway";
import { assertProviderAllowed, isLocalOnlyMode } from "@/lib/privacy/policy";
import {
  PROVIDER_IDS,
  type ProviderId,
  clearApiKey,
  getActiveProvider,
  getConfiguredProviders,
  isProviderId,
  setApiKey,
  activateProvider,
} from "@/lib/serverKey";

export const dynamic = "force-dynamic";

// Cloud providers use API-key validation. Ollama is local and is detected
// by probing its OpenAI-compatible endpoint instead.
function chatEndpoint(provider: ProviderId): { url: string; model: string } {
  switch (provider) {
    case "groq":
      return {
        url: "https://api.groq.com/openai/v1/chat/completions",
        model: process.env.GROQ_MODEL || "openai/gpt-oss-120b",
      };
    case "nvidia":
      return {
        url: "https://integrate.api.nvidia.com/v1/chat/completions",
        model: process.env.NVIDIA_MODEL || "meta/llama-3.3-70b-instruct",
      };
    case "gemini":
      return {
        url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
        model: process.env.GEMINI_MODEL || "gemini-flash-latest",
      };
    case "openai":
      return {
        url: "https://api.openai.com/v1/chat/completions",
        model: process.env.OPENAI_MODEL || "gpt-5-mini",
      };
    case "anthropic":
      // Anthropic's OpenAI-compatible layer: same Bearer-auth /chat/completions
      // shape as every other provider here, just pointed at api.anthropic.com.
      return {
        url: "https://api.anthropic.com/v1/chat/completions",
        model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5",
      };
    case "ollama":
      return {
        url: `${process.env.LOCAL_LLM_BASE_URL || "http://localhost:11434/v1"}/chat/completions`,
        model: process.env.LOCAL_LLM_MODEL || "llama3.2",
      };
  }
}

type ValidationResult =
  | { status: "valid" }
  | { status: "invalid"; message: string }
  | { status: "unavailable"; message: string };

async function validateApiKey(provider: ProviderId, key: string): Promise<ValidationResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  const { url, model } = chatEndpoint(provider);

  try {
    // A real, tiny chat request so the UI only reports ONLINE when the
    // configured key can actually complete a chat request.
    const res = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key}`,
      },
      cache: "no-store",
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "Reply with OK." }],
        max_tokens: 8,
        stream: false,
      }),
    });

    if (res.ok) return { status: "valid" };

    // Pull the provider's own error text out instead of hiding it — every
    // provider here uses roughly {"error": {"message": "..."}}. Some
    // (Gemini's OpenAI-compat layer in particular) return 400 for a bad
    // key instead of 401/403, so status code alone isn't reliable; the
    // message text is what actually tells "bad key" apart from "bad
    // model name" or "rate limited".
    let detail = "";
    try {
      const body = await res.json();
      detail = String(body?.error?.message || body?.error || body?.message || "");
    } catch {
      // Non-JSON error body — fall through with an empty detail string.
    }

    const looksLikeKeyProblem =
      res.status === 401 ||
      res.status === 403 ||
      /api key|api_key|unauthorized|authentication|invalid.*key/i.test(detail);

    if (looksLikeKeyProblem) {
      return { status: "invalid", message: detail || "The provider rejected this key." };
    }
    return {
      status: "unavailable",
      message: detail || `Provider returned HTTP ${res.status}.`,
    };
  } catch (err) {
    const timedOut = err instanceof Error && err.name === "AbortError";
    return {
      status: "unavailable",
      message: timedOut ? "Request to the provider timed out." : "Could not reach the provider.",
    };
  } finally {
    clearTimeout(timeout);
  }
}

function parseProvider(value: unknown): ProviderId | null {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!raw) return null;
  return isProviderId(raw) ? raw : null;
}

export async function GET(req: NextRequest) {
  const auth = requireAccess(req, 30, 60_000, isValidUiSession);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const configuredList = getConfiguredProviders();
  const configured = Object.fromEntries(
    PROVIDER_IDS.map((p) => [p, configuredList.includes(p)]),
  ) as Record<ProviderId, boolean>;

  // Ollama is considered configured only when its local endpoint answers.
  let ollamaOnline = false;
  try {
    const base = process.env.LOCAL_LLM_BASE_URL || "http://localhost:11434/v1";
    const res = await fetch(`${base}/models`, { cache: "no-store", signal: AbortSignal.timeout(1500) });
    ollamaOnline = res.ok;
  } catch {
    ollamaOnline = false;
  }
  configured.ollama = ollamaOnline;
  if (isLocalOnlyMode()) {
    for (const provider of PROVIDER_IDS) if (provider !== "ollama") configured[provider] = false;
  }

  return NextResponse.json(
    { configured, active: isLocalOnlyMode() ? "ollama" : getActiveProvider(), ollama: { online: ollamaOnline, model: process.env.LOCAL_LLM_MODEL || "llama3.2" } },
    { headers: { "cache-control": "no-store" } },
  );
}

export async function POST(req: NextRequest) {
  const auth = requireAccess(req, 10, 60_000, isValidUiSession);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  let body: { key?: string; provider?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  // Default to groq for backward compatibility with callers that don't
  // pass a provider yet.
  const provider = parseProvider(body.provider) ?? "groq";
  if (isLocalOnlyMode() && provider !== "ollama") {
    return NextResponse.json({ error: "Cloud provider connections are disabled by local-only privacy mode." }, { status: 403 });
  }
  try { assertProviderAllowed(provider); } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Provider blocked by privacy policy." }, { status: 403 });
  }

  // Ollama has no API key. A POST with no key simply probes and activates it.
  if (provider === "ollama") {
    const result = await validateApiKey(provider, "not-needed");
    if (result.status !== "valid") {
      return NextResponse.json(
        { error: `OLLAMA UNAVAILABLE — ${result.message}` },
        { status: 502 },
      );
    }
    activateProvider("ollama");
    return NextResponse.json(
      { connected: true, provider: "ollama", active: getActiveProvider() },
      { headers: { "cache-control": "no-store" } },
    );
  }

  const key = typeof body.key === "string" ? body.key.trim() : "";
  if (!key) return NextResponse.json({ error: "INVALID API KEY" }, { status: 400 });

  const result = await validateApiKey(provider, key);
  if (result.status === "invalid") {
    return NextResponse.json({ error: `INVALID API KEY — ${result.message}` }, { status: 401 });
  }

  // "unavailable" means the validation probe itself didn't complete
  // (timeout, DNS/network blip, transient 5xx from the provider) - it does
  // NOT mean the key is wrong. Previously that case returned an error and
  // refused to save the key, which meant one flaky round-trip made the
  // connection look broken for every provider even with a perfectly good
  // key. Now: save the key regardless, and let the first real /api/chat
  // call surface a concrete error if the key actually turns out to be bad.
  setApiKey(provider, key);
  return NextResponse.json(
    {
      connected: true,
      provider,
      active: getActiveProvider(),
      warning: result.status === "unavailable" ? result.message : undefined,
    },
    { headers: { "cache-control": "no-store" } },
  );
}

export async function DELETE(req: NextRequest) {
  const auth = requireAccess(req, 10, 60_000, isValidUiSession);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  let body: { provider?: string } = {};
  try {
    body = await req.json();
  } catch {
    // DELETE is often called with no body — fall through to the default below.
  }

  const provider = parseProvider(body.provider) ?? getActiveProvider();
  if (!provider) {
    return NextResponse.json({ error: "No provider connected" }, { status: 400 });
  }

  clearApiKey(provider);
  return NextResponse.json(
    { connected: false, provider, active: getActiveProvider() },
    { headers: { "cache-control": "no-store" } },
  );
}
