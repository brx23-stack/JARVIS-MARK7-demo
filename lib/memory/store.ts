// ——— Persistent memory ———
//
// A tiny file-backed key/value store so JARVIS can remember facts about the
// user across sessions (not just within one browser tab's chat history).
// Deliberately simple — a single JSON file on disk — since this runs as a
// personal local assistant, not a multi-tenant service. Swap this module
// out for a real DB later without touching any caller, since everything
// goes through the four functions below.
//
// File lives in ./data/memory.json (gitignored — see .gitignore). Writes
// are serialized through a promise chain so concurrent tool calls can't
// interleave and corrupt the file.

import { promises as fs } from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "data");
const MEMORY_FILE = path.join(DATA_DIR, "memory.json");

export type MemoryEntry = {
  value: string;
  updatedAt: string; // ISO timestamp
};

type MemoryFile = Record<string, MemoryEntry>;

// Every mutation (read -> change -> write) runs through this queue, one at a time. Queueing only the
// write would still lose updates, because two callers could read the same snapshot. A failed task is
// swallowed for the queue's purposes so one error can never block later writes.
let queue: Promise<unknown> = Promise.resolve();
function exclusive<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task);
  queue = run.catch(() => {});
  return run;
}

async function ensureFile(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(MEMORY_FILE);
  } catch {
    await fs.writeFile(MEMORY_FILE, "{}", "utf-8");
  }
}

async function readAll(): Promise<MemoryFile> {
  await ensureFile();
  try {
    const raw = await fs.readFile(MEMORY_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (err) {
    console.warn("[memory] failed to read/parse memory.json, starting fresh:", err);
    // Keep the unreadable file so a later write cannot silently destroy it.
    await fs.copyFile(MEMORY_FILE, `${MEMORY_FILE}.corrupt-${Date.now()}`).catch(() => {});
    return {};
  }
}

async function writeAll(data: MemoryFile): Promise<void> {
  // Write to a temp file and rename, so a crash mid-write cannot leave a truncated memory.json.
  const tmp = `${MEMORY_FILE}.tmp-${process.pid}`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), "utf-8");
  await fs.rename(tmp, MEMORY_FILE);
}

/** Stores or overwrites a fact under `key`. */
export function rememberFact(key: string, value: string): Promise<void> {
  return exclusive(async () => {
    const data = await readAll();
    data[key.trim()] = { value: value.trim(), updatedAt: new Date().toISOString() };
    await writeAll(data);
  });
}

/** Retrieves a single fact, or null if it isn't set. */
export async function recallFact(key: string): Promise<string | null> {
  const data = await readAll();
  return data[key.trim()]?.value ?? null;
}

/** Deletes a fact. Returns whether anything was actually removed. */
export function forgetFact(key: string): Promise<boolean> {
  return exclusive(async () => {
    const data = await readAll();
    const existed = key.trim() in data;
    delete data[key.trim()];
    await writeAll(data);
    return existed;
  });
}

/** Returns every stored fact — used to prime the system prompt each turn. */
export async function recallAllFacts(): Promise<MemoryFile> {
  return readAll();
}

/** Renders all stored facts as a short bullet list for the system prompt. Empty string if none. */
export async function renderFactsForPrompt(): Promise<string> {
  const data = await recallAllFacts();
  const keys = Object.keys(data);
  if (keys.length === 0) return "";
  return keys.map((k) => `- ${k}: ${data[k].value}`).join("\n");
}
