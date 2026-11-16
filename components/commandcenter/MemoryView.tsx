"use client";
import type { Snapshot } from "@/lib/dashboard/types";
import { fmtTokens } from "./api";

export function UsageChart({ daily }: { daily: Snapshot["usage"]["daily"] }) {
  const max = Math.max(1, ...daily.map((d) => d.tokens));
  return (
    <div className="cc-usage-chart" role="img" aria-label="AI tokens per day, last 12 days">
      {daily.map((d) => <i key={d.day} title={`${d.day}: ${fmtTokens(d.tokens)} tokens, ${d.requests} requests`} style={{ height: `${Math.max(4, Math.round((d.tokens / max) * 100))}%`, opacity: d.tokens ? 0.9 : 0.25 }} />)}
    </div>
  );
}

export default function MemoryView({ snap }: { snap: Snapshot }) {
  const g = (snap.memory.graph ?? {}) as Record<string, number>;
  const ep = (snap.memory.episodic ?? {}) as Record<string, number>;
  const providers = Object.entries(snap.usage.byProvider);
  return (
    <div className="cc-view">
      <div className="cc-card">
        <div className="cc-card-title">AI USAGE · LAST 12 DAYS</div>
        <UsageChart daily={snap.usage.daily} />
        <div className="cc-stats">
          <div><strong>{snap.usage.requests.toLocaleString()}</strong><span>REQUESTS</span></div>
          <div><strong>{fmtTokens(snap.usage.totalTokens)}</strong><span>TOKENS</span></div>
          <div><strong>{snap.usage.costUsd === null ? "n/a" : `$${snap.usage.costUsd.toFixed(2)}`}</strong><span>EST. COST</span></div>
        </div>
        {snap.usage.costUsd === null && <div className="cc-muted">Set <code>JARVIS_&lt;PROVIDER&gt;_INPUT_USD_PER_1M</code> and <code>…_OUTPUT_USD_PER_1M</code> in .env to see cost estimates.</div>}
        {providers.map(([name, v]) => <div className="cc-line" key={name}><strong>{name}</strong><span>{v.requests} req · {fmtTokens(v.tokens)} tokens{v.costUsd !== null ? ` · $${v.costUsd.toFixed(3)}` : ""}</span></div>)}
      </div>
      <div className="cc-card">
        <div className="cc-card-title">MEMORY</div>
        <div className="cc-stats">
          <div><strong>{snap.memory.memories.toLocaleString()}</strong><span>MEMORIES</span></div>
          <div><strong>{g.nodes ?? 0}</strong><span>GRAPH NODES</span></div>
          <div><strong>{g.edges ?? 0}</strong><span>RELATIONS</span></div>
          <div><strong>{ep.events ?? 0}</strong><span>EXPERIENCES</span></div>
        </div>
        {(g.uncertainEdges ?? 0) > 0 && <div className="cc-muted">{g.uncertainEdges} relation(s) are marked uncertain.</div>}
      </div>
    </div>
  );
}
