// Persistence for proposals, snapshots (for rollback), audit log and arming state.

import { promises as fs } from "node:fs";
import path from "node:path";

export type Edit = {
  path: string;
  kind: "replace" | "create";
  search?: string;
  replace?: string;
  content?: string;
  note?: string;
};

export type ProposalStatus = "pending" | "applied" | "rejected" | "failed" | "rolled_back";

export type Verify = { ok: boolean; skipped: boolean; newErrors: string[]; repairRounds: number };

export type Proposal = {
  id: string;
  goal: string;
  createdAt: string;
  updatedAt: string;
  status: ProposalStatus;
  summary: string;
  edits: Edit[];
  diff: string;
  files: string[];
  verify?: Verify;
  error?: string;
  autoApplied?: boolean;
};

const DIR = () => path.join(process.cwd(), "data", "autocoder");
const PROPOSALS = () => path.join(DIR(), "proposals.json");
const SNAPDIR = () => path.join(DIR(), "snapshots");
const AUDIT = () => path.join(DIR(), "audit.log");

let queue: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

async function readProposals(): Promise<Proposal[]> {
  try { const p = JSON.parse(await fs.readFile(PROPOSALS(), "utf8")); return Array.isArray(p) ? p : []; } catch { return []; }
}

export function saveProposal(p: Proposal) {
  return serial(async () => {
    await fs.mkdir(DIR(), { recursive: true });
    const all = await readProposals();
    p.updatedAt = new Date().toISOString();
    const i = all.findIndex((x) => x.id === p.id);
    if (i >= 0) all[i] = p; else all.push(p);
    const tmp = PROPOSALS() + ".tmp";
    await fs.writeFile(tmp, JSON.stringify(all.slice(-100), null, 2), "utf8");
    await fs.rename(tmp, PROPOSALS());
    return p;
  });
}

export async function getProposal(id: string) { return (await readProposals()).find((x) => x.id === id) ?? null; }
export async function listProposals(limit = 25) { return (await readProposals()).slice(-limit).reverse(); }

// ——— snapshots ———
export type Snapshot = { id: string; createdAt: string; files: Record<string, string | null> };

export async function loadSnapshot(id: string): Promise<Snapshot | null> {
  try { return JSON.parse(await fs.readFile(path.join(SNAPDIR(), `${id}.json`), "utf8")); } catch { return null; }
}

export function saveSnapshot(s: Snapshot) {
  return serial(async () => {
    await fs.mkdir(SNAPDIR(), { recursive: true });
    await fs.writeFile(path.join(SNAPDIR(), `${s.id}.json`), JSON.stringify(s), "utf8");
    const names = (await fs.readdir(SNAPDIR())).filter((n) => n.endsWith(".json")).sort();
    for (const n of names.slice(0, Math.max(0, names.length - 50))) await fs.unlink(path.join(SNAPDIR(), n)).catch(() => {});
  });
}

// ——— audit ———
export async function audit(event: string, data: Record<string, unknown> = {}) {
  try {
    await fs.mkdir(DIR(), { recursive: true });
    await fs.appendFile(AUDIT(), JSON.stringify({ at: new Date().toISOString(), event, ...data }) + "\n", "utf8");
  } catch { /* auditing must never break the flow */ }
}

export async function readAudit(limit = 50) {
  try {
    const lines = (await fs.readFile(AUDIT(), "utf8")).trim().split("\n").slice(-limit);
    return lines.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean).reverse();
  } catch { return []; }
}

// ——— arming (same idea as Android Hands: time-limited, owner-only) ———
const K = "__jarvisAutocoderArm";
const g = globalThis as unknown as Record<string, number>;

export function autocoderEnabled() { return process.env.AUTOCODER_ENABLED === "true"; }
export function autocoderMode(): "propose" | "auto" { return process.env.AUTOCODER_MODE === "auto" ? "auto" : "propose"; }

export function armAutocoder(minutes: number) {
  const m = Math.min(60, Math.max(1, Math.floor(minutes) || 10));
  g[K] = Date.now() + m * 60_000;
  return autocoderStatus();
}
export function disarmAutocoder() { g[K] = 0; return autocoderStatus(); }
export function autocoderStatus() {
  const left = Math.max(0, (g[K] ?? 0) - Date.now());
  return {
    enabled: autocoderEnabled(),
    mode: autocoderMode(),
    armed: left > 0,
    minutesLeft: Math.ceil(left / 60_000),
    devServer: process.env.NODE_ENV !== "production",
  };
}
