import { agentLLM } from "@/lib/agents/provider";
import { getActiveProvider, getApiKey } from "@/lib/serverKey";
import { isCalendarConfigured, listUpcomingEvents } from "@/lib/calendar/googleCalendar";
import { isEmailConfigured, getUnreadEmails } from "@/lib/email/gmail";
import { getCurrentWeather } from "@/lib/weather/openMeteo";
import { missingEnv, redact } from "./envCheck";

export type IntegrationStatus = { id: string; label: string; configured: boolean; missing: string[]; note?: string };
export type TestResult = { ok: boolean; message: string; ms: number };

type Def = {
  id: string; label: string; env: string[]; note?: string;
  check?: () => { configured: boolean; missing: string[] };
  test: () => Promise<string>;
};

const GOOGLE = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REFRESH_TOKEN"];

async function getJson(url: string, headers: Record<string, string> = {}): Promise<{ status: number; json: unknown }> {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
  const json: unknown = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return { status: res.status, json };
}

const DEFS: Def[] = [
  {
    id: "llm", label: "AI provider", env: [],
    note: "API keys are kept in memory only; enter one in the AI panel after each restart.",
    check: () => {
      const p = getActiveProvider();
      const ok = Boolean(p && getApiKey(p));
      return { configured: ok, missing: ok ? [] : ["an active provider with an API key (set it in the AI panel)"] };
    },
    test: async () => {
      const r = await agentLLM([{ role: "user", content: "Reply with the single word OK." }], { role: "chat", maxTokens: 8, timeoutMs: 15000 });
      return `Replied: ${(r.content ?? "").trim().slice(0, 40) || "(empty)"}`;
    },
  },
  {
    id: "calendar", label: "Google Calendar", env: GOOGLE,
    check: () => ({ configured: isCalendarConfigured(), missing: missingEnv(GOOGLE) }),
    test: async () => `Read OK, ${(await listUpcomingEvents(24)).length} event(s) in the next 24 h`,
  },
  {
    id: "email", label: "Gmail (unread)", env: GOOGLE,
    check: () => ({ configured: isEmailConfigured(), missing: missingEnv(GOOGLE) }),
    test: async () => `Read OK, ${(await getUnreadEmails(1)).length} unread fetched`,
  },
  {
    id: "weather", label: "Weather (Open-Meteo)", env: [], note: "No key needed. Set BRIEFING_DEFAULT_PLACE for the daily plan.",
    test: async () => {
      const place = process.env.BRIEFING_DEFAULT_PLACE || "London";
      await getCurrentWeather(place);
      return `Fetched weather for ${place}`;
    },
  },
  {
    id: "telegram", label: "Telegram bot", env: ["TELEGRAM_BOT_TOKEN", "TELEGRAM_WEBHOOK_SECRET"],
    note: "TELEGRAM_BRIEFING_CHAT_ID is optional (only for pushed briefings).",
    test: async () => {
      const { json } = await getJson(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/getMe`);
      const name = (json as { result?: { username?: string } } | null)?.result?.username;
      return name ? `Bot @${name} reachable` : "Telegram reachable";
    },
  },
  {
    id: "discord", label: "Discord", env: ["DISCORD_PUBLIC_KEY", "DISCORD_APPLICATION_ID"],
    test: async () => "Keys are set. Discord can only be verified when it sends you an interaction.",
  },
  {
    id: "cron", label: "Daily plan trigger (cron)", env: ["REMOTE_ADMIN_TOKEN"],
    note: "Lets cron / Task Scheduler call POST /api/briefing/today. See docs/DAILY_BRIEFING.md.",
    test: async () => "Admin token is set; the cron call can authenticate.",
  },
];

export function listIntegrations(): IntegrationStatus[] {
  return DEFS.map((d) => {
    const c = d.check ? d.check() : { configured: missingEnv(d.env).length === 0, missing: missingEnv(d.env) };
    return { id: d.id, label: d.label, configured: c.configured, missing: c.missing, note: d.note };
  });
}

export async function testIntegration(id: string): Promise<TestResult | null> {
  const def = DEFS.find((d) => d.id === id);
  if (!def) return null;
  const started = Date.now();
  const secrets = DEFS.flatMap((d) => d.env.map((n) => process.env[n]));
  try {
    const message = await def.test();
    return { ok: true, message: redact(message, secrets).slice(0, 200), ms: Date.now() - started };
  } catch (err) {
    const raw = err instanceof Error ? err.message : "failed";
    return { ok: false, message: redact(raw, secrets).slice(0, 200), ms: Date.now() - started };
  }
}
