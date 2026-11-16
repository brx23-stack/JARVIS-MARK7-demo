import { toastError } from "./toast";

export async function postJson(url: string, body: unknown): Promise<any> {
  const res = await fetch(url, {
    method: "POST", credentials: "same-origin",
    headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = data.error || `HTTP ${res.status}`;
    toastError(message);
    throw new Error(message);
  }
  return data;
}

export function timeAgo(iso: string | number): string {
  const s = Math.max(0, Math.round((Date.now() - (typeof iso === "number" ? iso : Date.parse(iso))) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function fmtTokens(n: number): string {
  return n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n);
}
