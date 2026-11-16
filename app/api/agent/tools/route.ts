import { NextRequest, NextResponse } from "next/server";
import { requireAccess } from "@/lib/security";
import { isValidUiSession } from "@/lib/remote/gateway";
import { getToolDefinitions, registerTool } from "@/lib/agents/tool-registry";

export async function GET(req: NextRequest) {
  const auth = requireAccess(req, 30, 60_000, isValidUiSession);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  return NextResponse.json({ tools: getToolDefinitions() });
}

export async function POST(req: NextRequest) {
  const auth = requireAccess(req, 10, 60_000, isValidUiSession);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  // Dynamic registration is intentionally server-local. Remote callers can
  // only register tools when JARVIS_DYNAMIC_TOOLS=true, and the handler is
  // a named safe adapter, never arbitrary code from the network.
  if (process.env.JARVIS_DYNAMIC_TOOLS !== "true") {
    return NextResponse.json({ error: "Dynamic tool registration is disabled." }, { status: 403 });
  }
  return NextResponse.json({
    error: "Runtime code handlers cannot be supplied over HTTP. Register tools in server code with registerTool().",
    available: getToolDefinitions().map((x: any) => x.function.name),
  }, { status: 400 });
}
