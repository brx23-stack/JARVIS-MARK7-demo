import { promises as fs } from "fs";
import path from "path";

export type UsageRecord = {
  id: string;
  at: string;
  provider: string;
  model: string;
  role: "planner" | "executor" | "verifier" | "chat";
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number | null;
  success: boolean;
  latencyMs: number;
  taskId?: string;
};

const DATA_DIR = path.join(process.cwd(), "data");
const FILE = path.join(DATA_DIR, "ai-usage.json");
let queue: Promise<unknown> = Promise.resolve();

function pricePerMillion(name: string, direction: "input" | "output"): number | null {
  const key = direction === "input"
    ? `JARVIS_${name.toUpperCase()}_INPUT_USD_PER_1M`
    : `JARVIS_${name.toUpperCase()}_OUTPUT_USD_PER_1M`;
  const value = Number(process.env[key]);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

export function estimateCost(provider: string, inputTokens: number, outputTokens: number) {
  const input = pricePerMillion(provider, "input");
  const output = pricePerMillion(provider, "output");
  if (input === null || output === null) return null;
  return (inputTokens / 1_000_000) * input + (outputTokens / 1_000_000) * output;
}

async function readAll(): Promise<UsageRecord[]> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    const parsed = JSON.parse(await fs.readFile(FILE, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function recordUsage(record: Omit<UsageRecord, "id" | "at" | "totalTokens" | "estimatedCostUsd">) {
  const item: UsageRecord = {
    ...record,
    id: `usage-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    at: new Date().toISOString(),
    totalTokens: record.inputTokens + record.outputTokens,
    estimatedCostUsd: estimateCost(record.provider, record.inputTokens, record.outputTokens),
  };
  queue = queue.then(async () => {
    const all = await readAll();
    all.push(item);
    await fs.writeFile(FILE, JSON.stringify(all.slice(-5000), null, 2), "utf8");
  });
  await queue;
  return item;
}

export async function usageSummary() {
  const all = await readAll();
  const totalTokens = all.reduce((n, x) => n + x.totalTokens, 0);
  const priced = all.filter((x) => x.estimatedCostUsd !== null);
  const costUsd = priced.reduce((n, x) => n + (x.estimatedCostUsd ?? 0), 0);
  const byProvider: Record<string, { requests: number; tokens: number; costUsd: number | null }> = {};
  for (const x of all) {
    const bucket = byProvider[x.provider] ?? { requests: 0, tokens: 0, costUsd: 0 };
    bucket.requests += 1;
    bucket.tokens += x.totalTokens;
    if (x.estimatedCostUsd !== null) bucket.costUsd = (bucket.costUsd ?? 0) + x.estimatedCostUsd;
    else bucket.costUsd = null;
    byProvider[x.provider] = bucket;
  }
  return {
    requests: all.length,
    totalTokens,
    costUsd: priced.length === all.length ? costUsd : null,
    pricedRequests: priced.length,
    byProvider,
    pricingConfigured: priced.length > 0,
    recent: all.slice(-25).reverse(),
  };
}

/** Per-day token totals (last `days` days, oldest first) and the last call time per agent role. For the dashboard. */
export async function usageDigest(days = 12) {
  const all = await readAll();
  const buckets = new Map<string, { tokens: number; requests: number }>();
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today); d.setDate(today.getDate() - i);
    buckets.set(d.toISOString().slice(0, 10), { tokens: 0, requests: 0 });
  }
  const lastByRole: Record<string, number> = {};
  for (const x of all) {
    const b = buckets.get(x.at.slice(0, 10));
    if (b) { b.tokens += x.totalTokens; b.requests += 1; }
    const t = Date.parse(x.at);
    if (!(lastByRole[x.role] > t)) lastByRole[x.role] = t;
  }
  return { daily: [...buckets].map(([day, v]) => ({ day, ...v })), lastByRole };
}
