import { NextRequest, NextResponse } from "next/server";
import {
  claimRemoteCommand,
  getPendingRemoteCommands,
  isRemoteEnabled,
  subscribeRemoteCommands,
  isValidUiSession,
} from "@/lib/remote/gateway";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = req.cookies.get("jarvis_remote_ui")?.value;
  if (!isValidUiSession(session)) {
    return NextResponse.json({ error: "Remote UI session required" }, { status: 401 });
  }
  if (!isRemoteEnabled()) {
    return NextResponse.json({ enabled: false, commands: [] }, { headers: { "cache-control": "no-store" } });
  }

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      const send = (command: ReturnType<typeof getPendingRemoteCommands>[number]) => {
        controller.enqueue(encoder.encode(`event: command\ndata: ${JSON.stringify(command)}\n\n`));
      };

      // Catch commands that arrived immediately before the browser connected.
      for (const command of getPendingRemoteCommands(10)) send(command);

      const unsubscribe = subscribeRemoteCommands(send);
      const heartbeat = setInterval(() => {
        try { controller.enqueue(encoder.encode(": heartbeat\n\n")); } catch {}
      }, 15_000);

      const cleanup = () => {
        clearInterval(heartbeat);
        unsubscribe();
        try { controller.close(); } catch {}
      };

      req.signal.addEventListener("abort", cleanup);
    },
    cancel() {},
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}

export async function POST(req: NextRequest) {
  const session = req.cookies.get("jarvis_remote_ui")?.value;
  if (!isValidUiSession(session)) {
    return NextResponse.json({ error: "Remote UI session required" }, { status: 401 });
  }
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
  const command = claimRemoteCommand(id, session!);
  return NextResponse.json({ command }, { headers: { "cache-control": "no-store" } });
}

