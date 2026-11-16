import { getActiveProvider, getApiKey } from "@/lib/serverKey";
import { recordUsage } from "./cost-tracker";

export type AgentProvider = {
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
};

export type AgentMessage = {
  role: "assistant";
  content: string | null;
  tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>;
};

function buildProvider(name: string): AgentProvider {
  switch (name.toLowerCase()) {
    case "groq": return { name: "groq", baseUrl: "https://api.groq.com/openai/v1", apiKey: getApiKey("groq") || "", model: process.env.GROQ_MODEL || "openai/gpt-oss-120b" };
    case "nvidia": return { name: "nvidia", baseUrl: "https://integrate.api.nvidia.com/v1", apiKey: getApiKey("nvidia") || "", model: process.env.NVIDIA_MODEL || "meta/llama-3.3-70b-instruct" };
    case "gemini": return { name: "gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", apiKey: getApiKey("gemini") || "", model: process.env.GEMINI_MODEL || "gemini-flash-latest" };
    case "openai": return { name: "openai", baseUrl: "https://api.openai.com/v1", apiKey: getApiKey("openai") || "", model: process.env.OPENAI_MODEL || "gpt-5-mini" };
    case "anthropic": return { name: "anthropic", baseUrl: "https://api.anthropic.com/v1", apiKey: getApiKey("anthropic") || "", model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5" };
    case "ollama": return { name: "ollama", baseUrl: process.env.LOCAL_LLM_BASE_URL || "http://localhost:11434/v1", apiKey: process.env.LOCAL_LLM_API_KEY || "not-needed", model: process.env.LOCAL_LLM_MODEL || "llama3.2" };
    default: throw new Error(`Unknown provider "${name}".`);
  }
}

export function getAgentProvider() {
  const active = getActiveProvider();
  return buildProvider(active || process.env.LLM_PROVIDER || "groq");
}

function fallbackProvider(): AgentProvider | null {
  const name = process.env.LLM_FALLBACK_PROVIDER;
  if (!name) return null;
  try { return buildProvider(name); } catch { return null; }
}

export async function agentLLM(
  messages: unknown[],
  options: { role: "planner" | "executor" | "verifier" | "chat"; tools?: any[]; taskId?: string; maxTokens?: number; timeoutMs?: number } ,
): Promise<AgentMessage> {
  const primary = getAgentProvider();
  const providers = [primary, ...(fallbackProvider() ? [fallbackProvider()!] : [])];
  let lastError: unknown = null;

  for (const provider of providers) {
    if (!provider.apiKey) { lastError = new Error(`Missing API key for "${provider.name}".`); continue; }
    const started = Date.now();
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? Number(process.env.JARVIS_AGENT_TIMEOUT_MS || 25000));
      const res = await fetch(`${provider.baseUrl}/chat/completions`, {
        method: "POST",
        signal: controller.signal,
        headers: { "content-type": "application/json", authorization: `Bearer ${provider.apiKey}` },
        body: JSON.stringify({
          model: provider.model,
          messages,
          ...(options.tools?.length ? { tools: options.tools } : {}),
          max_tokens: options.maxTokens ?? 700,
          stream: false,
        }),
      });
      clearTimeout(timeout);
      const raw = await res.text();
      if (!res.ok) {
        lastError = new Error(`${provider.name} HTTP ${res.status}: ${raw.slice(0, 250)}`);
        if (res.status === 401 || res.status === 403) break;
        continue;
      }
      const data = JSON.parse(raw);
      const message = data.choices?.[0]?.message;
      const usage = data.usage ?? {};
      await recordUsage({
        provider: provider.name,
        model: provider.model,
        role: options.role,
        inputTokens: Number(usage.prompt_tokens ?? usage.input_tokens ?? 0),
        outputTokens: Number(usage.completion_tokens ?? usage.output_tokens ?? 0),
        success: true,
        latencyMs: Date.now() - started,
        taskId: options.taskId,
      });
      return {
        role: "assistant",
        content: typeof message?.content === "string" ? message.content : null,
        tool_calls: Array.isArray(message?.tool_calls) ? message.tool_calls : undefined,
      };
    } catch (error) {
      lastError = error;
      await recordUsage({
        provider: provider.name,
        model: provider.model,
        role: options.role,
        inputTokens: 0,
        outputTokens: 0,
        success: false,
        latencyMs: Date.now() - started,
        taskId: options.taskId,
      });
    }
  }
  throw lastError instanceof Error ? lastError : new Error("All agent providers failed.");
}
