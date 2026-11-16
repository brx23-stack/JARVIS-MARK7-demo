// Daily plan: collects today's data, asks the LLM for a plan, queues suggested actions for approval.
// GET  -> last generated plan (signed-in UI only).
// POST -> generate a new plan. Allowed for the signed-in UI, or for cron via x-jarvis-admin-token.
import { NextRequest, NextResponse } from "next/server";
import { isLocalOnlyMode } from "@/lib/privacy/policy";
import { requireAccess } from "@/lib/security";
import { isValidUiSession, verifyAdminToken } from "@/lib/remote/gateway";
import { collectDayData } from "@/lib/briefing/dayData";
import { planDay, type DayPlan } from "@/lib/briefing/dayPlan";
import { dayActionTools, queueDayActions } from "@/lib/briefing/queueActions";

export const dynamic = "force-dynamic";

type Stored = { plan: DayPlan; approvalIds: string[]; generatedAt: string; errors: string[] };
const K = "__jarvisDayPlan";
const store = globalThis as unknown as Record<string, Stored | undefined>;

export async function GET(req: NextRequest) {
  const auth = requireAccess(req, 60, 60_000, isValidUiSession);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  return NextResponse.json({ today: store[K] ?? null });
}

export async function POST(req: NextRequest) {
  if (isLocalOnlyMode()) return NextResponse.json({ error: "Daily briefing integrations are disabled by local-only privacy mode." }, { status: 403 });
  if (!verifyAdminToken(req.headers.get("x-jarvis-admin-token") || "")) {
    const auth = requireAccess(req, 6, 60_000, isValidUiSession);
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const body: { place?: unknown } = await req.json().catch(() => ({}));
  const place =
    (typeof body.place === "string" && body.place.trim()) || process.env.BRIEFING_DEFAULT_PLACE || undefined;

  try {
    const data = await collectDayData(place);
    const plan = await planDay(data, dayActionTools());
    const approvalIds = queueDayActions(plan);
    const today: Stored = { plan, approvalIds, generatedAt: data.generatedAt, errors: data.errors };
    store[K] = today;
    return NextResponse.json({ today });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Day plan failed." }, { status: 502 });
  }
}
