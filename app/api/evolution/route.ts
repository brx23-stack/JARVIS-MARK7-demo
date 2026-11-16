import { NextRequest, NextResponse } from "next/server";
import { requireAccess } from "@/lib/security";
import { isValidUiSession } from "@/lib/remote/gateway";
import { addSkillEvidence, createEvolutionGoal, deleteEvolutionGoal, getEvolutionData, updateEvolutionGoal } from "@/lib/evolution/store";

export const dynamic = "force-dynamic";
function auth(req: NextRequest) { return requireAccess(req, 40, 60_000, isValidUiSession); }

export async function GET(req: NextRequest) {
  const access = auth(req);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  return NextResponse.json(await getEvolutionData(), { headers: { "cache-control": "no-store" } });
}

export async function POST(req: NextRequest) {
  const access = auth(req);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  try {
    if (body.action === "create_goal") {
      const goal = await createEvolutionGoal({ title: body.title, description: body.description, category: body.category, targetDate: body.targetDate, milestones: Array.isArray(body.milestones) ? body.milestones : [] });
      return NextResponse.json({ goal }, { status: 201 });
    }
    if (body.action === "add_evidence") {
      const evidence = await addSkillEvidence({ skill: body.skill, description: body.description });
      return NextResponse.json({ evidence }, { status: 201 });
    }
    if (body.action === "update_goal") {
      const goal = await updateEvolutionGoal(String(body.id || ""), { status: body.status, milestoneId: body.milestoneId, completed: body.completed, evidence: body.evidence });
      return goal ? NextResponse.json({ goal }) : NextResponse.json({ error: "Goal or milestone not found." }, { status: 404 });
    }
    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not save evolution data." }, { status: 400 });
  }
}

export async function DELETE(req: NextRequest) {
  const access = auth(req);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const id = new URL(req.url).searchParams.get("id") || "";
  if (!id) return NextResponse.json({ error: "Goal id is required." }, { status: 400 });
  return await deleteEvolutionGoal(id) ? NextResponse.json({ deleted: true }) : NextResponse.json({ error: "Goal not found." }, { status: 404 });
}
