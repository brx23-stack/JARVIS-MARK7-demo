"use client";
import { useState } from "react";
import type { Snapshot } from "@/lib/dashboard/types";
import { postJson, timeAgo } from "./api";

export default function ApprovalsView({ snap, refresh, alerts, enableAlerts }: {
  snap: Snapshot; refresh: () => void; alerts: string; enableAlerts: () => void;
}) {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const decide = async (a: Snapshot["approvals"][number], approve: boolean) => {
    setBusy(a.id); setError("");
    try {
      if (a.source === "autocoder") await postJson("/api/autocoder", { action: approve ? "apply" : "reject", id: a.id });
      else await postJson("/api/approvals", { action: approve ? "approve" : "reject", id: a.id });
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
    setBusy(""); refresh();
  };

  const configured = snap.integrations.approvalTools.length > 0 || snap.integrations.autocoder.enabled;

  return (
    <div className="cc-view">
      <div className="cc-card">
        <div className="cc-card-title">APPROVALS INBOX</div>
        <p className="cc-muted">Risky actions wait here until you approve them. Telegram/Discord and the AI can request an action, but only this signed-in screen can approve it.</p>
        {alerts === "default" && <button className="cc-btn" onClick={enableAlerts}>Alert me when something needs approval</button>}
        {alerts === "granted" && <div className="cc-ok">Browser alerts are on.</div>}
        {!configured && (
          <div className="cc-empty">
            Nothing can request approval yet. In <code>.env</code> set <code>JARVIS_APPROVAL_TOOLS=create_calendar_event,smart_home_control,open_app</code> to hold those tool calls, and/or <code>AUTOCODER_ENABLED=true</code> for code changes.
          </div>
        )}
        {configured && snap.integrations.approvalTools.length > 0 && <div className="cc-muted">Held tools: {snap.integrations.approvalTools.join(", ")}</div>}
        {error && <div className="cc-error">{error}</div>}
      </div>

      {configured && snap.approvals.length === 0 && <div className="cc-empty">All clear — nothing is waiting for you.</div>}
      {snap.approvals.map((a) => (
        <div className="cc-card" key={a.id}>
          <div className="cc-row spread">
            <strong>{a.title}</strong><span className="cc-muted">{timeAgo(a.createdAt)}</span>
          </div>
          {a.detail && <pre className="cc-pre">{a.detail}</pre>}
          {a.files && a.files.length > 0 && <div className="cc-muted">{a.files.join(" · ")}</div>}
          {a.diff && (
            <pre className="cc-pre cc-diff">
              {a.diff.split("\n").slice(0, 160).map((l, i) => (
                <div key={i} className={l.startsWith("+ ") ? "add" : l.startsWith("- ") ? "del" : l.startsWith("---") ? "hdr" : ""}>{l || " "}</div>
              ))}
            </pre>
          )}
          <div className="cc-row">
            <button className="cc-btn primary" disabled={busy === a.id} onClick={() => void decide(a, true)}>{busy === a.id ? "Working…" : a.source === "autocoder" ? "Approve & apply" : "Approve"}</button>
            <button className="cc-btn danger" disabled={busy === a.id} onClick={() => void decide(a, false)}>Reject</button>
          </div>
        </div>
      ))}

      {snap.recentDecisions.length > 0 && (
        <div className="cc-card">
          <div className="cc-card-title">RECENT DECISIONS</div>
          {snap.recentDecisions.map((d) => (
            <div className="cc-line" key={d.id}><span className={`cc-badge ${d.status}`}>{d.status.toUpperCase()}</span><span>{d.tool}</span>{d.result && <em>{d.result.slice(0, 120)}</em>}</div>
          ))}
        </div>
      )}
    </div>
  );
}
