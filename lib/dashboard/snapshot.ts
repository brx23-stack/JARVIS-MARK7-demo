// Builds the single JSON blob the Command Center renders. Every section is isolated:
// one failing integration (Google down, no key, etc.) never blanks the whole dashboard.

import os from "node:os";
import { promises as fs } from "node:fs";
import { listTasks } from "@/lib/agents/task-store";
import { usageDigest, usageSummary } from "@/lib/agents/cost-tracker";
import { getRegisteredTools } from "@/lib/agents/tool-registry";
import { consolidationStats } from "@/lib/memory/consolidation";
import { graphStats } from "@/lib/memory/graph";
import { learningStats } from "@/lib/memory/learning";
import { isCalendarConfigured, listUpcomingEvents } from "@/lib/calendar/googleCalendar";
import { isEmailConfigured } from "@/lib/email/gmail";
import { getCurrentWeather } from "@/lib/weather/openMeteo";
import { publicRemoteStatus } from "@/lib/remote/gateway";
import { approvalTools, pendingApprovals, recentApprovals } from "@/lib/approvals/queue";
import { autocoderStatus, listProposals } from "@/lib/autocoder/store";
import { isLocalOnlyMode } from "@/lib/privacy/policy";
import type { ApprovalView, Snapshot, TaskView } from "./types";

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try { return await fn(); } catch { return fallback; }
}

// Small TTL cache so a 10-second UI poll never hammers Google / Open-Meteo.
const cache = new Map<string, { at: number; value: unknown }>();
async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value as T;
  const value = await fn();
  cache.set(key, { at: Date.now(), value });
  return value;
}

const cpuTimes = () => os.cpus().reduce((a, c) => {
  const t = c.times; return { idle: a.idle + t.idle, total: a.total + t.user + t.nice + t.sys + t.idle + t.irq };
}, { idle: 0, total: 0 });

async function cpuPercent(): Promise<number | null> {
  const a = cpuTimes();
  await new Promise((r) => setTimeout(r, 200));
  const b = cpuTimes();
  const total = b.total - a.total;
  return total > 0 ? Math.round((1 - (b.idle - a.idle) / total) * 100) : null;
}

async function system(): Promise<Snapshot["system"]> {
  const total = os.totalmem(), free = os.freemem();
  let diskPercent: number | null = null, diskFreeGb: number | null = null;
  try {
    const st = await fs.statfs(process.cwd());
    const size = st.blocks * st.bsize, avail = st.bavail * st.bsize;
    if (size > 0) { diskPercent = Math.round((1 - avail / size) * 100); diskFreeGb = Math.round((avail / 1e9) * 10) / 10; }
  } catch { /* statfs unsupported */ }
  return {
    cpuPercent: await safe(cpuPercent, null),
    memPercent: Math.round((1 - free / total) * 100),
    memUsedGb: Math.round(((total - free) / 1e9) * 10) / 10,
    memTotalGb: Math.round((total / 1e9) * 10) / 10,
    diskPercent, diskFreeGb, platform: process.platform, uptimeHours: Math.round((os.uptime() / 3600) * 10) / 10,
  };
}

function taskView(t: Awaited<ReturnType<typeof listTasks>>[number]): TaskView {
  return {
    id: t.id, goal: t.goal, status: t.status, currentStep: t.currentStep,
    steps: t.plan.steps.map((s) => ({ id: s.id, title: s.title, status: s.status, error: s.error, result: s.result?.slice(0, 400) })),
    toolsUsed: [...new Set(t.toolsUsed)],
    verification: t.verification ? { ok: t.verification.ok, summary: t.verification.summary } : undefined,
    createdAt: t.createdAt, updatedAt: t.updatedAt,
  };
}

export async function buildSnapshot(): Promise<Snapshot> {
  const place = process.env.BRIEFING_DEFAULT_PLACE || "";
  const calendarOn = !isLocalOnlyMode() && isCalendarConfigured();

  const [sys, tasks, usage, digest, memories, graph, episodic, events, weather, proposals] = await Promise.all([
    system(),
    safe(() => listTasks(20), []),
    safe(usageSummary, null),
    safe(() => usageDigest(12), { daily: [], lastByRole: {} }),
    safe(async () => (await consolidationStats()).memories, 0),
    safe(graphStats, null),
    safe(learningStats, null),
    calendarOn
      ? safe(() => cached("calendar", 60_000, () => listUpcomingEvents(24)).then((e) => ({ events: e, error: undefined as string | undefined })),
          { events: [], error: "Calendar request failed" })
      : Promise.resolve({ events: [], error: undefined as string | undefined }),
    place && !isLocalOnlyMode()
      ? safe(() => cached("weather", 600_000, () => getCurrentWeather(place)).then((w) => ({ place: w.place, tempC: Math.round(w.temperatureC), condition: w.condition })), null)
      : Promise.resolve(null),
    safe(() => (autocoderStatus().enabled ? listProposals(25) : Promise.resolve([])), []),
  ]);

  const ac = autocoderStatus();
  const approvals: ApprovalView[] = [
    ...pendingApprovals(),
    ...proposals.filter((p) => p.status === "pending").map((p): ApprovalView => ({
      id: p.id, source: "autocoder", title: `Code change: ${p.goal.slice(0, 90)}`,
      detail: p.summary, diff: p.diff, files: p.files, createdAt: p.createdAt,
    })),
  ];

  const remote = publicRemoteStatus();
  const items = tasks.map(taskView);
  const count = (s: string) => items.filter((t) => t.status === s).length;

  return {
    at: new Date().toISOString(),
    system: sys,
    tasks: { items, running: count("running"), paused: count("paused"), completed: count("completed"), failed: count("failed") },
    usage: {
      requests: usage?.requests ?? 0, totalTokens: usage?.totalTokens ?? 0, costUsd: usage?.costUsd ?? null,
      daily: digest.daily, lastByRole: digest.lastByRole, byProvider: usage?.byProvider ?? {},
    },
    tools: getRegisteredTools().map((t) => ({
      name: String(t.definition?.function?.name ?? ""), description: String(t.definition?.function?.description ?? "").slice(0, 220), source: t.source,
    })),
    memory: { memories, graph: graph as Record<string, unknown> | null, episodic: episodic as Record<string, unknown> | null },
    calendar: { configured: calendarOn, events: events.events, error: events.error },
    weather,
    integrations: {
      calendar: calendarOn, email: isEmailConfigured(),
      telegram: remote.telegramConfigured, discord: remote.discordConfigured,
      autocoder: { enabled: ac.enabled, mode: ac.mode, armed: ac.armed },
      approvalTools: approvalTools(),
    },
    approvals,
    recentDecisions: recentApprovals(8).filter((x) => x.status !== "pending"),
  };
}
