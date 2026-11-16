// ——— Tool execution ———
//
// Takes a tool_call the model asked for (name + JSON-string arguments) and
// actually runs it, returning a string that gets fed back to the model as
// the tool's result. Every branch is wrapped so a bad/malformed call from
// the model degrades to an error string instead of throwing and killing
// the whole chat turn.

import { rememberFact, recallFact, forgetFact } from "@/lib/memory/store";
import { setEntityPower, setLightBrightness, setThermostat, readEntityState, isHomeAssistantConfigured } from "@/lib/smarthome/homeAssistant";
import { listUpcomingEvents, createEvent, isCalendarConfigured } from "@/lib/calendar/googleCalendar";
import { getUnreadEmails, isEmailConfigured } from "@/lib/email/gmail";
import { openApp, setSystemVolume, mediaControl } from "@/lib/system/control";
import { getCurrentWeather, formatWeatherReport } from "@/lib/weather/openMeteo";
import { convertCurrency, formatConversion } from "@/lib/currency/convert";
import type { ToolName } from "./definitions";
import { gateToolCall } from "@/lib/approvals/queue";
import { isToolInCurrentRelease } from "@/lib/privacy/policy";

const WEB_SEARCH_TIMEOUT_MS = 8_000;

async function webSearch(query: string): Promise<string> {
  // DuckDuckGo's Instant Answer API needs no API key, which keeps this tool
  // usable out of the box with zero setup. It's a lightweight summary
  // source, not a full search engine — good for quick facts/definitions,
  // weak on long-tail or very current news. Swap in Brave Search / Tavily /
  // SerpAPI here later for stronger results; nothing else needs to change.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), WEB_SEARCH_TIMEOUT_MS);
  try {
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return `Web search failed (HTTP ${res.status}).`;
    const data = await res.json();

    const parts: string[] = [];
    if (data.AbstractText) parts.push(data.AbstractText);
    else if (data.Answer) parts.push(String(data.Answer));
    else if (data.Definition) parts.push(data.Definition);

    if (Array.isArray(data.RelatedTopics)) {
      for (const topic of data.RelatedTopics.slice(0, 3)) {
        if (topic?.Text) parts.push(topic.Text);
      }
    }

    if (parts.length === 0) {
      return `No direct summary found for "${query}". Tell the user you couldn't find a clear answer and suggest they check a search engine themselves.`;
    }
    return parts.join(" ").slice(0, 1200);
  } catch (err) {
    const reason = err instanceof Error ? err.message : "unknown error";
    return `Web search failed: ${reason}`;
  } finally {
    clearTimeout(timeout);
  }
}

function getCurrentTime(timezone?: string): string {
  try {
    const now = new Date();
    const formatted = new Intl.DateTimeFormat("en-US", {
      dateStyle: "full",
      timeStyle: "long",
      timeZone: timezone || undefined,
    }).format(now);
    return formatted;
  } catch {
    // Bad/unknown timezone string from the model — fall back to server local time.
    return new Date().toString();
  }
}

export async function executeToolUngated(name: string, argsJson: string): Promise<string> {
  if (!isToolInCurrentRelease(name)) return "This capability is outside the current JARVIS MARK 7 release scope.";
  let args: Record<string, unknown>;
  try {
    args = argsJson ? JSON.parse(argsJson) : {};
  } catch {
    return `Error: tool arguments were not valid JSON.`;
  }

  const toolName = name as ToolName;

  switch (toolName) {
    case "remember_fact": {
      const key = String(args.key ?? "").trim();
      const value = String(args.value ?? "").trim();
      if (!key || !value) return "Error: both 'key' and 'value' are required.";
      await rememberFact(key, value);
      return `Remembered: ${key} = ${value}`;
    }

    case "recall_fact": {
      const key = String(args.key ?? "").trim();
      if (!key) return "Error: 'key' is required.";
      const value = await recallFact(key);
      return value === null ? `No fact stored under "${key}".` : value;
    }

    case "forget_fact": {
      const key = String(args.key ?? "").trim();
      if (!key) return "Error: 'key' is required.";
      const existed = await forgetFact(key);
      return existed ? `Forgot "${key}".` : `Nothing was stored under "${key}".`;
    }

    case "get_current_time": {
      const timezone = typeof args.timezone === "string" ? args.timezone : undefined;
      return getCurrentTime(timezone);
    }

    case "web_search": {
      const query = String(args.query ?? "").trim();
      if (!query) return "Error: 'query' is required.";
      return webSearch(query);
    }

    case "smart_home_control": {
      if (!isHomeAssistantConfigured()) return "Home Assistant isn't configured yet. Set HOME_ASSISTANT_URL and HOME_ASSISTANT_TOKEN to enable smart home control.";
      const entityId = String(args.entity_id ?? "").trim();
      const action = String(args.action ?? "");
      if (!entityId) return "Error: 'entity_id' is required.";
      try {
        if (action === "turn_on") { await setEntityPower(entityId, true); return `Turned on ${entityId}.`; }
        if (action === "turn_off") { await setEntityPower(entityId, false); return `Turned off ${entityId}.`; }
        if (action === "set_brightness") {
          const value = Number(args.value);
          if (!Number.isFinite(value)) return "Error: 'value' (0-100) is required for set_brightness.";
          await setLightBrightness(entityId, value);
          return `Set ${entityId} brightness to ${value}%.`;
        }
        if (action === "set_temperature") {
          const value = Number(args.value);
          if (!Number.isFinite(value)) return "Error: 'value' (degrees) is required for set_temperature.";
          await setThermostat(entityId, value);
          return `Set ${entityId} target temperature to ${value}.`;
        }
        return `Error: unknown action "${action}".`;
      } catch (err) {
        return `Smart home command failed: ${err instanceof Error ? err.message : "unknown error"}`;
      }
    }

    case "smart_home_status": {
      if (!isHomeAssistantConfigured()) return "Home Assistant isn't configured yet. Set HOME_ASSISTANT_URL and HOME_ASSISTANT_TOKEN to enable smart home control.";
      const entityId = String(args.entity_id ?? "").trim();
      if (!entityId) return "Error: 'entity_id' is required.";
      try {
        const state = await readEntityState(entityId);
        return `${entityId} is currently: ${state}`;
      } catch (err) {
        return `Couldn't read ${entityId}: ${err instanceof Error ? err.message : "unknown error"}`;
      }
    }

    case "get_upcoming_events": {
      if (!isCalendarConfigured()) return "Google Calendar isn't configured yet. See .env.example for setup steps.";
      const hoursAhead = Number.isFinite(Number(args.hours_ahead)) ? Number(args.hours_ahead) : 24;
      try {
        const events = await listUpcomingEvents(hoursAhead);
        if (events.length === 0) return `No events in the next ${hoursAhead} hours.`;
        return events.map((e) => `${e.summary} (${e.start} to ${e.end}${e.location ? `, at ${e.location}` : ""})`).join("; ");
      } catch (err) {
        return `Couldn't fetch calendar: ${err instanceof Error ? err.message : "unknown error"}`;
      }
    }

    case "create_calendar_event": {
      if (!isCalendarConfigured()) return "Google Calendar isn't configured yet. See .env.example for setup steps.";
      const summary = String(args.summary ?? "").trim();
      const startIso = String(args.start_iso ?? "").trim();
      const endIso = String(args.end_iso ?? "").trim();
      const location = typeof args.location === "string" ? args.location : undefined;
      if (!summary || !startIso || !endIso) return "Error: 'summary', 'start_iso', and 'end_iso' are required.";
      try {
        await createEvent(summary, startIso, endIso, location);
        return `Created "${summary}" from ${startIso} to ${endIso}.`;
      } catch (err) {
        return `Couldn't create event: ${err instanceof Error ? err.message : "unknown error"}`;
      }
    }

    case "check_unread_email": {
      if (!isEmailConfigured()) return "Gmail isn't configured yet. See .env.example for setup steps.";
      const count = Number.isFinite(Number(args.count)) ? Number(args.count) : 5;
      try {
        const emails = await getUnreadEmails(count);
        if (emails.length === 0) return "No unread email.";
        return emails.map((e) => `From ${e.from}: "${e.subject}" — ${e.snippet}`).join(" | ");
      } catch (err) {
        return `Couldn't check email: ${err instanceof Error ? err.message : "unknown error"}`;
      }
    }

    case "open_app": {
      const name = String(args.name ?? "").trim();
      if (!name) return "Error: 'name' is required.";
      return openApp(name);
    }

    case "set_system_volume": {
      const percent = Number(args.percent);
      if (!Number.isFinite(percent)) return "Error: 'percent' is required.";
      return setSystemVolume(percent);
    }

    case "media_control": {
      const action = String(args.action ?? "") as "play" | "pause" | "next" | "previous";
      if (!["play", "pause", "next", "previous"].includes(action)) return "Error: invalid action.";
      return mediaControl(action);
    }

    case "get_weather": {
      const place = String(args.place ?? "").trim();
      if (!place) return "Error: 'place' is required.";
      try {
        const report = await getCurrentWeather(place);
        return formatWeatherReport(report);
      } catch (err) {
        return `Couldn't get weather: ${err instanceof Error ? err.message : "unknown error"}`;
      }
    }

    case "convert_currency": {
      const amount = Number(args.amount);
      const from = String(args.from ?? "").trim();
      const to = String(args.to ?? "").trim();
      if (!Number.isFinite(amount) || !from || !to) return "Error: 'amount', 'from', and 'to' are required.";
      try {
        const result = await convertCurrency(amount, from, to);
        return formatConversion(result);
      } catch (err) {
        return `Couldn't convert currency: ${err instanceof Error ? err.message : "unknown error"}`;
      }
    }

    default:
      return `Error: unknown tool "${name}".`;
  }
}

/** Public entry point. Identical to before unless JARVIS_APPROVAL_TOOLS lists this tool (then it waits for owner approval). */
export async function executeTool(name: string, argsJson: string): Promise<string> {
  if (!isToolInCurrentRelease(name)) return "This capability is outside the current JARVIS MARK 7 release scope.";
  return gateToolCall(name, argsJson, () => executeToolUngated(name, argsJson));
}
