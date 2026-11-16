"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Snapshot } from "@/lib/dashboard/types";

/** Polls /api/dashboard while mounted and the tab is visible. Optionally raises a browser notification for new approvals. */
export function useDashboard(intervalMs: number) {
  const [data, setData] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [alerts, setAlerts] = useState<"unsupported" | "default" | "granted" | "denied">("default");
  const lastApprovals = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/dashboard", { cache: "no-store", credentials: "same-origin" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      const snap = json as Snapshot;
      setData(snap); setError(null);

      const n = snap.approvals.length;
      if (lastApprovals.current !== null && n > lastApprovals.current && typeof Notification !== "undefined" && Notification.permission === "granted" && document.hidden) {
        const title = "JARVIS needs your approval";
        const body = snap.approvals[0]?.title ?? "A pending action is waiting.";
        navigator.serviceWorker?.ready.then((r) => r.showNotification(title, { body, tag: "jarvis-approval" })).catch(() => new Notification(title, { body }));
      }
      lastApprovals.current = n;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Dashboard unavailable");
    }
  }, []);

  useEffect(() => {
    setAlerts(typeof Notification === "undefined" ? "unsupported" : Notification.permission);
    void refresh();
    const tick = () => { if (!document.hidden) void refresh(); };
    const t = setInterval(tick, intervalMs);
    const vis = () => { if (!document.hidden) void refresh(); };
    document.addEventListener("visibilitychange", vis);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", vis); };
  }, [intervalMs, refresh]);

  const enableAlerts = useCallback(async () => {
    if (typeof Notification === "undefined") return;
    setAlerts(await Notification.requestPermission());
  }, []);

  return { data, error, refresh, alerts, enableAlerts };
}
