import { getActiveProvider, getApiKey } from "@/lib/serverKey";
import { renderFactsForPrompt } from "@/lib/memory/store";
import { recallLearnedContext, recordLearningEvent } from "@/lib/memory/learning";
import { learnMemory, consolidateHeuristically, searchSemanticMemory, type MemoryCandidate } from "@/lib/memory/consolidation";
import { TOOL_DEFINITIONS } from "@/lib/tools/definitions";
import { executeTool } from "@/lib/tools/execute";
import { NextRequest, NextResponse } from "next/server";
import { requireAccess } from "@/lib/security";
import { isValidUiSession } from "@/lib/remote/gateway";
import { runAutonomousTask, shouldUseAgentMode } from "@/lib/agents/orchestrator";
import { recordUsage } from "@/lib/agents/cost-tracker";
import { assertProviderAllowed, filterToolsForPrivacyMode, isLocalOnlyMode, isToolAllowedInPrivacyMode } from "@/lib/privacy/policy";

// ——— Provider registry ———
// Groq, NVIDIA, Gemini (via its OpenAI-compatible endpoint), Ollama, LM
// Studio, and most others all speak the same OpenAI-style /chat/completions
// format, so switching providers — or adding a new one later — is just
// adding/editing an entry here. No other code changes.
type ProviderConfig = {
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
};

function buildProvider(name: string): ProviderConfig {
  assertProviderAllowed(name);
  switch (name.toLowerCase()) {
    case "groq":
      return {
        name: "groq",
        baseUrl: "https://api.groq.com/openai/v1",
        apiKey: getApiKey("groq") || "",
        // Fast + solid quality. Swap for "llama-3.1-8b-instant" for even
        // lower latency, at some cost to answer quality.
        model: process.env.GROQ_MODEL || "openai/gpt-oss-120b",
      };

    case "nvidia":
      return {
        name: "nvidia",
        baseUrl: "https://integrate.api.nvidia.com/v1",
        apiKey: getApiKey("nvidia") || "",
        model: process.env.NVIDIA_MODEL || "meta/llama-3.3-70b-instruct",
      };

    case "gemini":
      return {
        name: "gemini",
        // Google's OpenAI-compatibility layer for the Gemini API.
        baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
        apiKey: getApiKey("gemini") || "",
        model: process.env.GEMINI_MODEL || "gemini-flash-latest",
      };

    case "openai":
      return {
        name: "openai",
        baseUrl: "https://api.openai.com/v1",
        apiKey: getApiKey("openai") || "",
        model: process.env.OPENAI_MODEL || "gpt-5-mini",
      };

    case "anthropic":
      return {
        name: "anthropic",
        // Anthropic's OpenAI-compatible layer - same Bearer-auth
        // /chat/completions shape as every other provider here.
        baseUrl: "https://api.anthropic.com/v1",
        apiKey: getApiKey("anthropic") || "",
        model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5",
      };

    case "ollama":
      return {
        name: "ollama",
        baseUrl: process.env.LOCAL_LLM_BASE_URL || "http://localhost:11434/v1",
        // Ollama ignores the key but the request shape expects a non-empty one.
        apiKey: process.env.LOCAL_LLM_API_KEY || "not-needed",
        model: process.env.LOCAL_LLM_MODEL || "llama3.2",
      };

    // Add more providers here later, e.g.:
    // case "lmstudio":
    //   return {
    //     name: "lmstudio",
    //     baseUrl: process.env.LOCAL_LLM_BASE_URL || "http://localhost:1234/v1",
    //     apiKey: "not-needed",
    //     model: process.env.LOCAL_LLM_MODEL || "<model loaded in LM Studio>",
    //   };

    default:
      throw new Error(`Unknown provider "${name}" — expected "groq", "nvidia", "gemini", "openai", "anthropic", or "ollama".`);
  }
}

function getPrimaryProvider(): ProviderConfig {
  // Whichever provider currently has a connected, in-memory key wins —
  // that's the one the person entered in the AI CONNECTION popup. Falls
  // back to LLM_PROVIDER (useful for a local Ollama setup with no cloud
  // key at all) when nothing is connected yet.
  if (isLocalOnlyMode()) return buildProvider("ollama");
  const active = getActiveProvider();
  if (active) return buildProvider(active);
  return buildProvider(process.env.LLM_PROVIDER || "groq");
}

// Optional: if the primary provider fails to *connect* (not an auth failure),
// automatically try this one instead. Unset by default — nothing changes
// unless you set LLM_FALLBACK_PROVIDER in .env.local.
function getFallbackProvider(): ProviderConfig | null {
  const name = process.env.LLM_FALLBACK_PROVIDER;
  if (!name || isLocalOnlyMode()) return null;
  try {
    return buildProvider(name);
  } catch {
    return null;
  }
}

const BASE_SYSTEM_PROMPT = `You are JARVIS, a calm, precise voice assistant living inside a
holographic orb interface.
You have persistent local learning memory. Treat recalled memories as prior observations, not guaranteed truth.
Learn from the user's corrections and preferences, and use useful information returned by tools/API calls in future conversations. The local memory may include a connected knowledge graph; use multi-hop relationships to connect entities across memories (for example, person -> project -> feature), while distinguishing explicit facts from uncertain relationships. If newer memory conflicts with an older memory, prefer the active/high-confidence or explicitly corrected memory.
Never claim that memory changed the underlying model weights: your model stays the same, while local memory improves future context. The user is talking to you out loud and your replies will be
read aloud by speech synthesis, so:
- Keep answers short and conversational (1-3 sentences unless asked for more detail).
- Never use markdown, bullet points, code blocks, or emoji — plain spoken sentences only.
- If you don't know something current, use the web_search tool rather than guessing.
- Use remember_fact whenever the user shares something worth recalling later (their
  name, preferences, ongoing projects). Use recall_fact if you need to check a stored
  detail. Don't narrate that you're saving/looking something up — just do it and answer
  naturally.`;

async function buildSystemPrompt(query = ""): Promise<string> {
  const facts = await renderFactsForPrompt();
  const learned = query ? await recallLearnedContext(query) : "";
  const sections = [BASE_SYSTEM_PROMPT];
  if (facts) sections.push(`\nThings you already know about the user, from explicit saved facts:\n${facts}`);
  if (learned) sections.push(`\nRelevant local learning memory from earlier interactions and tool results:\n${learned}\nUse it when relevant, but prefer fresh tool results for current values.`);
  return sections.join("\n");
}

type ChatMessage = { role: "user" | "assistant"; content: string };

// Ask the same model to distill durable knowledge from an experience. This is
// optional and best-effort: if the provider is unavailable, the local
// heuristic consolidator still learns explicit corrections/preferences.
async function consolidateWithModel(provider: ProviderConfig, input: string, output: string, toolResults: { tool: string; result: string }[]) {
  if (process.env.JARVIS_MEMORY_CONSOLIDATION === "false") return 0;
  const evidence = [
    `USER: ${input}`,
    `JARVIS: ${output}`,
    ...toolResults.map((r) => `TOOL ${r.tool}: ${r.result.slice(0, 1800)}`),
  ].join("\n");
  const existing = await searchSemanticMemory(input, 12);
  const known = existing.length
    ? `\nExisting relevant memories (use their exact IDs in supersedes when a new statement clearly replaces one):\n${existing.map(m => `ID=${m.id} [${m.kind}] ${m.text}`).join("\n")}`
    : "";
  const prompt = `You are JARVIS's memory consolidation and knowledge-graph engine. Extract only durable knowledge worth remembering across future conversations. Do not store secrets, API keys, passwords, transient stock/weather prices, or guesses. Corrections and explicit new preferences can supersede older memories, but do not overwrite merely because two statements could both be true in different contexts. Return JSON only with this schema: {"memories":[{"kind":"fact|preference|correction|project|procedure|skill|observation","text":"...","keywords":["..."],"confidence":0.0,"supersedes":["old-memory-id"],"subject":"...","subjectType":"person|project|feature|preference|topic|concept|entity","relation":"WORKS_ON|HAS_FEATURE|PREFERS|USES|KNOWS_ABOUT|PART_OF|DEPENDS_ON|LOCATED_IN|HAS_SKILL|RELATED_TO","object":"...","objectType":"person|project|feature|preference|topic|concept|entity","explicitCorrection":false}]}. Extract graph relationships whenever the evidence supports them. Reuse existing entity names consistently; do not create duplicate names for the same entity when an alias is obvious. A correction should set explicitCorrection=true. When a new statement conflicts with an older single-valued relation, identify the old memory ID in supersedes when available. Relationships can be multi-hop, e.g. person WORKS_ON project and project HAS_FEATURE feature. Use the person's actual name if it is already known in the evidence or existing memory; otherwise use "User". For a project like JARVIS MARK 7, create separate relationships such as person WORKS_ON project and project HAS_FEATURE feature. Keep at most 8 memories. Evidence:\n${evidence}${known}`;
  try {
    const msg = await callProvider(provider, [{ role: "system", content: prompt }, { role: "user", content: "Consolidate this experience." }], false);
    const raw = (msg.content || "").replace(/^```json\s*/i, "").replace(/\s*```$/i, "").trim();
    const parsed = JSON.parse(raw) as { memories?: MemoryCandidate[] };
    if (!Array.isArray(parsed.memories)) return 0;
    let count = 0;
    for (const candidate of parsed.memories.slice(0, 8)) {
      if (await learnMemory({ ...candidate, source: candidate.source || provider.name })) count++;
    }
    return count;
  } catch (err) {
    console.warn("[memory] model consolidation skipped:", err instanceof Error ? err.message : err);
    return 0;
  }
}


// Keep the last 20 messages (~10 exchanges) of context.
const MAX_HISTORY = 20;

const REQUEST_TIMEOUT_MS = 20_000;
const MAX_RETRIES = 2; // total attempts = 1 + MAX_RETRIES, only for transient failures
const MAX_TOOL_ROUNDS = 4; // cap on model→tool→model round-trips per user turn, so a confused model can't loop forever

class ProviderError extends Error {
  status: number;
  retryable: boolean;
  /** True when the failure looks like the model/provider rejecting the
   * `tools` field itself (some local/older models 400 on it) rather than a
   * real auth/rate-limit/server problem — signals the caller to retry once
   * with tools omitted instead of giving up. */
  toolsRejected?: boolean;
  constructor(message: string, status: number, retryable: boolean, toolsRejected?: boolean) {
    super(message);
    this.status = status;
    this.retryable = retryable;
    this.toolsRejected = toolsRejected;
  }
}

type ToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

type AssistantMessage = {
  role: "assistant";
  content: string | null;
  tool_calls?: ToolCall[];
};

// Returns the raw assistant message (content + any tool_calls) rather than
// just text, so callers can run a tool-calling loop. Same retry/backoff/
// error handling as before — only the return shape changed.
async function callProvider(provider: ProviderConfig, messages: unknown[], useTools: boolean): Promise<AssistantMessage> {
  if (!provider.apiKey) {
    throw new ProviderError(
      `Missing API key for "${provider.name}". Connect a cloud provider or start Ollama locally.`,
      500,
      false,
    );
  }

  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const started = Date.now();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const res = await fetch(`${provider.baseUrl}/chat/completions`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${provider.apiKey}`,
        },
        body: JSON.stringify({
          model: provider.model,
          messages,
          ...(useTools ? { tools: filterToolsForPrivacyMode(TOOL_DEFINITIONS) } : {}),
          max_tokens: 400,
          stream: false,
        }),
      });
      clearTimeout(timeout);

      if (!res.ok) {
        const errText = await res.text();
        console.warn(`[${provider.name}] request failed with HTTP ${res.status}`);

        if (res.status === 401 || res.status === 403) {
          throw new ProviderError(
            `"${provider.name}" rejected the API key (${res.status}). Reconnect your API key.`,
            res.status,
            false, // retrying a bad key never helps
          );
        }
        if (res.status === 429) {
          throw new ProviderError(
            `"${provider.name}" is rate-limiting requests (429). Wait a moment and try again.`,
            res.status,
            attempt < MAX_RETRIES, // worth a couple of retries with backoff
          );
        }
        if (res.status >= 500) {
          throw new ProviderError(
            `"${provider.name}" is having server issues (${res.status}).`,
            res.status,
            attempt < MAX_RETRIES,
          );
        }
        // Other 4xx (bad request, model not found, etc.) — not retryable,
        // except: some local/older models 400 specifically because they
        // don't understand the "tools" field. Detect that and let the
        // caller retry once without it instead of failing the whole turn.
        const looksLikeToolRejection =
          useTools && res.status === 400 && /tool|function[_ ]?call/i.test(errText);
        throw new ProviderError(
          `"${provider.name}" returned ${res.status}: ${errText.slice(0, 200)}`,
          res.status,
          false,
          looksLikeToolRejection,
        );
      }

      const data = await res.json();
      const message = data.choices?.[0]?.message;
      const usage = data.usage ?? {};
      await recordUsage({
        provider: provider.name,
        model: provider.model,
        role: "chat",
        inputTokens: Number(usage.prompt_tokens ?? usage.input_tokens ?? 0),
        outputTokens: Number(usage.completion_tokens ?? usage.output_tokens ?? 0),
        success: true,
        latencyMs: Date.now() - started,
      }).catch(() => {});
      return {
        role: "assistant",
        content: typeof message?.content === "string" ? message.content : null,
        tool_calls: Array.isArray(message?.tool_calls) ? message.tool_calls : undefined,
      };
    } catch (err) {
      clearTimeout(timeout);
      await recordUsage({
        provider: provider.name,
        model: provider.model,
        role: "chat",
        inputTokens: 0,
        outputTokens: 0,
        success: false,
        latencyMs: Date.now() - started,
      }).catch(() => {});

      if (err instanceof ProviderError) {
        lastError = err;
        if (!err.retryable) throw err;
      } else if (err instanceof Error && err.name === "AbortError") {
        lastError = new ProviderError(`"${provider.name}" timed out after ${REQUEST_TIMEOUT_MS / 1000}s.`, 504, true);
      } else {
        // Network-level failure (DNS, connection refused, offline, etc.)
        lastError = new ProviderError(
          `Couldn't reach "${provider.name}" at ${provider.baseUrl}. Check your internet connection or that the server is running.`,
          502,
          true,
        );
      }

      if (attempt < MAX_RETRIES) {
        // Short exponential backoff before retrying: ~400ms, ~800ms.
        await new Promise((r) => setTimeout(r, 400 * Math.pow(2, attempt)));
        continue;
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Unknown provider error");
}

export async function POST(req: NextRequest) {
  const auth = requireAccess(req, 60, 60_000, isValidUiSession);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body: { message?: string; history?: ChatMessage[]; agentMode?: boolean; taskId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const message = (body.message ?? "").trim();
  if (!message) {
    return NextResponse.json({ error: "Missing 'message'" }, { status: 400 });
  }

  const history = Array.isArray(body.history) ? body.history.slice(-MAX_HISTORY) : [];

  // Complex requests are upgraded transparently to Planner -> Executor -> QA.
  // Simple conversational turns keep the original single-agent path, so the
  // existing MARK 7 behavior, latency and UI remain unchanged. Clients may
  // force agent mode with { agentMode: true } without changing the UI.
  if (!isLocalOnlyMode() && (body.agentMode === true || (body.agentMode !== false && shouldUseAgentMode(message)))) {
    try {
      const result = await runAutonomousTask(message, typeof body.taskId === "string" ? body.taskId : undefined);
      const heuristicLearned = await consolidateHeuristically(message, result.reply, "agent");
      return NextResponse.json({
        reply: result.reply,
        toolsUsed: [...new Set(result.task.toolsUsed)],
        memoryLearned: heuristicLearned,
        agent: {
          taskId: result.task.id,
          status: result.task.status,
          plan: result.task.plan,
          verification: result.task.verification,
        },
      });
    } catch (error) {
      console.warn("[agent] autonomous path failed; falling back to normal chat:", error);
    }
  }
  const systemPrompt = await buildSystemPrompt(message);
  const messages: unknown[] = [
    { role: "system", content: systemPrompt },
    ...history,
    { role: "user", content: message },
  ];

  let primary: ProviderConfig;
  try {
    primary = getPrimaryProvider();
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Bad LLM_PROVIDER config" },
      { status: 500 },
    );
  }

  // Runs the tool-calling loop against one provider: ask the model, and if
  // it comes back wanting to call tools, execute them, append the results,
  // and ask again — up to MAX_TOOL_ROUNDS times — until it answers in plain
  // text. If the provider/model doesn't understand "tools" at all (some
  // local models 400 on the field), transparently retry that same first
  // call without it so tool-calling is opt-in, never a hard requirement.
  async function runWithTools(provider: ProviderConfig): Promise<{ reply: string; toolsUsed: string[]; toolResults: { tool: string; result: string }[] }> {
    const toolsUsed: string[] = [];
    const toolResults: { tool: string; result: string }[] = [];
    let useTools = true;

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      let assistantMsg;
      try {
        assistantMsg = await callProvider(provider, messages, useTools);
      } catch (err) {
        if (err instanceof ProviderError && err.toolsRejected) {
          // This model doesn't support tool-calling — fall back to a plain
          // request and stop offering tools for the rest of this turn.
          useTools = false;
          assistantMsg = await callProvider(provider, messages, false);
        } else {
          throw err;
        }
      }

      const calls = assistantMsg.tool_calls;
      if (!calls || calls.length === 0) {
        return { reply: assistantMsg.content?.trim() || "I didn't get a response for that.", toolsUsed, toolResults };
      }

      // Model wants to call one or more tools: run each, append the
      // assistant's tool_calls message plus a "tool" result message per
      // call (the shape every OpenAI-compatible provider expects), then
      // loop back and ask again with those results in context.
      messages.push({ role: "assistant", content: assistantMsg.content, tool_calls: calls });
      for (const call of calls) {
        toolsUsed.push(call.function.name);
        const result = isToolAllowedInPrivacyMode(call.function.name)
          ? await executeTool(call.function.name, call.function.arguments)
          : "This tool is disabled by JARVIS local-only privacy mode.";
        toolResults.push({ tool: call.function.name, result });
        // Persist tool/API knowledge immediately. If the provider fails after
        // a successful tool call, the useful result is still retained locally.
        await recordLearningEvent({ kind: "tool_result", tool: call.function.name, output: result, source: provider.name });
        messages.push({ role: "tool", tool_call_id: call.id, content: result });
      }
    }

    // Ran out of rounds (model kept calling tools without settling) — ask
    // one last time with tools disabled to force a plain-text answer.
    const finalMsg = await callProvider(provider, messages, false);
    return { reply: finalMsg.content?.trim() || "I didn't get a response for that.", toolsUsed, toolResults };
  }

  try {
    const { reply, toolsUsed, toolResults } = await runWithTools(primary);
    await recordLearningEvent({ kind: "conversation", input: message, output: reply, source: primary.name });
    const heuristicLearned = await consolidateHeuristically(message, reply, primary.name);
    const modelLearned = await consolidateWithModel(primary, message, reply, toolResults);
    const memoryLearned = heuristicLearned + modelLearned;
    return NextResponse.json(toolsUsed.length ? { reply, toolsUsed, memoryLearned } : { reply, memoryLearned });
  } catch (primaryErr) {
    // Only fall over to a second provider for connection-level failures —
    // never for a bad/rejected key, since that wouldn't be fixed by switching.
    const fallback = getFallbackProvider();
    const primaryMessage = primaryErr instanceof Error ? primaryErr.message : "Unknown error";
    const primaryStatus = primaryErr instanceof ProviderError ? primaryErr.status : 500;

    if (fallback && primaryErr instanceof ProviderError && primaryStatus !== 401 && primaryStatus !== 403) {
      try {
        console.warn(`[${primary.name}] failed, falling back to "${fallback.name}":`, primaryMessage);
        const { reply, toolsUsed, toolResults } = await runWithTools(fallback);
        await recordLearningEvent({ kind: "conversation", input: message, output: reply, source: fallback.name });
        const heuristicLearned = await consolidateHeuristically(message, reply, fallback.name);
        const modelLearned = await consolidateWithModel(fallback, message, reply, toolResults);
        const memoryLearned = heuristicLearned + modelLearned;
        return NextResponse.json(
          toolsUsed.length ? { reply, usedFallback: fallback.name, toolsUsed, memoryLearned } : { reply, usedFallback: fallback.name, memoryLearned },
        );
      } catch (fallbackErr) {
        const fallbackMessage = fallbackErr instanceof Error ? fallbackErr.message : "Unknown error";
        return NextResponse.json(
          { error: `Primary (${primary.name}) failed: ${primaryMessage} — Fallback (${fallback.name}) also failed: ${fallbackMessage}` },
          { status: 502 },
        );
      }
    }

    return NextResponse.json({ error: primaryMessage }, { status: primaryStatus });
  }
}
