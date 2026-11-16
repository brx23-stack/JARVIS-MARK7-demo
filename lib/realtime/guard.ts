// Spend guard + kill switch for Realtime key minting (in-memory, per server process).
type G = { day: string; minted: number; lastMint: number; killed: boolean };
const K = "__jarvisRealtimeGuard";
const g = globalThis as typeof globalThis & { [K]?: G };
const num = (v: string | undefined, d: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : d;
};

export function limits() {
  return {
    maxMintsPerDay: num(process.env.REALTIME_MAX_MINTS_PER_DAY, 20),
    maxSessionSeconds: num(process.env.REALTIME_MAX_SESSION_SECONDS, 300),
    minGapMs: num(process.env.REALTIME_MIN_GAP_SECONDS, 15) * 1000,
  };
}

function st(): G {
  const today = new Date().toISOString().slice(0, 10);
  const cur = g[K];
  if (!cur) return (g[K] = { day: today, minted: 0, lastMint: 0, killed: false });
  if (cur.day !== today) { cur.day = today; cur.minted = 0; }
  return cur;
}

export function checkAndCount(): { ok: true } | { ok: false; status: number; error: string } {
  if (process.env.REALTIME_ENABLED === "false") return { ok: false, status: 403, error: "Realtime voice is disabled (REALTIME_ENABLED=false)." };
  const s = st(), l = limits();
  if (s.killed) return { ok: false, status: 423, error: "Realtime voice is switched off (kill switch)." };
  if (Date.now() - s.lastMint < l.minGapMs) return { ok: false, status: 429, error: "Wait a few seconds before starting another voice session." };
  if (s.minted >= l.maxMintsPerDay) return { ok: false, status: 429, error: "Daily Realtime session cap reached." };
  s.minted += 1; s.lastMint = Date.now();
  return { ok: true };
}

export const setKilled = (v: boolean) => { st().killed = v; };
export const guardStatus = () => ({ ...limits(), minted: st().minted, killed: st().killed });

// Daily cap on tool calls made by the voice model (server-side).
let toolDay = "", toolCalls = 0;
export function countToolCall(): boolean {
  const today = new Date().toISOString().slice(0, 10);
  if (toolDay !== today) { toolDay = today; toolCalls = 0; }
  const max = Number(process.env.REALTIME_MAX_TOOL_CALLS_PER_DAY) || 100;
  if (toolCalls >= max) return false;
  toolCalls += 1; return true;
}
