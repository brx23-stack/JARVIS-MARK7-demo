"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import "./commandcenter/cc-live.css";
import { useDashboard } from "./commandcenter/useDashboard";
import TasksView from "./commandcenter/TasksView";
import ApprovalsView from "./commandcenter/ApprovalsView";
import CalendarView, { fmtEventTime } from "./commandcenter/CalendarView";
import ToolsView from "./commandcenter/ToolsView";
import SystemCheckView from "./commandcenter/SystemCheckView";
import TodayCard from "./commandcenter/TodayCard";
import MemoryView, { UsageChart } from "./commandcenter/MemoryView";
import { fmtTokens } from "./commandcenter/api";
import EvolutionView from "./commandcenter/EvolutionView";
import PrivacyView from "./commandcenter/PrivacyView";

export type JarvisMode = "orb" | "dashboard" | "molecule" | "commandCenter";

type ProviderId = "groq" | "nvidia" | "gemini" | "openai" | "anthropic" | "ollama";
type ProviderStatus = Record<ProviderId, boolean>;
type Message = { role: "user" | "assistant"; content: string; toolsUsed?: string[] };

type CommandCenterProps = {
  aiOnline: boolean;
  activeProvider: ProviderId | null;
  providerStatus: ProviderStatus;
  memoryCount: number;
  performanceMode: string;
  fps: number;
  voiceState: string;
  voiceSupported: boolean;
  cameraOn: boolean;
  remoteSource: string | null;
  jarvisAuthenticated: boolean;
  visualMode: string;
  chatMessages: Message[];
  onModeChange: (mode: JarvisMode) => void;
  onVoice: () => void;
  onCommand: (command: string) => void;
};

type View = "overview" | "tasks" | "approvals" | "calendar" | "memory" | "evolution" | "privacy" | "tools" | "system";

// Only sections that are backed by real data are listed.
const NAV_ITEMS: readonly (readonly [string, string, View])[] = [
  ["⌂", "Command Center", "overview"],
  ["▤", "Tasks", "tasks"],
  ["✓", "Approvals", "approvals"],
  ["□", "Calendar", "calendar"],
  ["◫", "Memory & Usage", "memory"],
  ["✧", "Personal Evolution", "evolution"],
  ["◇", "Privacy & Security", "privacy"],
  ["⚒", "Tools & Skills", "tools"],
  ["✚", "System check", "system"],
];

const PROVIDERS: { id: ProviderId; label: string }[] = [
  { id: "anthropic", label: "Claude" },
  { id: "openai", label: "OpenAI" },
  { id: "gemini", label: "Gemini" },
  { id: "groq", label: "Groq" },
  { id: "nvidia", label: "NVIDIA" },
  { id: "ollama", label: "Ollama" },
];

function formatTime(date: Date) {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
function formatDate(date: Date) {
  return date.toLocaleDateString([], { weekday: "long", day: "2-digit", month: "long", year: "numeric" });
}
function untilLabel(iso: string) {
  const mins = Math.round((Date.parse(iso) - Date.now()) / 60000);
  if (isNaN(mins)) return "";
  if (mins <= 0) return "NOW";
  return mins < 60 ? `IN ${mins}M` : `IN ${Math.floor(mins / 60)}H ${mins % 60}M`;
}

export default function CommandCenter({
  aiOnline, activeProvider, providerStatus, memoryCount, performanceMode, fps, voiceState, voiceSupported,
  cameraOn, remoteSource, jarvisAuthenticated, visualMode, chatMessages, onModeChange, onVoice, onCommand,
}: CommandCenterProps) {
  const [now, setNow] = useState<Date | null>(null);
  const [search, setSearch] = useState("");
  const [view, setView] = useState<View>("overview");
  const [busy, setBusy] = useState(false);
  const dash = useDashboard(busy ? 3000 : 10000);
  const snap = dash.data;

  useEffect(() => {
    setNow(new Date());
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const feed = useMemo(() => {
    const recent = chatMessages.slice(-5).reverse();
    if (recent.length > 0) return recent;
    return [
      { role: "assistant" as const, content: aiOnline ? `AI link stable · ${activeProvider ?? "provider"}` : "AI link awaiting provider connection" },
      { role: "assistant" as const, content: `${(snap?.memory.memories ?? memoryCount).toLocaleString()} memory item${(snap?.memory.memories ?? memoryCount) === 1 ? "" : "s"} stored` },
      { role: "assistant" as const, content: `Performance mode · ${performanceMode.toUpperCase()}` },
    ];
  }, [activeProvider, aiOnline, chatMessages, memoryCount, performanceMode, snap]);

  const badge = (v: View): number =>
    !snap ? 0 : v === "tasks" ? snap.tasks.running + snap.tasks.paused : v === "approvals" ? snap.approvals.length : v === "tools" ? snap.tools.length : 0;

  const filteredNav = NAV_ITEMS.filter(([, label]) => view === "tools" || label.toLowerCase().includes(search.trim().toLowerCase()));

  // Agents: derived from real signals (recent LLM calls per role, integration flags), not placeholders.
  const agents = useMemo(() => {
    const recently = (role: string) => Boolean(snap && Date.now() - (snap.usage.lastByRole[role] ?? 0) < 30_000);
    const base = aiOnline ? "READY" : "OFFLINE";
    const list: [string, string, string][] = [
      ["⌕", "Planner", recently("planner") ? "ACTIVE" : base],
      ["⌘", "Executor", recently("executor") ? "ACTIVE" : base],
      ["✓", "Verifier", recently("verifier") ? "ACTIVE" : base],
    ];
    if (snap) {
      const ac = snap.integrations.autocoder;
      list.push(["⚙", "Autocoder", !ac.enabled ? "OFF" : ac.armed ? "ARMED" : "READY"]);
      list.push(["◎", "Remote Gateway", snap.integrations.telegram || snap.integrations.discord ? "READY" : "OFF"]);
    } else {
      list.push(["⚙", "Autocoder", "—"], ["◎", "Remote Gateway", "—"]);
    }
    return list;
  }, [aiOnline, snap]);

  const sys = snap?.system;
  const gauges: [string, number | null, string][] = [
    ["CPU", sys?.cpuPercent ?? null, "HOST LOAD"],
    ["RAM", sys?.memPercent ?? null, sys ? `${sys.memUsedGb}/${sys.memTotalGb} GB` : "—"],
    ["DISK", sys?.diskPercent ?? null, sys?.diskFreeGb != null ? `${sys.diskFreeGb} GB FREE` : "—"],
  ];

  const pendingApprovals = snap?.approvals.length ?? 0;
  const pausedTasks = snap?.tasks.paused ?? 0;
  const needsAuth = Boolean(dash.error && /authentication/i.test(dash.error));

  const go = (v: View) => { setView(v); setSearch(""); };

  return (
    <div className="command-center" aria-label="JARVIS Command Center">
      <aside className="command-center-sidebar">
        <div className="cc-brand">
          <div className="cc-brand-mark"><span>◉</span></div>
          <div><strong>JARVIS</strong><small>COMMAND CENTER</small></div>
        </div>
        <nav className="cc-nav" aria-label="Command Center navigation">
          {filteredNav.map(([icon, label, v]) => (
            <button key={label} type="button" className={`cc-nav-item ${view === v ? "active" : ""}`} onClick={() => go(v)}>
              <span>{icon}</span><strong>{label}</strong>
              {badge(v) > 0 && <em className={v === "approvals" ? "alert" : ""}>{badge(v)}</em>}
            </button>
          ))}
        </nav>
        <div className="cc-voice-card">
          <div className="cc-section-kicker">VOICE STATUS</div>
          <div className="cc-wave" aria-hidden="true">▁▃▆▃▇▅▂▅▇▃▆▂▅▇▃▆▃▁</div>
          <strong>{voiceState.toUpperCase()}</strong>
          <small>{voiceSupported ? "Voice interface ready" : "Voice unavailable"}</small>
          <button type="button" className="cc-focus-button" onClick={onVoice}>{voiceSupported ? "TALK TO JARVIS" : "VOICE OFFLINE"}</button>
        </div>
      </aside>

      <main className="command-center-main">
        <header className="cc-topbar">
          <div className="cc-system-pill"><i /> SYSTEM STATUS <strong>{dash.error ? "NO LINK" : aiOnline ? "OPTIMAL" : "STANDBY"}</strong></div>
          <div className="cc-clock"><strong>{now ? formatTime(now) : "--:--:--"}</strong><span>{now ? formatDate(now) : "SYNCING DATE…"}</span></div>
          <label className="cc-search"><span>⌕</span><input value={search} onChange={(event: { target: { value: string } }) => setSearch(event.target.value)} placeholder={view === "tools" ? "Filter tools…" : "Search…"} aria-label="Search Command Center" /></label>
          <div className="cc-operator"><span>{jarvisAuthenticated ? "Operator" : "Session"}</span><strong>{jarvisAuthenticated ? "CONNECTED" : "PENDING"}</strong><b>◉</b></div>
        </header>

        {needsAuth && <div className="cc-banner error">Live data needs your JARVIS access token. Sign in from the orb screen, then reopen the Command Center.</div>}
        {dash.error && !needsAuth && <div className="cc-banner error">Can&apos;t reach the JARVIS server: {dash.error}</div>}
        {snap && (pendingApprovals > 0 || pausedTasks > 0) && view !== "approvals" && view !== "tasks" && (
          <div className="cc-banner alert">
            {pendingApprovals > 0 && <button type="button" onClick={() => go("approvals")}>✓ {pendingApprovals} action{pendingApprovals === 1 ? "" : "s"} waiting for your approval ›</button>}
            {pausedTasks > 0 && <button type="button" onClick={() => go("tasks")}>▤ {pausedTasks} paused task{pausedTasks === 1 ? "" : "s"} ›</button>}
          </div>
        )}

        {view === "tasks" && snap && <TasksView snap={snap} refresh={dash.refresh} onBusy={setBusy} />}
        {view === "approvals" && snap && <ApprovalsView snap={snap} refresh={dash.refresh} alerts={dash.alerts} enableAlerts={dash.enableAlerts} />}
        {view === "calendar" && snap && <CalendarView snap={snap} onCommand={onCommand} />}
        {view === "memory" && snap && <MemoryView snap={snap} />}
        {view === "evolution" && <EvolutionView />}
        {view === "privacy" && <PrivacyView />}
        {view === "tools" && snap && <ToolsView snap={snap} filter={search} />}
        {view === "system" && <SystemCheckView />}
        {view !== "overview" && view !== "system" && view !== "evolution" && view !== "privacy" && !snap && !dash.error && <div className="cc-empty">Loading live data…</div>}

        {view === "overview" && (<>
          <TodayCard snap={snap ?? null} refresh={dash.refresh} />
          <section className="cc-overview-grid">
            <div className="cc-panel cc-core-panel">
              <div className="cc-panel-head"><span>AI CORE OVERVIEW</span><b>{aiOnline ? "ACTIVE" : "STANDBY"}</b></div>
              <div className="cc-core-content">
                <div className="cc-core-orbit" aria-hidden="true"><div className="cc-core-ring cc-ring-a" /><div className="cc-core-ring cc-ring-b" /><div className="cc-core-globe">JARVIS<small>AI CORE</small><em>MARK 7</em></div></div>
                <div className="cc-core-stats">
                  <div><span>AI LINK</span><strong>{activeProvider ? activeProvider.toUpperCase() : "OFFLINE"}</strong></div>
                  <div><span>MEMORY</span><strong>{(snap?.memory.memories ?? memoryCount).toLocaleString()}</strong></div>
                  <div><span>PERFORMANCE</span><strong>{performanceMode.toUpperCase()}</strong></div>
                  <div><span>VISUAL</span><strong>{visualMode}</strong></div>
                </div>
              </div>
            </div>

            <div className="cc-panel cc-feed-panel">
              <div className="cc-panel-head"><span>LIVE INTELLIGENCE FEED</span><b className="cc-live"><i /> LIVE</b></div>
              <div className="cc-feed-list">
                {feed.map((item, index) => (
                  <div className="cc-feed-item" key={`${item.content}-${index}`}>
                    <span className="cc-feed-icon">{item.role === "user" ? "›" : "◈"}</span>
                    <div><strong>{item.role === "user" ? "COMMAND" : "JARVIS"}</strong><p>{item.content}</p></div>
                    <small>{item.toolsUsed?.length ? "TOOL" : index === 0 ? "LIVE" : "INFO"}</small>
                  </div>
                ))}
              </div>
              <button type="button" className="cc-text-button" onClick={() => go("tasks")}>OPEN TASKS ›</button>
            </div>
          </section>

          <section className="cc-middle-grid">
            <div className="cc-panel cc-agents-panel">
              <div className="cc-panel-head"><span>AGENTS</span><b>{snap ? `${snap.tasks.running} TASK${snap.tasks.running === 1 ? "" : "S"} RUNNING` : "—"}</b></div>
              <div className="cc-agent-grid">
                {agents.map(([icon, name, status]) => (
                  <div className="cc-agent" key={name}><span>{icon}</span><div><strong>{name}</strong><small className={status === "ACTIVE" || status === "ARMED" ? "active" : ""}>● {status}</small></div><i /></div>
                ))}
              </div>
            </div>

            <div className="cc-panel cc-timeline-panel">
              <div className="cc-panel-head"><span>NEXT UP</span><b>{snap?.weather ? `${snap.weather.tempC}°C ${snap.weather.condition.toUpperCase()}` : "CALENDAR"}</b></div>
              <div className="cc-timeline">
                {snap && !snap.calendar.configured && <div className="cc-muted">Calendar not connected. Add Google credentials in .env to see your day here.</div>}
                {snap?.calendar.configured && snap.calendar.events.length === 0 && !snap.calendar.error && <div className="cc-muted">Nothing scheduled in the next 24 hours.</div>}
                {snap?.calendar.error && <div className="cc-muted">{snap.calendar.error}</div>}
                {snap?.calendar.events.slice(0, 4).map((e, i) => (
                  <div className="cc-timeline-item" key={`${e.start}-${i}`}><span>{fmtEventTime(e.start)}</span><div><strong>{e.summary}</strong><i /></div><small>{untilLabel(e.start)}</small></div>
                ))}
              </div>
              <button type="button" className="cc-text-button" onClick={() => go("calendar")}>OPEN CALENDAR ›</button>
            </div>

            <div className="cc-panel cc-quick-panel">
              <div className="cc-panel-head"><span>QUICK COMMANDS</span></div>
              <div className="cc-quick-list">
                <button type="button" onClick={() => go("tasks")}><b>＋</b> Start New Task</button>
                <button type="button" onClick={() => onCommand("Give me my daily briefing: today's calendar, unread email and the weather.")}><b>☼</b> Daily Briefing</button>
                <button type="button" onClick={onVoice}><b>♩</b> Start Voice Chat</button>
                <button type="button" onClick={() => go("approvals")}><b>✓</b> Review Approvals{pendingApprovals > 0 ? ` (${pendingApprovals})` : ""}</button>
              </div>
            </div>
          </section>

          <section className="cc-bottom-grid">
            <div className="cc-panel cc-monitor-panel">
              <div className="cc-panel-head"><span>SYSTEM MONITOR</span><b>HOST MACHINE</b></div>
              <div className="cc-gauge-grid">
                {gauges.map(([label, value, sub]) => (
                  <div className="cc-gauge" key={label}>
                    <div className="cc-gauge-ring" style={{ "--v": value ?? 0 } as CSSProperties}><strong>{value === null ? "—" : `${value}%`}</strong></div>
                    <span>{label}</span><small>{sub}</small>
                  </div>
                ))}
              </div>
              <div className="cc-monitor-foot"><span>FPS</span><strong>{fps}</strong><span>UPTIME</span><strong>{sys ? `${sys.uptimeHours}H` : "—"}</strong></div>
            </div>

            <div className="cc-panel cc-memory-panel">
              <div className="cc-panel-head"><span>AI USAGE · 12 DAYS</span><b>TOKENS</b></div>
              <UsageChart daily={snap?.usage.daily ?? []} />
              <div className="cc-memory-summary">
                <div><strong>{snap ? fmtTokens(snap.usage.totalTokens) : "—"}</strong><span>TOKENS</span></div>
                <div><strong>{(snap?.memory.memories ?? memoryCount).toLocaleString()}</strong><span>MEMORIES</span></div>
                <div><strong>{snap ? (snap.usage.costUsd === null ? "n/a" : `$${snap.usage.costUsd.toFixed(2)}`) : "—"}</strong><span>EST. COST</span></div>
              </div>
              <button type="button" className="cc-text-button" onClick={() => go("memory")}>VIEW DETAILS ›</button>
            </div>

            <div className="cc-panel cc-llm-panel">
              <div className="cc-panel-head"><span>LLM STATUS</span><b>{Object.values(providerStatus).filter(Boolean).length} CONNECTED</b></div>
              <div className="cc-llm-grid">
                {PROVIDERS.map(({ id, label }) => <div className="cc-llm" key={id}><span>{id === "anthropic" ? "✦" : id === "openai" ? "◌" : id === "gemini" ? "✦" : id === "groq" ? "9" : id === "nvidia" ? "◆" : "◉"}</span><div><strong>{label}</strong><small className={providerStatus[id] ? "connected" : ""}>{providerStatus[id] ? "Connected" : "Not Linked"}</small></div></div>)}
              </div>
            </div>
          </section>
        </>)}

        <footer className="cc-bottom-bar">
          <div className="cc-chips">
            <span>⌖ LOCATION <strong>{snap?.weather ? snap.weather.place.toUpperCase() : "NOT SET"}</strong></span>
            <span>☼ WEATHER <strong>{snap?.weather ? `${snap.weather.tempC}°C` : "SET BRIEFING_DEFAULT_PLACE"}</strong></span>
            <span>⌁ SERVER <strong>{dash.error ? "NO LINK" : snap ? "OK" : "…"}</strong></span>
            {remoteSource && <span>⌘ COMMAND BUS <strong>{remoteSource.toUpperCase()}</strong></span>}
          </div>
          <button type="button" className="cc-talk-button" onClick={onVoice}><span>◈</span> TALK TO JARVIS <small>{voiceState === "idle" ? "READY" : voiceState.toUpperCase()}</small></button>
          <button type="button" className="cc-exit-button" onClick={() => onModeChange("orb")}>RETURN TO ORB</button>
        </footer>
      </main>
    </div>
  );
}
