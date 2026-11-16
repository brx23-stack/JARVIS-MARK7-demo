// ——— Approvals inbox (tool calls that need the owner's OK) ———
//
// Opt-in: set JARVIS_APPROVAL_TOOLS=create_calendar_event,smart_home_control,open_app (comma list).
// When the AI (or a Telegram/Discord command) calls a listed tool, it is NOT executed. It is queued here and the AI is
// told it is waiting. Only the authenticated Command Center UI can approve it. Pending items live in memory and expire
// (default 30 min), so a restart never leaves a stale action that could fire later.

import crypto from "node:crypto";

type Status = "pending" | "approved" | "rejected" | "expired";
type Item = {
  id: string; tool: string; title: string; detail: string;
  createdAt: number; expiresAt: number; status: Status; result?: string;
  run?: () => Promise<string>;
};

const K = "__jarvisApprovals";
const g = globalThis as unknown as Record<string, Item[]>;
const items = (): Item[] => (g[K] ??= []);

export function approvalTools(): string[] {
  return (process.env.JARVIS_APPROVAL_TOOLS || "").split(",").map((s) => s.trim()).filter(Boolean);
}

const ttlMs = () => Math.max(1, Number(process.env.JARVIS_APPROVAL_TTL_MIN || 30)) * 60_000;

function sweep() {
  const now = Date.now();
  for (const it of items()) if (it.status === "pending" && it.expiresAt <= now) { it.status = "expired"; it.run = undefined; }
  const all = items();
  if (all.length > 60) all.splice(0, all.length - 60);
}

function pretty(argsJson: string): string {
  try { return JSON.stringify(JSON.parse(argsJson || "{}"), null, 2).slice(0, 800); } catch { return String(argsJson).slice(0, 800); }
}

/** Runs the tool now, or queues it if the tool is on the approval list. Always resolves to a string for the model. */
export async function gateToolCall(name: string, argsJson: string, run: () => Promise<string>): Promise<string> {
  if (!approvalTools().includes(name)) return run();
  sweep();
  const it: Item = {
    id: `ap-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`,
    tool: name, title: `Run tool: ${name}`, detail: pretty(argsJson),
    createdAt: Date.now(), expiresAt: Date.now() + ttlMs(), status: "pending", run,
  };
  items().push(it);
  return `Not executed yet: "${name}" needs the owner's approval. It is waiting in the JARVIS Command Center (id ${it.id}). Tell the user to approve it there; do not claim it was done.`;
}

/** Always queues (ignores JARVIS_APPROVAL_TOOLS). Use for actions that must never run without the owner's OK. */
export function enqueueApproval(tool: string, title: string, detail: string, run: () => Promise<string>): string {
  sweep();
  const it: Item = {
    id: `ap-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`,
    tool, title: title.slice(0, 120), detail: detail.slice(0, 800),
    createdAt: Date.now(), expiresAt: Date.now() + ttlMs(), status: "pending", run,
  };
  items().push(it);
  return it.id;
}

export function pendingApprovals() {
  sweep();
  return items().filter((x) => x.status === "pending").map((x) => ({
    id: x.id, source: "tool" as const, title: x.title, detail: x.detail,
    createdAt: new Date(x.createdAt).toISOString(),
  }));
}

export function recentApprovals(limit = 10) {
  sweep();
  return items().slice(-limit).reverse().map((x) => ({
    id: x.id, tool: x.tool, status: x.status, createdAt: new Date(x.createdAt).toISOString(), result: x.result?.slice(0, 300),
  }));
}

export async function decideApproval(id: string, approve: boolean) {
  sweep();
  const it = items().find((x) => x.id === id);
  if (!it) throw new Error("Approval not found (it may have expired).");
  if (it.status !== "pending") throw new Error(`Already ${it.status}.`);
  if (!approve) { it.status = "rejected"; it.run = undefined; return it.status; }
  const run = it.run; it.run = undefined; it.status = "approved";
  try { it.result = String(await run!()).slice(0, 2000); } catch (e) { it.result = `Error: ${e instanceof Error ? e.message : "failed"}`; }
  return it.status;
}
