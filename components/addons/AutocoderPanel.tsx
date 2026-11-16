"use client";
import { useCallback, useEffect, useState, type CSSProperties } from "react";

type Verify = { ok: boolean; skipped: boolean; newErrors: string[]; repairRounds: number };
type Proposal = {
  id: string; goal: string; status: "pending" | "applied" | "rejected" | "failed" | "rolled_back";
  summary: string; diff: string; files: string[]; error?: string; verify?: Verify; autoApplied?: boolean; createdAt: string;
};
type Status = { enabled: boolean; mode: "propose" | "auto"; armed: boolean; minutesLeft: number; devServer: boolean };

const C = { cyan: "rgba(120,220,255,.95)", dim: "rgba(160,200,220,.6)", bg: "rgba(4,14,24,.96)", line: "rgba(120,220,255,.3)" };
const btn: CSSProperties = { background: "transparent", color: C.cyan, border: `1px solid ${C.line}`, borderRadius: 6, padding: "6px 10px", cursor: "pointer", font: "inherit", fontSize: 12 };

async function api(method: "GET" | "POST", body?: unknown, query = "") {
  const res = await fetch(`/api/autocoder${query}`, {
    method, credentials: "same-origin",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

/** Floating AUTOCODER button + panel. Renders nothing unless AUTOCODER_ENABLED=true on the server. */
export default function AutocoderPanel() {
  const [status, setStatus] = useState<Status | null>(null);
  const [open, setOpen] = useState(false);
  const [goal, setGoal] = useState("");
  const [items, setItems] = useState<Proposal[]>([]);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");

  const refresh = useCallback(async () => {
    try {
      const d = await api("GET");
      setStatus(d.status);
      if (d.proposals) setItems(d.proposals);
    } catch { setStatus(null); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => { if (!open) return; const t = setInterval(refresh, 8000); return () => clearInterval(t); }, [open, refresh]);

  const act = async (label: string, body: Record<string, unknown>) => {
    setBusy(label); setErr("");
    try { await api("POST", body); await refresh(); } catch (e) { setErr(e instanceof Error ? e.message : "failed"); }
    setBusy("");
  };

  if (!status?.enabled) return null;
  const color = (s: Proposal["status"]) => s === "applied" ? "#7dffb0" : s === "pending" ? "#ffd479" : s === "failed" ? "#ff8a8a" : C.dim;

  return (
    <>
      <button onClick={() => setOpen(!open)} style={{ ...btn, position: "fixed", right: 16, bottom: 64, zIndex: 40, background: C.bg, letterSpacing: 2 }}>
        ⚙ AUTOCODER{items.some((p) => p.status === "pending") ? " •" : ""}
      </button>
      {open && (
        <div style={{ position: "fixed", right: 16, bottom: 104, width: "min(560px, calc(100vw - 32px))", maxHeight: "70vh", overflow: "auto", zIndex: 41, background: C.bg, border: `1px solid ${C.line}`, borderRadius: 10, padding: 14, color: C.cyan, fontSize: 13 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, gap: 8, flexWrap: "wrap" }}>
            <strong style={{ letterSpacing: 2 }}>JARVIS AUTOCODER</strong>
            <span style={{ color: C.dim, fontSize: 11 }}>
              mode: {status.mode}{status.mode === "auto" ? (status.armed ? ` · ARMED ${status.minutesLeft}m` : " · disarmed") : ""}
            </span>
          </div>
          {!status.devServer && <div style={{ color: "#ffd479", fontSize: 11, marginBottom: 8 }}>Production build: edits are saved but need a rebuild/restart to take effect.</div>}

          <textarea value={goal} onChange={(e: { target: { value: string } }) => setGoal(e.target.value)} rows={3} placeholder="Describe a change to JARVIS… e.g. “add a /api/ping route returning the server time”"
            style={{ width: "100%", boxSizing: "border-box", background: "rgba(0,0,0,.35)", color: "#dff6ff", border: `1px solid ${C.line}`, borderRadius: 6, padding: 8, font: "inherit", resize: "vertical" }} />
          <div style={{ display: "flex", gap: 8, margin: "8px 0", flexWrap: "wrap" }}>
            <button style={btn} disabled={!!busy || !goal.trim()} onClick={() => act("propose", { action: "propose", goal }).then(() => setGoal(""))}>
              {busy === "propose" ? "Thinking…" : "Propose change"}
            </button>
            {status.mode === "auto" && (status.armed
              ? <button style={btn} onClick={() => act("disarm", { action: "disarm" })}>Disarm auto</button>
              : <button style={btn} onClick={() => act("arm", { action: "arm", minutes: 10 })}>Arm auto 10 min</button>)}
          </div>
          {err && <div style={{ color: "#ff8a8a", marginBottom: 8 }}>{err}</div>}

          {items.map((p) => (
            <div key={p.id} style={{ borderTop: `1px solid ${C.line}`, padding: "8px 0" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <span style={{ color: "#dff6ff" }}>{p.goal.slice(0, 120)}</span>
                <span style={{ color: color(p.status), whiteSpace: "nowrap", fontSize: 11 }}>{p.status.toUpperCase()}{p.autoApplied ? " · auto" : ""}</span>
              </div>
              {p.summary && <div style={{ color: C.dim, margin: "4px 0" }}>{p.summary}</div>}
              {p.files.length > 0 && <div style={{ fontSize: 11, color: C.dim }}>{p.files.join(" · ")}</div>}
              {p.error && <div style={{ color: "#ff8a8a", fontSize: 12, marginTop: 4 }}>{p.error}</div>}
              {p.verify && <div style={{ fontSize: 11, color: p.verify.ok ? "#7dffb0" : "#ff8a8a" }}>
                type-check: {p.verify.skipped ? "skipped" : p.verify.ok ? "passed" : "failed"}{p.verify.repairRounds ? ` · ${p.verify.repairRounds} auto-fix round(s)` : ""}
              </div>}
              {p.diff && p.status === "pending" && (
                <pre style={{ maxHeight: 220, overflow: "auto", background: "rgba(0,0,0,.4)", padding: 8, borderRadius: 6, fontSize: 11, whiteSpace: "pre-wrap", margin: "6px 0" }}>
                  {p.diff.split("\n").map((l, i) => <div key={i} style={{ color: l.startsWith("+ ") ? "#7dffb0" : l.startsWith("- ") ? "#ff9a9a" : l.startsWith("---") ? C.cyan : C.dim }}>{l || " "}</div>)}
                </pre>
              )}
              <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                {p.status === "pending" && <>
                  <button style={btn} disabled={!!busy} onClick={() => act("apply" + p.id, { action: "apply", id: p.id })}>{busy === "apply" + p.id ? "Applying + checking…" : "Approve & apply"}</button>
                  <button style={btn} disabled={!!busy} onClick={() => act("reject", { action: "reject", id: p.id })}>Reject</button>
                </>}
                {p.status === "applied" && <button style={btn} disabled={!!busy} onClick={() => act("rollback", { action: "rollback", id: p.id })}>Roll back</button>}
              </div>
            </div>
          ))}
          {!items.length && <div style={{ color: C.dim }}>No proposals yet.</div>}
        </div>
      )}
    </>
  );
}
