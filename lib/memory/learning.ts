// JARVIS learning memory
//
// This is deliberately local and provider-independent. Every non-secret turn
// can be recorded with its input, JARVIS's answer, and the results returned by
// tools/API calls. The records remain on this machine even when the answer
// came from Groq, NVIDIA, Gemini, etc.
//
// This is memory, not model retraining: the LLM is given relevant memories on
// later turns so it can behave as if it remembers what it learned.

import { promises as fs } from "fs";
import path from "path";
import { renderSemanticMemory } from "./consolidation";
import { renderGraphContext } from "./graph";

const DATA_DIR = path.join(process.cwd(), "data");
const LEARNING_FILE = path.join(DATA_DIR, "learning.jsonl");
const MAX_EVENT_CHARS = 5000;
const MAX_SEARCH_RESULTS = 8;
const MAX_MEMORY_CONTEXT_CHARS = 9000;

export type LearningEvent = {
  id: string;
  kind: "conversation" | "tool_result";
  createdAt: string;
  input?: string;
  output?: string;
  tool?: string;
  source?: string;
};

let writeQueue: Promise<unknown> = Promise.resolve();

function redactSecrets(text: string): string {
  return text
    .replace(/\b(sk-[A-Za-z0-9_-]{12,})\b/g, "[REDACTED_API_KEY]")
    .replace(/\b(gsk_[A-Za-z0-9_-]{12,})\b/g, "[REDACTED_API_KEY]")
    .replace(/\bAIza[0-9A-Za-z_-]{20,}\b/g, "[REDACTED_API_KEY]")
    .replace(/\b(password|passcode|token|secret|api\s*key)\s*[:=]\s*\S+/gi, "$1: [REDACTED]");
}

function clip(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return redactSecrets(value).slice(0, MAX_EVENT_CHARS);
}

async function ensureFile() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try { await fs.access(LEARNING_FILE); }
  catch { await fs.writeFile(LEARNING_FILE, "", "utf8"); }
}

export async function recordLearningEvent(event: Omit<LearningEvent, "id" | "createdAt">): Promise<void> {
  await ensureFile();
  const full: LearningEvent = {
    ...event,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    createdAt: new Date().toISOString(),
    input: clip(event.input),
    output: clip(event.output),
    tool: event.tool?.slice(0, 120),
    source: event.source?.slice(0, 120),
  };
  writeQueue = writeQueue.then(() => fs.appendFile(LEARNING_FILE, JSON.stringify(full) + "\n", "utf8"));
  await writeQueue;
}

async function readEvents(): Promise<LearningEvent[]> {
  await ensureFile();
  const raw = await fs.readFile(LEARNING_FILE, "utf8");
  const events: LearningEvent[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const item = JSON.parse(line);
      if (item && typeof item === "object") events.push(item as LearningEvent);
    } catch {
      // Ignore a damaged line instead of losing the rest of memory.
    }
  }
  return events;
}

function tokens(text: string): string[] {
  return text.toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3)
    .slice(0, 80);
}

/** Retrieves memories that are lexically related to the current input. */
export async function recallLearnedContext(query: string): Promise<string> {
  const events = await readEvents();
  const q = new Set(tokens(query));
  if (!q.size) return "";

  const scored = events.map((event, index) => {
    const text = `${event.input ?? ""} ${event.output ?? ""} ${event.tool ?? ""}`;
    const t = new Set(tokens(text));
    let overlap = 0;
    for (const word of q) if (t.has(word)) overlap++;
    // Recency is a small tie-breaker, not a substitute for relevance.
    const recency = Math.min(1, index / Math.max(1, events.length));
    return { event, score: overlap * 10 + recency };
  })
    .filter((x) => x.score >= 10)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_SEARCH_RESULTS);

  let context = "";
  const semantic = await renderSemanticMemory(query);
  if (semantic) {
    context += `Long-term consolidated knowledge:\n${semantic}\n`;
  }
  const graph = await renderGraphContext(query);
  if (graph) {
    context += `${graph}\n`;
  }
  if (!scored.length) return context.trim();
  for (const { event } of scored) {
    const line = event.kind === "tool_result"
      ? `- Tool result (${event.tool ?? "unknown"}): ${event.output ?? ""}`
      : `- Earlier interaction: User: ${event.input ?? ""} | JARVIS: ${event.output ?? ""}`;
    if (context.length + line.length + 1 > MAX_MEMORY_CONTEXT_CHARS) break;
    context += line + "\n";
  }
  return context.trim();
}

export async function learningStats() {
  const events = await readEvents();
  return { events: events.length, file: LEARNING_FILE };
}
