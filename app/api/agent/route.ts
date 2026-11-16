import { NextRequest, NextResponse } from "next/server";
import { requireAccess } from "@/lib/security";
import { isValidUiSession } from "@/lib/remote/gateway";
import { runAutonomousTask } from "@/lib/agents/orchestrator";
import { listTasks, latestResumableTask } from "@/lib/agents/task-store";
import { usageSummary } from "@/lib/agents/cost-tracker";
import { isLocalOnlyMode } from "@/lib/privacy/policy";

export async function POST(req: NextRequest) {
  const auth = requireAccess(req, 30, 60_000, isValidUiSession);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (isLocalOnlyMode()) return NextResponse.json({ error: "Autonomous agent mode is disabled by local-only privacy mode." }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const goal = typeof body.goal === "string" ? body.goal.trim() : "";
  if (!goal) return NextResponse.json({ error: "Missing 'goal'." }, { status: 400 });
  try {
    return NextResponse.json(await runAutonomousTask(goal, typeof body.taskId === "string" ? body.taskId : undefined));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Agent task failed." }, { status: 502 });
  }
}

export async function GET(req: NextRequest) {
  const auth = requireAccess(req, 30, 60_000, isValidUiSession);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const url = new URL(req.url);
  if (url.searchParams.get("usage") === "1") return NextResponse.json(await usageSummary());
  if (url.searchParams.get("resume") === "1") return NextResponse.json({ task: await latestResumableTask() });
  return NextResponse.json({ tasks: await listTasks(Number(url.searchParams.get("limit") || 20)), usage: await usageSummary() });
}
