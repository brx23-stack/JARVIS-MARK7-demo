import { NextRequest, NextResponse } from "next/server";
import { requireAccess } from "@/lib/security";
import { isValidUiSession } from "@/lib/remote/gateway";
import { getTool, getToolDefinitions } from "@/lib/agents/tool-registry";
import { countToolCall } from "@/lib/realtime/guard";

export const dynamic = "force-dynamic";

// Which tools the voice model may call. Override with REALTIME_TOOLS="a,b,android_*" (trailing * = prefix).
const DEFAULT = "get_current_time,web_search,get_weather,convert_currency,android_*";
function allowed(name: string) {
  return (process.env.REALTIME_TOOLS || DEFAULT).split(",").map((s: string) => s.trim()).filter(Boolean)
    .some((p: string) => (p.endsWith("*") ? name.startsWith(p.slice(0, -1)) : name === p));
}

export async function GET(req: NextRequest) {
  const a = requireAccess(req, 20, 60_000, isValidUiSession);
  if (!a.ok) return NextResponse.json({ error: a.error }, { status: a.status });
  const tools = getToolDefinitions().filter((d: any) => allowed(d?.function?.name))
    .map((d: any) => ({ type: "function", name: d.function.name, description: d.function.description ?? "", parameters: d.function.parameters ?? { type: "object", properties: {} } }));
  return NextResponse.json({ tools });
}

export async function POST(req: NextRequest) {
  const a = requireAccess(req, 30, 60_000, isValidUiSession);
  if (!a.ok) return NextResponse.json({ error: a.error }, { status: a.status });
  const { name, args } = await req.json().catch(() => ({}));
  if (typeof name !== "string" || !allowed(name)) return NextResponse.json({ error: "Tool not allowed for voice." }, { status: 403 });
  const tool = getTool(name);
  if (!tool) return NextResponse.json({ error: "Unknown tool." }, { status: 404 });
  if (!countToolCall()) return NextResponse.json({ error: "Daily voice tool-call cap reached." }, { status: 429 });
  const result = await tool.execute(JSON.stringify(args && typeof args === "object" ? args : {}));
  return NextResponse.json({ result: String(result).slice(0, 4000) });
}
