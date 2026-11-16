# Daily briefing ("Today" card)

Every morning JARVIS can collect your calendar, unread email and weather, ask the AI for a plan, and queue any suggested actions in the Approvals inbox. Nothing runs until you approve it in the Command Center.

## What it does
`POST /api/briefing/today` → `lib/briefing/dayData.ts` (collect) → `dayPlan.ts` (AI plan, validated JSON) → `queueActions.ts` (always queued for approval). The result shows on the **Today** card on the overview screen.

## Environment (`.env`)
```
REMOTE_ADMIN_TOKEN=<long random secret>      # lets cron call the route
BRIEFING_DEFAULT_PLACE=Kolkata               # weather city (optional)
JARVIS_DAY_ACTION_TOOLS=create_calendar_event # tools the plan may suggest (default shown)
JARVIS_APPROVAL_TTL_MIN=720                  # keep morning approvals for 12 h (default is 30 min)
```
Calendar and email are skipped automatically if they aren't configured. The plan is held in memory, so it is lost on restart. Re-run the trigger if you restart the app.

## Test it once
```
curl -X POST -H "x-jarvis-admin-token: YOUR_TOKEN" http://localhost:3000/api/briefing/today
```
Then open the Command Center overview.

## Linux / macOS (cron), every day at 07:30
`crontab -e`:
```
30 7 * * * curl -s -X POST -H "x-jarvis-admin-token: YOUR_TOKEN" http://localhost:3000/api/briefing/today >/dev/null
```

## Windows (Task Scheduler)
PowerShell (run once):
```
schtasks /Create /SC DAILY /ST 07:30 /TN "JARVIS Today" /TR "curl.exe -s -X POST -H \"x-jarvis-admin-token: YOUR_TOKEN\" http://localhost:3000/api/briefing/today"
```
Tick "Run task as soon as possible after a scheduled start is missed" in the task's Settings if your PC may be off at 07:30.

## Notes
- JARVIS must be running at trigger time (`npm start`).
- Email snippets are sent to your AI provider as untrusted data. Don't enable risky tools in `JARVIS_DAY_ACTION_TOOLS` unless you want to review them each day.
- The separate `POST /api/briefing` route (spoken/Telegram text briefing) is unchanged.
