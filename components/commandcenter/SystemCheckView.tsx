"use client";
import { useCallback, useEffect, useState } from "react";
import { postJson } from "./api";

type Item = { id: string; label: string; configured: boolean; missing: string[]; note?: string };
type Result = { ok: boolean; message: string; ms: number };

export default function SystemCheckView() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [results, setResults] = useState<Record<string, Result>>({});
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/system-check", { cache: "no-store", credentials: "same-origin" });
      const json: { integrations?: Item[]; error?: string } = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setItems(json.integrations ?? []); setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const run = async (id: string) => {
    setBusy(id);
    try {
      const json: { result: Result } = await postJson("/api/system-check", { id });
      setResults((r) => ({ ...r, [id]: json.result }));
    } catch { /* postJson already showed a toast */ }
    setBusy("");
  };

  return (
    <div className="cc-view">
      <div className="cc-card">
        <div className="cc-row spread">
          <div className="cc-card-title">SYSTEM CHECK</div>
          <button className="cc-btn" onClick={() => void load()}>Re-scan</button>
        </div>
        <p className="cc-muted">Each integration, what is missing in <code>.env</code> (names only), and a live test. Restart JARVIS after editing <code>.env</code>.</p>
        {error && <div className="cc-error">{error}</div>}
        {!items && !error && <div className="cc-empty">Scanning…</div>}
      </div>
      {items?.map((it) => {
        const r = results[it.id];
        return (
          <div className="cc-card" key={it.id}>
            <div className="cc-row spread">
              <strong>{it.label}</strong>
              <span className={`cc-badge ${it.configured ? "approved" : "rejected"}`}>{it.configured ? "CONFIGURED" : "MISSING"}</span>
            </div>
            {it.missing.length > 0 && <div className="cc-muted">Missing: {it.missing.map((m) => <code key={m}> {m} </code>)}</div>}
            {it.note && <div className="cc-muted">{it.note}</div>}
            {r && <div className={r.ok ? "cc-ok" : "cc-error"}>{r.ok ? "✓" : "✗"} {r.message} ({r.ms} ms)</div>}
            <div className="cc-row">
              <button className="cc-btn primary" disabled={!it.configured || busy === it.id} onClick={() => void run(it.id)}>
                {busy === it.id ? "Testing…" : "Test"}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
