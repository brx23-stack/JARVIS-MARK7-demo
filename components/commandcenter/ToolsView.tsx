"use client";
import type { Snapshot } from "@/lib/dashboard/types";

export default function ToolsView({ snap, filter }: { snap: Snapshot; filter: string }) {
  const q = filter.trim().toLowerCase();
  const tools = snap.tools.filter((t) => !q || t.name.toLowerCase().includes(q) || t.description.toLowerCase().includes(q));
  const held = new Set(snap.integrations.approvalTools);
  return (
    <div className="cc-view">
      <div className="cc-card"><div className="cc-card-title">TOOLS &amp; SKILLS · {snap.tools.length}</div>
        <p className="cc-muted">Everything the agent can actually call right now. Tools marked HOLD wait for your approval first.</p></div>
      {tools.map((t) => (
        <div className="cc-card cc-tool" key={t.name}>
          <div className="cc-row spread"><strong>{t.name}</strong>
            <span>{held.has(t.name) && <span className="cc-badge paused">HOLD</span>} <span className="cc-badge planned">{t.source.toUpperCase()}</span></span></div>
          <div className="cc-muted">{t.description}</div>
        </div>
      ))}
      {tools.length === 0 && <div className="cc-empty">No tools match “{filter}”.</div>}
    </div>
  );
}
