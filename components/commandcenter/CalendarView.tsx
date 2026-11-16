"use client";
import type { Snapshot } from "@/lib/dashboard/types";

export function fmtEventTime(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return iso.length <= 10 ? "All day" : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function CalendarView({ snap, onCommand }: { snap: Snapshot; onCommand: (c: string) => void }) {
  const { calendar, weather, integrations } = snap;
  return (
    <div className="cc-view">
      {weather && <div className="cc-card"><div className="cc-card-title">WEATHER</div><strong>{weather.tempC}°C · {weather.condition}</strong><div className="cc-muted">{weather.place}</div></div>}
      <div className="cc-card">
        <div className="cc-card-title">NEXT 24 HOURS</div>
        {!calendar.configured && (
          <div className="cc-empty">Google Calendar isn&apos;t connected. Add <code>GOOGLE_CLIENT_ID</code>, <code>GOOGLE_CLIENT_SECRET</code> and <code>GOOGLE_REFRESH_TOKEN</code> to <code>.env</code> (steps in .env.example).</div>
        )}
        {calendar.configured && calendar.error && <div className="cc-error">{calendar.error}</div>}
        {calendar.configured && !calendar.error && calendar.events.length === 0 && <div className="cc-empty">Nothing scheduled in the next 24 hours.</div>}
        {calendar.events.map((e, i) => (
          <div className="cc-event" key={`${e.start}-${i}`}>
            <span>{fmtEventTime(e.start)}</span>
            <div><strong>{e.summary}</strong>{e.location && <small>{e.location}</small>}</div>
          </div>
        ))}
        {calendar.configured && <div className="cc-row"><button className="cc-btn" onClick={() => onCommand("Add a calendar event for me. Ask me for the title and time.")}>Add event by voice/chat</button></div>}
      </div>
      <div className="cc-card">
        <div className="cc-card-title">INTEGRATIONS</div>
        {([["Calendar", integrations.calendar], ["Gmail", integrations.email], ["Telegram", integrations.telegram], ["Discord", integrations.discord]] as const).map(([n, on]) => (
          <div className="cc-line" key={n}><span className={`cc-badge ${on ? "completed" : "planned"}`}>{on ? "CONNECTED" : "NOT SET UP"}</span><span>{n}</span></div>
        ))}
      </div>
    </div>
  );
}
