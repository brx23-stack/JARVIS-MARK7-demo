# Command Center (live)

The Command Center now shows real data instead of placeholders. Open it from the orb screen's mode menu.

| Section | What it shows | Source |
|---|---|---|
| Overview | agents, next calendar events, host CPU/RAM/disk, 12-day token chart, provider status | `/api/dashboard` (refreshes every 10 s, pauses when the tab is hidden) |
| **Tasks** | start a goal, watch steps/progress live, see tools used + QA verdict, **Resume** paused tasks | `data/agent-tasks.json` |
| **Approvals** | actions waiting for your OK: held tool calls and code changes from the Autocoder | `lib/approvals/queue.ts`, `/api/autocoder` |
| Calendar | next 24 h, weather, which integrations are connected | Google Calendar, Open-Meteo |
| Memory & Usage | requests, tokens, estimated cost per provider, memory/graph counts | `data/ai-usage.json`, memory store |
| Tools & Skills | every tool the agent can call right now (filter with the search box) | tool registry |

Sections that had no backing data (AI Core, Conversations, Knowledge Base, Workflows, fake timeline/agents) were removed rather than faked.

## Approvals inbox

Set `JARVIS_APPROVAL_TOOLS=create_calendar_event` (or another supported in-scope write tool). Those calls are queued instead
of executed; the AI is told they are waiting. Only the signed-in UI can approve (`/api/approvals`) — Telegram/Discord can ask,
never approve. Pending items live in memory and expire (default 30 min), so a restart can't leave a stale action behind. Device-control tools are excluded from the current MARK 7 release.

## Phone / PWA

- Layout switches to a bottom tab bar under 760 px; type sizes were raised from 5–8 px to 10–13 px.
- Installable: "Add to Home Screen" (needs `https` or `localhost`). The service worker caches nothing private.
- Approval alerts: on the Approvals tab tap "Alert me…". You get a browser notification when a new request arrives while the
  app is in the background. True push while the app is fully closed needs a push server (VAPID keys) and is not included.

## Files

```
app/api/dashboard/route.ts   app/api/approvals/route.ts   app/manifest.ts
lib/dashboard/{types,snapshot}.ts   lib/approvals/queue.ts
components/CommandCenter.tsx   components/commandcenter/*   components/addons/PwaRegister.tsx
public/{sw.js,offline.html,icon-*.png,apple-touch-icon.png}
```
Edited: `lib/tools/execute.ts` (approval gate wrapper), `lib/agents/tool-registry.ts` (gate for dynamic tools),
`lib/agents/cost-tracker.ts` (`usageDigest`), `app/layout.tsx` (PWA metadata), `components/addons/AddonsHost.tsx`.


## Personal Evolution

The Personal Evolution view stores user-authored goals, milestones, and skill-evidence records in `data/evolution.json`. It deliberately records demonstrated work rather than generating unsupported skill scores. This is an initial tracker; guided learning paths and advanced analytics remain roadmap items.

## Privacy & Security

The Privacy view shows the server privacy mode and its limitations. It provides authenticated export and deletion for the listed local data files. Application-level encryption is not yet implemented; see `docs/PRIVACY.md`. Local-only mode disables browser speech input/output until verified local STT/TTS engines are integrated.
