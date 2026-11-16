// ——— Proactive briefing ———
//
// Composes a short spoken/text briefing from whatever data sources are
// configured (calendar, email — smart home status could be added the same
// way). Each source is independently optional: if it's not configured or a
// call fails, that section is just omitted rather than failing the whole
// briefing, so a half-configured setup still produces something useful.

import { isCalendarConfigured, listUpcomingEvents } from "@/lib/calendar/googleCalendar";
import { isEmailConfigured, getUnreadEmails } from "@/lib/email/gmail";
import { getCurrentWeather, formatWeatherReport } from "@/lib/weather/openMeteo";

export async function composeBriefing(place?: string): Promise<string> {
  const parts: string[] = [];

  if (place) {
    try {
      const report = await getCurrentWeather(place);
      parts.push(formatWeatherReport(report));
    } catch (err) {
      console.warn("[briefing] weather fetch failed:", err);
    }
  }

  if (isCalendarConfigured()) {
    try {
      const events = await listUpcomingEvents(12);
      parts.push(
        events.length === 0
          ? "Nothing on the calendar in the next 12 hours."
          : `Next 12 hours: ${events.map((e) => `${e.summary} at ${e.start}`).join("; ")}.`,
      );
    } catch (err) {
      console.warn("[briefing] calendar fetch failed:", err);
    }
  }

  if (isEmailConfigured()) {
    try {
      const emails = await getUnreadEmails(5);
      parts.push(
        emails.length === 0
          ? "No unread email."
          : `${emails.length} unread: ${emails.map((e) => `${e.from} — ${e.subject}`).join("; ")}.`,
      );
    } catch (err) {
      console.warn("[briefing] email fetch failed:", err);
    }
  }

  if (parts.length === 0) {
    return "Good morning. No calendar or email sources are configured yet, so this is just a placeholder briefing.";
  }

  return `Good morning. ${parts.join(" ")}`;
}
