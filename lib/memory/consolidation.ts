// JARVIS long-term memory consolidation.
//
// Episodic memory records what happened. Semantic memory stores durable,
// reusable knowledge distilled from those experiences. Consolidation is
// provider-independent: the LLM may propose memories, but the final write
// happens locally and never changes model weights.

import { promises as fs } from "fs";
import path from "path";
import { rememberFact } from "./store";
import { upsertRelation, supersedeRelation, mergeDuplicateNodes } from "./graph";

const DATA_DIR = path.join(process.cwd(), "data");
const SEMANTIC_FILE = path.join(DATA_DIR, "semantic-memory.json");
const MAX_TEXT = 1200;

export type MemoryKind =
  | "fact"
  | "preference"
  | "correction"
  | "project"
  | "procedure"
  | "skill"
  | "observation";

export type SemanticMemory = {
  id: string;
  kind: MemoryKind;
  text: string;
  keywords: string[];
  confidence: number;
  createdAt: string;
  updatedAt: string;
  uses: number;
  source: string;
  supersedes?: string[];
  state?: "active" | "superseded" | "uncertain";
  subject?: string;
  subjectType?: "person" | "project" | "feature" | "preference" | "topic" | "concept" | "entity";
  relation?: string;
  object?: string;
  objectType?: "person" | "project" | "feature" | "preference" | "topic" | "concept" | "entity";
};

type SemanticFile = SemanticMemory[];

let writeQueue: Promise<unknown> = Promise.resolve();

async function readAll(): Promise<SemanticFile> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    const raw = await fs.readFile(SEMANTIC_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeAll(data: SemanticFile): Promise<void> {
  writeQueue = writeQueue.then(async () => {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const tmp = `${SEMANTIC_FILE}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(data, null, 2), "utf8");
    await fs.rename(tmp, SEMANTIC_FILE);
  });
  await writeQueue;
}

function cleanText(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, MAX_TEXT);
}

function normalizeKeywords(words: unknown): string[] {
  if (!Array.isArray(words)) return [];
  return [...new Set(words
    .filter((x): x is string => typeof x === "string")
    .map((x) => x.toLowerCase().replace(/[^\p{L}\p{N}_-]+/gu, "").slice(0, 40))
    .filter((x) => x.length >= 2))].slice(0, 12);
}

function similarity(a: SemanticMemory, b: { text: string; keywords?: string[] }): number {
  const wordsA = new Set(`${a.text} ${a.keywords.join(" ")}`.toLowerCase().split(/\W+/).filter(Boolean));
  const wordsB = new Set(`${b.text} ${(b.keywords ?? []).join(" ")}`.toLowerCase().split(/\W+/).filter(Boolean));
  let common = 0;
  for (const word of wordsB) if (wordsA.has(word)) common++;
  return common / Math.max(1, Math.min(wordsA.size, wordsB.size));
}

function sameTriple(a: SemanticMemory, b: MemoryCandidate): boolean {
  return Boolean(
    a.subject && b.subject && a.relation && b.relation && a.object && b.object &&
    a.subject.toLowerCase().trim() === b.subject.toLowerCase().trim() &&
    a.relation.toUpperCase().trim() === b.relation.toUpperCase().trim() &&
    a.object.toLowerCase().trim() === b.object.toLowerCase().trim()
  );
}

function conflictsWith(a: SemanticMemory, b: MemoryCandidate): boolean {
  return Boolean(
    a.subject && b.subject && a.relation && b.relation && a.object && b.object &&
    a.subject.toLowerCase().trim() === b.subject.toLowerCase().trim() &&
    a.relation.toUpperCase().trim() === b.relation.toUpperCase().trim() &&
    a.object.toLowerCase().trim() !== b.object.toLowerCase().trim()
  );
}

export type MemoryCandidate = {
  kind?: MemoryKind;
  text?: string;
  keywords?: string[];
  confidence?: number;
  source?: string;
  supersedes?: string[];
  subject?: string;
  subjectType?: "person" | "project" | "feature" | "preference" | "topic" | "concept" | "entity";
  relation?: string;
  object?: string;
  objectType?: "person" | "project" | "feature" | "preference" | "topic" | "concept" | "entity";
  explicitCorrection?: boolean;
};

/** Adds/reinforces durable memory, updates the knowledge graph, and resolves conflicts. */
export async function learnMemory(candidate: MemoryCandidate): Promise<SemanticMemory | null> {
  const text = typeof candidate.text === "string" ? cleanText(candidate.text) : "";
  if (text.length < 4) return null;

  const kind: MemoryKind = ["fact", "preference", "correction", "project", "procedure", "skill", "observation"].includes(candidate.kind ?? "")
    ? candidate.kind as MemoryKind : "fact";
  const confidence = Math.max(0, Math.min(1, Number(candidate.confidence ?? 0.7)));
  const keywords = normalizeKeywords(candidate.keywords);
  const source = cleanText(candidate.source || "experience").slice(0, 100);
  const data = await readAll();
  const now = new Date().toISOString();

  // Resolve explicit supersession first. Then automatically find older memories
  // describing the same subject+relation. This means a correction does not
  // require the model to know the old memory ID in advance.
  const oldIds = new Set((candidate.supersedes ?? []).filter(Boolean).slice(0, 8));
  for (const old of data) {
    if (oldIds.has(old.id)) {
      old.state = "superseded";
      old.confidence = Math.min(old.confidence, 0.25);
      old.updatedAt = now;
      await supersedeRelation(old.id);
    }
  }

  for (const old of data) {
    if (!conflictsWith(old, candidate) || old.state === "superseded") continue;
    const explicit = Boolean(candidate.explicitCorrection) || kind === "correction" || kind === "preference";
    if (explicit || confidence >= old.confidence + 0.05) {
      old.state = "superseded";
      old.supersedes = [...(old.supersedes ?? []), `pending:${text.slice(0, 80)}`].slice(-8);
      old.confidence = Math.min(old.confidence, 0.25);
      old.updatedAt = now;
      await supersedeRelation(old.id);
      oldIds.add(old.id);
    } else {
      old.state = "uncertain";
      old.updatedAt = now;
    }
  }

  const existing = data.find((m) =>
    (sameTriple(m, candidate) || (m.kind === kind && similarity(m, { text, keywords }) >= 0.72)) &&
    m.state !== "superseded"
  );
  let memory: SemanticMemory;
  if (existing) {
    existing.text = text;
    existing.keywords = [...new Set([...existing.keywords, ...keywords])].slice(0, 16);
    existing.confidence = Math.max(existing.confidence, confidence);
    existing.state = "active";
    existing.updatedAt = now;
    existing.uses += 1;
    if (oldIds.size) existing.supersedes = [...oldIds].slice(-8);
    if (candidate.subject) existing.subject = candidate.subject;
    if (candidate.subjectType) existing.subjectType = candidate.subjectType;
    if (candidate.relation) existing.relation = candidate.relation;
    if (candidate.object) existing.object = candidate.object;
    if (candidate.objectType) existing.objectType = candidate.objectType;
    memory = existing;
  } else {
    memory = {
      id: `mem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      kind, text, keywords, confidence, createdAt: now, updatedAt: now,
      uses: 1, source, state: "active", supersedes: oldIds.size ? [...oldIds].slice(-8) : undefined,
      subject: candidate.subject,
      subjectType: candidate.subjectType,
      relation: candidate.relation,
      object: candidate.object,
      objectType: candidate.objectType,
    };
    data.push(memory);
  }

  const bounded = data.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 2000);
  await writeAll(bounded);

  if (kind === "preference" || kind === "project") {
    const key = `${kind}.${keywords[0] || memory.id}`;
    await rememberFact(key, text);
  }

  // Graph updates are best-effort: semantic memory remains usable if graph
  // persistence ever fails.
  if (candidate.subject && candidate.relation && candidate.object) {
    try {
      await upsertRelation({
        subject: candidate.subject,
        subjectType: candidate.subjectType,
        relation: candidate.relation,
        object: candidate.object,
        objectType: candidate.objectType,
        confidence,
        memoryId: memory.id,
        explicitCorrection: Boolean(candidate.explicitCorrection) || kind === "correction",
      });
      // Keep the graph compact when multiple providers use slightly different
      // labels for the same entity. Aliases are retained on the surviving node.
      await mergeDuplicateNodes();
    } catch (err) {
      console.warn("[memory] graph update skipped:", err instanceof Error ? err.message : err);
    }
  }
  return memory;
}

/** Consolidates an experience using local deterministic rules when no LLM extraction is available. */
export async function consolidateHeuristically(input: string, output: string, source = "experience"): Promise<number> {
  const candidates: MemoryCandidate[] = [];
  const text = input.trim();
  const lower = text.toLowerCase();

  // Explicit teaching/correction language is high-confidence and safe to keep.
  const explicit = text.match(/^(?:remember|note|learn|don't forget|do not forget)\s+(?:that\s+)?(.+)$/i);
  if (explicit?.[1]) candidates.push({ kind: "fact", text: explicit[1], confidence: 0.96, source });

  const preference = text.match(/^(?:i|we)\s+(?:prefer|like|love|hate|don't like|do not like)\s+(.+)$/i);
  if (preference?.[1]) candidates.push({ kind: "preference", text: `User preference: ${preference[1]}`, confidence: 0.92, source, explicitCorrection: false });

  const correction = text.match(/^(?:no|actually|correction|that's wrong|that is wrong)[,:]?\s+(.+)$/i);
  if (correction?.[1]) candidates.push({ kind: "correction", text: correction[1], confidence: 0.94, source, explicitCorrection: true });

  const name = text.match(/^(?:my name is|call me|i am|i'm)\s+([A-Za-z][A-Za-z0-9 _-]{1,60})[.!]?$/i);
  if (name?.[1]) candidates.push({
    kind: "fact", text: `User's name is ${name[1].trim()}`, keywords: [name[1].trim()],
    confidence: 0.99, source, subject: "User", subjectType: "person",
    relation: "HAS_NAME", object: name[1].trim(), objectType: "entity",
  });

  if (/\b(project|building|working on|developing|making)\b/i.test(text) && text.length < 700) {
    candidates.push({ kind: "project", text, confidence: 0.78, source });
  }

  // A successful tool result is retained as an observation. It is deliberately
  // lower confidence because values such as prices/weather can become stale.
  if (output.trim() && /\b(price|weather|stock|temperature|result|status|version)\b/i.test(lower)) {
    candidates.push({ kind: "observation", text: `Observed while answering: ${output}`, confidence: 0.55, source });
  }

  // Lightweight relationship extraction works even when model consolidation is unavailable.
  const relationPatterns: Array<{ re: RegExp; relation: string; subjectType: any; objectType: any }> = [
    { re: /^(?:i|we)\s+(?:prefer|like|love)\s+(.+)$/i, relation: "PREFERS", subjectType: "person", objectType: "preference" },
    { re: /\b(?:building|working on|developing|making)\s+(?:the\s+)?(?:project\s+)?(.+)/i, relation: "WORKS_ON", subjectType: "person", objectType: "project" },
  ];
  for (const rule of relationPatterns) {
    const match = text.match(rule.re);
    if (match?.[1]) candidates.push({
      kind: rule.relation === "PREFERS" ? "preference" : "project",
      text: candidates[0]?.text || text,
      keywords: [match[1]],
      confidence: rule.relation === "PREFERS" ? 0.92 : 0.8,
      source,
      subject: "User",
      subjectType: rule.subjectType,
      relation: rule.relation,
      object: match[1].replace(/[.!?]+$/, "").trim(),
      objectType: rule.objectType,
    } as MemoryCandidate);
  }

  let count = 0;
  for (const candidate of candidates) if (await learnMemory(candidate)) count++;
  return count;
}

export async function searchSemanticMemory(query: string, limit = 10): Promise<SemanticMemory[]> {
  const data = await readAll();
  const q = new Set(query.toLowerCase().split(/\W+/).filter((x) => x.length >= 2));
  if (!q.size) return [];
  return data
    .filter((memory) => memory.state !== "superseded")
    .map((memory) => {
      const words = new Set(`${memory.text} ${memory.keywords.join(" ")}`.toLowerCase().split(/\W+/));
      let overlap = 0;
      for (const word of q) if (words.has(word)) overlap++;
      return { memory, score: overlap * 10 + memory.confidence * 2 + Math.min(memory.uses, 20) * 0.05 };
    })
    .filter((x) => x.score >= 10)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.memory);
}

export async function renderSemanticMemory(query = ""): Promise<string> {
  const memories = query ? await searchSemanticMemory(query) : (await readAll()).slice(-20);
  return memories.map((m) => `- [${m.kind}; confidence ${m.confidence.toFixed(2)}] ${m.text}`).join("\n");
}

export async function consolidationStats() {
  const data = await readAll();
  return { memories: data.length, file: SEMANTIC_FILE };
}
