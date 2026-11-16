// ——— Email: Gmail (read-only) ———
//
// Reuses the same Google OAuth app/refresh token as googleCalendar.ts —
// one Google Cloud project, one refresh token, scoped to both
// calendar.readonly+calendar.events and gmail.readonly. See .env.example.
//
// Deliberately read-only. JARVIS can summarize what's in your inbox, but
// sending email on your behalf is a much higher-stakes action (impersonation,
// accidental sends) that deserves its own explicit opt-in later rather than
// shipping by default here.

const REQUEST_TIMEOUT_MS = 8_000;

async function getAccessToken(): Promise<string> {
  // Re-implemented rather than imported to keep this module independently
  // deletable if someone wants calendar but not email, or vice versa.
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error("Gmail isn't configured (missing GOOGLE_CLIENT_ID/SECRET/REFRESH_TOKEN).");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      signal: controller.signal,
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
    });
    if (!res.ok) throw new Error(`Google token refresh failed (${res.status})`);
    const data = await res.json();
    return data.access_token;
  } finally {
    clearTimeout(timeout);
  }
}

export function isEmailConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REFRESH_TOKEN);
}

export type EmailSummary = { from: string; subject: string; snippet: string };

/** Returns the `count` most recent unread messages in the inbox. */
export async function getUnreadEmails(count = 5): Promise<EmailSummary[]> {
  const token = await getAccessToken();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const listRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=is:unread&maxResults=${count}`,
      { signal: controller.signal, headers: { authorization: `Bearer ${token}` } },
    );
    if (!listRes.ok) throw new Error(`Gmail returned ${listRes.status}`);
    const listData = await listRes.json();
    const ids: string[] = (listData.messages ?? []).map((m: { id: string }) => m.id);

    const results: EmailSummary[] = [];
    for (const id of ids) {
      const msgRes = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`,
        { headers: { authorization: `Bearer ${token}` } },
      );
      if (!msgRes.ok) continue;
      const msg = await msgRes.json();
      const headers: Array<{ name: string; value: string }> = msg.payload?.headers ?? [];
      const from = headers.find((h) => h.name === "From")?.value ?? "(unknown sender)";
      const subject = headers.find((h) => h.name === "Subject")?.value ?? "(no subject)";
      results.push({ from, subject, snippet: msg.snippet ?? "" });
    }
    return results;
  } finally {
    clearTimeout(timeout);
  }
}
