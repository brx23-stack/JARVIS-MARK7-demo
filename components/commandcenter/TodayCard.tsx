"use client";
import { useCallback, useEffect, useState } from "react";
import type { Snapshot } from "@/lib/dashboard/types";
import { postJson, timeAgo } from "./api";

type Today = {
  plan: { summary: string; priorities: string[]; suggestedActions: { tool: string; title: string; reason: string }[] };
  approvalIds: string[];
  generatedAt: string;
  errors: string[];
};

export default function TodayCard({ snap, refresh }: { snap: Snapshot | null; refresh: () => void }) {
  const [today, setToday] = useState<Today | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/briefing/today", { cache: "no-store", credentials: "same-origin" });
      const json: { today?: Today | null } = await res.json().catch(() => ({}));
      if (res.ok) setToday(json.today ?? null);
    } catch { /* card stays empty */ }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const generate = async () => {
    setBusy("gen"); setError("");
    try {
      const json: { today: Today } = await postJson("/api/briefing/today", {});
      setToday(json.today); refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
    setBusy("");
  };

  const decide = async (id: string, approve: boolean) => {
    setBusy(id); setError("");
    try { await postJson("/api/approvals", { action: approve ? "approve" : "reject", id }); }
    catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
    setBusy(""); refresh();
  };

  const pending = (snap?.approvals ?? []).filter((a) => today?.approvalIds.includes(a.id));

  return (
    <div className="cc-view">
      <div className="cc-card">
        <div className="cc-row spread">
          <div className="cc-card-title">TODAY</div>
          <button className="cc-btn" disabled={busy === "gen"} onClick={() => void generate()}>
            {busy === "gen" ? "Planning…" : today ? "Refresh plan" : "Plan my day"}
          </button>
        </div>
        {error && <div className="cc-error">{error}</div>}
        {!today && !error && <p className="cc-muted">No plan yet. Generate one, or let your morning cron do it.</p>}
        {today && (<>
          <p>{today.plan.summary}</p>
          {today.plan.priorities.length > 0 && <ol>{today.plan.priorities.map((p, i) => <li key={i}>{p}</li>)}</ol>}
          <div className="cc-muted">Generated {timeAgo(today.generatedAt)}{today.errors.length > 0 ? ` · ${today.errors.join("; ")}` : ""}</div>
          {pending.map((a) => (
            <div className="cc-line" key={a.id}>
              <strong>{a.title}</strong>
              <div className="cc-row">
                <button className="cc-btn primary" disabled={busy === a.id} onClick={() => void decide(a.id, true)}>Approve</button>
                <button className="cc-btn danger" disabled={busy === a.id} onClick={() => void decide(a.id, false)}>Reject</button>
              </div>
            </div>
          ))}
        </>)}
      </div>
    </div>
  );
}
