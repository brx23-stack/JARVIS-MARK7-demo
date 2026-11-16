"use client";
import { useEffect, useState } from "react";

type Toast = { id: number; message: string };
let nextId = 1;

/** Listens for jarvis:toast events plus uncaught errors/rejections and shows them for 7 seconds. */
export default function Toaster() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    const push = (raw: unknown) => {
      const message = String(raw || "Something went wrong").slice(0, 240);
      setToasts((cur) => {
        if (cur.some((t) => t.message === message)) return cur; // de-dupe repeats (e.g. polling failures)
        const id = nextId++;
        window.setTimeout(() => setToasts((c) => c.filter((t) => t.id !== id)), 7000);
        return [...cur.slice(-3), { id, message }];
      });
    };
    const onToast = (e: Event) => push((e as CustomEvent<string>).detail);
    const onError = (e: ErrorEvent) => push(e.message);
    const onRejection = (e: PromiseRejectionEvent) => push(e.reason instanceof Error ? e.reason.message : e.reason);
    window.addEventListener("jarvis:toast", onToast);
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("jarvis:toast", onToast);
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  if (toasts.length === 0) return null;
  return (
    <div className="cc-toasts" role="alert" aria-live="assertive">
      {toasts.map((t) => (
        <div className="cc-toast" key={t.id}>
          <span>{t.message}</span>
          <button aria-label="Dismiss" onClick={() => setToasts((c) => c.filter((x) => x.id !== t.id))}>×</button>
        </div>
      ))}
    </div>
  );
}
