// ——— Calendar: Google Calendar ———
//
// Uses a Google OAuth refresh token obtained once, up front (see
// .env.example for the exact steps), rather than an interactive OAuth flow
// at runtime — JARVIS is a personal assistant running for one user, so
// there's no "sign in with Google" screen to build; the token is a
// one-time setup step in .env.local, same pattern as every other
// credential in this project.
//
// This module exchanges that refresh token for a short-lived access token
// (cached until near expiry) on demand, then calls the Calendar API.

const REQUEST_TIMEOUT_MS = 8_000;

type CachedToken = { accessToken: string; expiresAt: number };
let cachedToken: CachedToken | null = null;

function getConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) return null;
  return { clientId, clientSecret, refreshToken };
}

export function isCalendarConfigured(): boolean {
  return getConfig() !== null;
}

async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) {
    return cachedToken.accessToken;
  }
  const config = getConfig();
  if (!config) throw new Error("Google Calendar isn't configured (missing GOOGLE_CLIENT_ID/SECRET/REFRESH_TOKEN).");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      signal: controller.signal,
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        refresh_token: config.refreshToken,
        grant_type: "refresh_token",
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Google token refresh failed (${res.status}): ${text.slice(0, 200)}`);
    }
    const data = await res.json();
    cachedToken = { accessToken: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
    return cachedToken.accessToken;
  } finally {
    clearTimeout(timeout);
  }
}

export type CalendarEvent = {
  summary: string;
  start: string; // human-readable
  end: string;
  location?: string;
};

/** Lists upcoming events between now and `hoursAhead` hours from now (default 24). */
export async function listUpcomingEvents(hoursAhead = 24): Promise<CalendarEvent[]> {
  const token = await getAccessToken();
  const now = new Date();
  const later = new Date(now.getTime() + hoursAhead * 60 * 60 * 1000);

  const params = new URLSearchParams({
    timeMin: now.toISOString(),
    timeMax: later.toISOString(),
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "10",
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
      { signal: controller.signal, headers: { authorization: `Bearer ${token}` } },
    );
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Google Calendar returned ${res.status}: ${text.slice(0, 200)}`);
    }
    const data = await res.json();
    const items = Array.isArray(data.items) ? data.items : [];
    return items.map((item: Record<string, unknown>) => {
      const start = item.start as Record<string, string> | undefined;
      const end = item.end as Record<string, string> | undefined;
      return {
        summary: String(item.summary ?? "(untitled)"),
        start: start?.dateTime ?? start?.date ?? "",
        end: end?.dateTime ?? end?.date ?? "",
        location: item.location ? String(item.location) : undefined,
      };
    });
  } finally {
    clearTimeout(timeout);
  }
}

/** Creates a new calendar event. startIso/endIso must be full ISO 8601 datetimes. */
export async function createEvent(summary: string, startIso: string, endIso: string, location?: string): Promise<void> {
  const token = await getAccessToken();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events", {
      method: "POST",
      signal: controller.signal,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        summary,
        location,
        start: { dateTime: startIso },
        end: { dateTime: endIso },
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Google Calendar returned ${res.status}: ${text.slice(0, 200)}`);
    }
  } finally {
    clearTimeout(timeout);
  }
}
