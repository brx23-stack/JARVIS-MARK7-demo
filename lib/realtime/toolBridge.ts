// Lets the Realtime voice model call your registered tools (via /api/realtime/tool) and speak the result.
const MAX_CALLS_PER_SESSION = 12;

export function createToolBridge(send: (o: unknown) => void) {
  const handled = new Set<string>();
  let calls = 0;
  return {
    async onOpen() {
      try {
        const r = await fetch("/api/realtime/tool");
        const j = await r.json();
        if (r.ok && j.tools?.length) send({ type: "session.update", session: { type: "realtime", tools: j.tools, tool_choice: "auto" } });
      } catch { /* voice still works without tools */ }
    },
    async onEvent(e: any) {
      if (e?.type !== "response.done") return;
      let any = false;
      for (const it of e.response?.output ?? []) {
        if (it?.type !== "function_call" || handled.has(it.call_id)) continue;
        handled.add(it.call_id);
        let output: string;
        if (++calls > MAX_CALLS_PER_SESSION) output = "Error: tool call limit reached for this session.";
        else {
          try {
            let args: unknown = {};
            try { args = JSON.parse(it.arguments || "{}"); } catch {}
            const r = await fetch("/api/realtime/tool", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: it.name, args }) });
            const j = await r.json().catch(() => ({}));
            output = r.ok ? String(j.result ?? "") : `Error: ${j.error ?? r.status}`;
          } catch { output = "Error: tool call failed."; }
        }
        send({ type: "conversation.item.create", item: { type: "function_call_output", call_id: it.call_id, output: output.slice(0, 4000) } });
        any = true;
      }
      if (any) send({ type: "response.create" });
    },
  };
}
