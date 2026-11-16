import { isCalendarConfigured, listUpcomingEvents, type CalendarEvent } from "@/lib/calendar/googleCalendar";
import { isEmailConfigured, getUnreadEmails, type EmailSummary } from "@/lib/email/gmail";
import { getCurrentWeather, type WeatherReport } from "@/lib/weather/openMeteo";

export type DayData = {
  generatedAt: string; // ISO timestamp
  place: string | null;
  weather: WeatherReport | null;
  events: CalendarEvent[];
  unreadEmails: EmailSummary[];
  errors: string[]; // one line per source that failed
};

async function attempt<T>(label: string, errors: string[], fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    errors.push(`${label}: ${err instanceof Error ? err.message : String(err)}`);
    return fallback;
  }
}

/** Collects today's raw inputs. Every source is optional; failures land in `errors`. */
export async function collectDayData(place?: string, hoursAhead = 24, emailCount = 5): Promise<DayData> {
  const errors: string[] = [];

  const [weather, events, unreadEmails] = await Promise.all([
    place ? attempt("weather", errors, () => getCurrentWeather(place), null) : Promise.resolve(null),
    isCalendarConfigured()
      ? attempt("calendar", errors, () => listUpcomingEvents(hoursAhead), [] as CalendarEvent[])
      : Promise.resolve([] as CalendarEvent[]),
    isEmailConfigured()
      ? attempt("email", errors, () => getUnreadEmails(emailCount), [] as EmailSummary[])
      : Promise.resolve([] as EmailSummary[]),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    place: place ?? null,
    weather,
    events,
    unreadEmails,
    errors,
  };
}
