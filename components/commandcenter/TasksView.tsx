"use client";
import { useState } from "react";
import type { Snapshot, TaskView } from "@/lib/dashboard/types";
import { postJson, timeAgo } from "./api";

const LABEL: Record<string, string> = { planned: "PLANNED", running: "RUNNING", completed: "DONE", failed: "FAILED", paused: "PAUSED" };

function progress(t: TaskView) {
  const done = t.steps.filter((s) => s.status === "completed" || s.status === "verified").length;
  return { done, total: t.steps.length, pct: t.steps.length ? Math.round((done / t.steps.length) * 100) : 0 };
}

export default function TasksView({ snap, refresh, onBusy }: { snap: Snapshot; refresh: () => void; onBusy: (b: boolean) => void }) {
  const [goal, setGoal] = useState("");
  const [running, setRunning] = useState<string | null>(null);
  const [error, setError] = useState("");

  const run = async (g: string, taskId?: string) => {
    setError(""); setRunning(taskId ?? "new"); onBusy(true);
    try { await postJson("/api/agent", { goal: g, taskId }); } catch (e) { setError(e instanceof Error ? e.message : "Task failed"); }
    setRunning(null); onBusy(false); refresh();
  };

  return (
    <div className="cc-view">
      <div className="cc-card">
        <div className="cc-card-title">START A TASK</div>
        <textarea className="cc-input" rows={3} value={goal} onChange={(e: { target: { value: string } }) => setGoal(e.target.value)}
          placeholder="Describe a goal. JARVIS will plan it, run the steps with its tools, then verify the result." />
        <div className="cc-row">
          <button className="cc-btn primary" disabled={!goal.trim() || running !== null} onClick={() => { const g = goal.trim(); setGoal(""); void run(g); }}>
            {running === "new" ? "Working…" : "Run task"}
          </button>
          <span className="cc-muted">Steps update live while it runs.</span>
        </div>
        {error && <div className="cc-error">{error}</div>}
      </div>

      <div className="cc-stats">
        <div><strong>{snap.tasks.running}</strong><span>RUNNING</span></div>
        <div><strong>{snap.tasks.paused}</strong><span>PAUSED</span></div>
        <div><strong>{snap.tasks.completed}</strong><span>COMPLETED</span></div>
        <div><strong>{snap.tasks.failed}</strong><span>FAILED</span></div>
      </div>

      {snap.tasks.items.length === 0 && <div className="cc-empty">No tasks yet. Start one above, or ask JARVIS for something multi-step.</div>}
      {snap.tasks.items.map((t) => {
        const p = progress(t);
        const resumable = (t.status === "paused" || t.status === "running") && running !== t.id;
        return (
          <details className="cc-card cc-task" key={t.id} open={t.status === "running" || t.status === "paused"}>
            <summary>
              <span className={`cc-badge ${t.status}`}>{LABEL[t.status] ?? t.status}</span>
              <span className="cc-task-goal">{t.goal}</span>
              <span className="cc-muted">{p.done}/{p.total} · {timeAgo(t.updatedAt)}</span>
            </summary>
            <div className="cc-progress"><i style={{ width: `${p.pct}%` }} /></div>
            <ol className="cc-steps">
              {t.steps.map((s) => (
                <li key={s.id} className={s.status}>
                  <b>{s.status === "completed" || s.status === "verified" ? "✓" : s.status === "failed" ? "✕" : s.status === "running" ? "…" : "○"}</b>
                  <div><strong>{s.title}</strong>{(s.error || s.result) && <p>{s.error || s.result}</p>}</div>
                </li>
              ))}
            </ol>
            {t.toolsUsed.length > 0 && <div className="cc-muted">Tools used: {t.toolsUsed.join(", ")}</div>}
            {t.verification && <div className={t.verification.ok ? "cc-ok" : "cc-error"}>QA: {t.verification.summary}</div>}
            {resumable && <div className="cc-row"><button className="cc-btn" disabled={running !== null} onClick={() => void run(t.goal, t.id)}>{running === t.id ? "Working…" : "Resume"}</button></div>}
          </details>
        );
      })}
    </div>
  );
}
