"use client";

import { useEffect, useState } from "react";

type PrivacyStatus = { mode: string; localOnly: boolean; controls: Record<string, boolean>; limitations: string[] };

export default function PrivacyView() {
  const [status, setStatus] = useState<PrivacyStatus | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    let active = true;
    fetch("/api/privacy", { cache: "no-store" }).then(async (res) => {
      if (!res.ok) throw new Error(res.status === 401 ? "Sign in to view privacy status." : "Privacy status unavailable.");
      return res.json();
    }).then((data) => { if (active) setStatus(data); }).catch((e) => { if (active) setError(e.message); });
    return () => { active = false; };
  }, []);

  async function exportData() {
    setBusy(true); setError(""); setMessage("");
    try {
      const res = await fetch("/api/privacy/data", { cache: "no-store" });
      if (!res.ok) throw new Error("Could not export personal data.");
      const blob = await res.blob(); const url = URL.createObjectURL(blob);
      const link = document.createElement("a"); link.href = url; link.download = "jarvis-personal-data-export.json"; document.body.appendChild(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1500);
      setMessage("Personal data export prepared.");
    } catch (e) { setError(e instanceof Error ? e.message : "Export failed."); }
    finally { setBusy(false); }
  }

  async function deleteData() {
    if (!window.confirm("Delete all local JARVIS memory, learning records, goals, task history, usage records, Autocoder history/snapshots, and the local browser profile? This cannot be undone. Export first if you may need a copy.")) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const res = await fetch("/api/privacy/data", { method: "DELETE", headers: { "x-jarvis-confirm-delete": "DELETE_ALL_PERSONAL_DATA" } });
      const data = await res.json(); if (!res.ok) throw new Error(data.error || "Deletion failed.");
      setMessage(`Deleted ${data.deleted.length} local data files. ${data.note}`);
    } catch (e) { setError(e instanceof Error ? e.message : "Deletion failed."); }
    finally { setBusy(false); }
  }

  return <section className="cc-view-stack">
    <div className="cc-view-heading"><div><div className="cc-section-kicker">PRIVACY & SECURITY</div><h2>Your data. Your boundaries.</h2><p>Review the server-enforced privacy mode and the remaining limits of the current build.</p></div></div>
    {error && <div className="cc-banner error">{error}</div>}
    {message && <div className="cc-banner">{message}</div>}
    {status && <>
      <div className="cc-panel cc-privacy-mode"><div><span>ACTIVE PRIVACY MODE</span><strong>{status.localOnly ? "LOCAL ONLY" : "STANDARD"}</strong><p>{status.localOnly ? "Cloud LLMs, cloud fallback, online TTS, network tools and autonomous agent execution are blocked by the server policy." : "Configured providers and integrations may send data to external services. Review each provider before use."}</p></div><b className={status.localOnly ? "local" : "standard"}>{status.localOnly ? "RESTRICTED" : "CONFIGURED"}</b></div>
      <div className="cc-panel cc-privacy-panel"><div className="cc-panel-head"><span>SERVER-ENFORCED CONTROLS</span></div><div className="cc-privacy-grid">{Object.entries(status.controls).map(([key, enabled]) => <div key={key}><span>{key.replace(/[A-Z]/g, (m) => ` ${m}`).toUpperCase()}</span><strong className={enabled ? "allowed" : "blocked"}>{enabled ? "AVAILABLE" : "BLOCKED"}</strong></div>)}</div></div>
      <div className="cc-panel cc-privacy-panel"><div className="cc-panel-head"><span>KNOWN LIMITATIONS</span></div><ul>{status.limitations.map((item, i) => <li key={i}>{item}</li>)}</ul></div>
      <div className="cc-panel cc-privacy-panel"><div className="cc-panel-head"><span>YOUR LOCAL DATA</span></div><p>Export a copy of JARVIS facts, learning history, semantic memory, knowledge graph, Personal Evolution goals, agent tasks, usage records, and Autocoder proposal/audit text. Deletion removes these local files only; it cannot erase external provider records or your backups.</p><div className="cc-privacy-actions"><button type="button" disabled={busy} onClick={exportData}>EXPORT MY DATA</button><button type="button" disabled={busy} onClick={deleteData}>DELETE LOCAL PERSONAL DATA</button></div></div>
      <div className="cc-panel cc-privacy-panel"><div className="cc-panel-head"><span>HOW TO ENABLE LOCAL-ONLY MODE</span></div><p>Set these values in your server-side <code>.env.local</code> file, then restart JARVIS:</p><pre>JARVIS_PRIVACY_MODE=local_only{"\n"}LLM_PROVIDER=ollama{"\n"}LOCAL_LLM_BASE_URL=http://localhost:11434/v1{"\n"}LLM_FALLBACK_PROVIDER=</pre><p>Local-only mode is not a full network air gap. Keep remote gateways and optional integrations disabled separately. See <code>docs/PRIVACY.md</code> for the complete data inventory.</p></div>
    </>}
  </section>;
}
