# 60-second demo: shot list

**Pitch to land:** a privacy-conscious personal AI workspace that supports local models, persistent knowledge, and owner-approved code changes.
**Format:** 1080p, 16:9, screen capture with captions burned in (most people watch muted). Voiceover is optional; the captions below carry the story.
**Total:** 60 s, 8 shots, one idea each.

| # | Time | Shot | On screen | Caption / voiceover |
|---|------|------|-----------|---------------------|
| 1 | 0:00-0:05 | **Hook.** Orb idling full-screen, slow rotate. | Orb only, HUD visible. | "Meet JARVIS. It runs on your machine." |
| 2 | 0:05-0:13 | **Setup in 3 commands.** Terminal, sped up 3x. | `npm install`, `npm run setup` (token printed, blur it), `npm run dev`. Cut to browser login. | "Three commands. No cloud account needed." |
| 3 | 0:13-0:23 | **Local model + voice.** Keep Ollama running locally, press `V`, say "JARVIS, use blue", then ask a short question. Do not imply the browser microphone path is guaranteed offline. | Orb recolors; reply streams and is spoken. | "Run your AI chat on a local model. Voice interaction is available where your browser supports it." |
| 4 | 0:23-0:30 | **Hand tracking.** Press `G`; rotate the orb with a one-hand pinch, zoom with two hands. | Webcam overlay in a corner. | "Or just use your hands." |
| 5 | 0:30-0:40 | **Approvals.** Ask JARVIS to create a calendar event with `create_calendar_event` in `JARVIS_APPROVAL_TOOLS`. It replies that it is waiting. Open Command Center, Approvals tab, press Approve. | Pending card, then result. | "Consequential actions wait for owner approval." |
| 6 | 0:40-0:50 | **Self-editing, with a leash.** Autocoder on, ask for a small UI change ("add a clock to the HUD"). Show the proposed diff in the panel, press Approve, show the change live. | Diff view, then the result. | "It can edit its own code. Every change waits for you." |
| 7 | 0:50-0:55 | **Plugins.** Ask "roll two twenty-sided dice". Quick cut to the 30-line `plugins/example-dice/index.ts`. | Result, then the file. | "Add tools by dropping in a folder." |
| 8 | 0:55-1:00 | **End card.** Orb with logo text. | Repo URL, "Privacy-conscious. Local-model capable. Open source." | "JARVIS MARK 7. Link below." |

## Before you record

- [ ] Fresh clone, `data/` empty (no personal memory on screen).
- [ ] `.env`: `LLM_PROVIDER=ollama`, `AUTOCODER_ENABLED=true`, `AUTOCODER_MODE=propose`, `JARVIS_APPROVAL_TOOLS=create_calendar_event`, and a configured calendar integration.
- [ ] `ollama pull llama3.2` done and warm (run one prompt first so shot 3 is not a cold start).
- [ ] Rehearse the shot 6 request once; pick a change a small local model can make reliably, and keep the take that works.
- [ ] Hide the access token, API keys and your username in every frame (blur or crop the terminal).
- [ ] Quiet room for the mic; browser at 100% zoom, bookmarks bar hidden, notifications off.
- [ ] Confirm the exact button and tab labels in the UI match the table (Approvals, Autocoder) before captioning.

## Stills to grab while you are set up

These fill the placeholders in the README. Save as PNG at 1600 px wide.

- `docs/screenshots/orb.png`: the orb, HUD visible (from shot 1).
- `docs/screenshots/command-center.png`: Command Center overview tab.
- `docs/screenshots/approvals.png`: Approvals tab with one pending item (from shot 5).

## Cutting notes

- If you land at 65 s, trim shot 4 first, then shorten shot 2. Do not cut shot 5 or 6; they are the differentiator.
- Keep each caption on screen for at least 2.5 s. Ten words or fewer per caption.
- Music: low, no vocals, ducked under any voice. Use a track you have the license for.
- Export a 15 s cut of shots 1, 5 and 6 for social; the full 60 s goes in the README.
