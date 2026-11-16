import { NextRequest, NextResponse } from "next/server";
import { requireAccess } from "@/lib/security";
import { isValidUiSession } from "@/lib/remote/gateway";
import { consolidationStats, renderSemanticMemory } from "@/lib/memory/consolidation";
import { graphStats, searchGraph } from "@/lib/memory/graph";
import { learningStats } from "@/lib/memory/learning";

export async function GET(req: NextRequest) {
  const auth = requireAccess(req, 30, 60_000, isValidUiSession);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const url = new URL(req.url);
  const query = url.searchParams.get("q") || "";
  const graphOnly = url.searchParams.get("graph") === "1";
  const parsedDepth = Number(url.searchParams.get("depth") || "3");
  const depth = Number.isFinite(parsedDepth) ? Math.max(1, Math.min(5, Math.floor(parsedDepth))) : 3;
  const graph = graphOnly ? await searchGraph(query || "jarvis user project preference minecraft", 60, depth) : null;
  return NextResponse.json({
    ...await consolidationStats(),
    episodic: await learningStats(),
    graph: await graphStats(),
    memories: graphOnly ? undefined : await renderSemanticMemory(query),
    graphData: graph,
    graphDepth: depth,
  });
}
