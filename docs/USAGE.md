# JARVIS MARK 7: full usage guide

_This is the original long-form README, kept for reference. The short version is in [README.md](../README.md)._

JARVIS MARK 7 is the Mark 6 assistant upgraded with the advanced holographic Three.js orb foundation, hand tracking, voice control, local commands, local memory, diagnostics, and a secure in-app Groq API connection flow.

## Run on Android / Termux

Install Node.js/npm, then from the project directory:

```bash
npm install
npm run dev -- --webpack
```

Open the local Next.js address shown by the terminal.

### AI connection

On first startup, JARVIS MARK 7 opens its **AI CONNECTION** panel.

Enter your Groq API key and press **CONNECT**.

The key is:
- validated server-side
- held only in server memory
- never returned to the browser
- never written to localStorage/sessionStorage
- not included in this project

After a server restart, enter the key again.

### Voice commands

Examples:

- “JARVIS, use blue.”
- “JARVIS, switch to purple.”
- “JARVIS, make yourself green.”
- “JARVIS, change to amber.”
- “JARVIS, use red.”
- “JARVIS, use white.”
- “JARVIS, set the color to #00BFFF.”
- “JARVIS, use RGB 0 191 255.”
- “JARVIS, change my API key.”
- “JARVIS, remove my API key.”
- “JARVIS, remember my name is Rajdeep.”
- “JARVIS, show my memory.”
- “JARVIS, forget my favorite game.”
- “JARVIS, clear my memory.”
- “JARVIS, run diagnostics.”
- “JARVIS, clear conversation.”

Color commands and other local commands run before Groq, so they continue working without AI access.

## Controls

- Mouse drag: rotate
- Mouse wheel: zoom
- Touch: orbit/zoom
- One-hand pinch + movement: rotate
- Two-hand pinch/spread: zoom
- `G`: hand tracking
- `V`: voice
- `R`: reset
- `+` / `-`: zoom
- Desktop only — Arrow keys: rotate
- Desktop only — `F`: fullscreen

## Desktop Mode

JARVIS automatically detects whether it's running on a desktop PC
(Windows/macOS/Linux) or on Android/mobile, and adjusts itself without any
manual mode switch. The HUD always shows the result: **DESKTOP MODE:
ACTIVE** or **DESKTOP MODE: OFF**.

Detection is based on the platform, not window size — resizing the browser
window or docking a phone to a monitor won't change the result. Android
behavior is completely unaffected either way.

On desktop, JARVIS additionally offers:

- A **FULLSCREEN** button (and `F` key) for a distraction-free view.
- Arrow-key orb rotation alongside the existing mouse-drag rotate and
  scroll-wheel zoom.
- A sharper orb render on high-DPI monitors, which stays correct even if
  you drag the window to a display with a different scaling factor.
- Camera constraints suited to PC webcams instead of a phone's front
  camera, so **external webcams — including an Android phone used as a
  webcam via apps like DroidCam/Camo — work normally**. JARVIS doesn't add
  its own camera picker; if you have more than one camera, choose which one
  to use through your browser's own camera permission/site-settings UI
  (e.g. Chrome/Edge: click the camera icon in the address bar). Microphone
  selection works the same way — through the browser/OS default input
  device, since the underlying Web Speech API doesn't expose device
  selection to sites.

Hand tracking still uses exactly one camera stream and one MediaPipe
tracker in both modes — Desktop Mode only changes the requested
resolution/constraints, never the pipeline itself.

Tested on Windows 10 with Chrome and Edge.

## Architecture

- Next.js + React
- Three.js + post-processing
- MediaPipe hand tracking
- Browser speech recognition and speech synthesis
- Groq chat API through `/api/chat`
- In-memory server-side API-key storage
- Local browser memory for non-sensitive assistant memory
- Theme persistence without storing API credentials

The application intentionally uses one Three.js scene, one renderer, one camera, one animation loop, and one hand-tracking camera stream.


## Groq connection

Mark 7 validates a Groq key with both the models endpoint and a real chat-completions request before reporting `AI ONLINE`. The default Groq model is `openai/gpt-oss-120b`; it can be overridden with `GROQ_MODEL` on the server. The API key remains server-memory-only.


## Attribution

JARVIS MARK 7 incorporates and builds upon the existing visual foundation and source project from **Sagar Tamang / Sagar Builds**.

The original copyright and license information are preserved in [`LICENSE`](./LICENSE).

This repository should not be interpreted as claiming ownership of the original Sagar Builds code or visual assets.

**JARVIS MARK 7 project/maintainer:** Rajdeep Naha


## Remote Command System

Mark 7 now contains a modular Remote Command Gateway. It does not replace the
existing orb microphone, wake-word listener, local commands, AI path, memory,
hand tracking, or Three.js rendering. Remote commands are normalized as
`TELEGRAM` or `DISCORD` events and then enter the same `askAI()` /
`localCommand()` path already used by the orb.

### Security model

Remote control is **disabled by default** with `JARVIS_REMOTE_ENABLED=false`.
External webhooks are verified server-side, sender IDs must match
`REMOTE_ALLOWED_SENDERS`, duplicate events are rejected, per-sender rate
limiting is applied, and operational logs intentionally omit message bodies.
Provider credentials and webhook secrets are server-only environment
variables. `/api/remote/admin` can be used with `REMOTE_ADMIN_TOKEN` as a
process-level emergency enable/disable switch.

### Provider adapters

The included adapters target Telegram's Bot API and Discord's Interactions
webhooks. Both use direct HTTPS requests (and, for Discord, Node's built-in
`crypto` for Ed25519 signature verification) instead of adding a provider
SDK, so a further provider can later be added behind `lib/remote/providers/`
without changing the JARVIS command path. Either provider can be configured
independently - you don't need both.

For Telegram, the bot's webhook sends the inbound message to
`POST /api/remote/telegram`; the request is authenticated with the secret
token Telegram echoes back on every call. For Discord, a slash command
(`/jarvis command:<text>`) is delivered to `POST /api/remote/discord` as an
interaction, authenticated with an Ed25519 signature; JARVIS immediately
defers the interaction (Discord shows "thinking…") while the command runs.
In both cases, the browser receives commands through a lightweight
server-sent event stream, executes them asynchronously, updates the existing
orb, and posts the concise result back to the server - delivered as a
Telegram message or a Discord interaction followup, respectively.

### Required configuration

No provider credentials are included in this repository. Copy the remote
section of `.env.example` into the server environment and fill it only with
your own values. You need:

- `JARVIS_REMOTE_ENABLED=true`
- a public HTTPS deployment
- for Telegram: `TELEGRAM_BOT_TOKEN` and `TELEGRAM_WEBHOOK_SECRET`
- for Discord: `DISCORD_APPLICATION_ID` and `DISCORD_PUBLIC_KEY`
  (`DISCORD_BOT_TOKEN` is only needed once, to register the slash command)
- `REMOTE_ALLOWED_SENDERS` containing the exact trusted sender IDs
  (`telegram:<user id>` / `discord:<user id>`)
- `REMOTE_ADMIN_TOKEN`

Point the Telegram webhook (via `setWebhook`) at the deployed
`/api/remote/telegram` endpoint, and the Discord application's "Interactions
Endpoint URL" at the deployed `/api/remote/discord` endpoint. Do not expose
these secrets in client code.

### Important limitation

Remote functionality is implemented but **not claimed to be live** until
provider credentials, a public HTTPS webhook, and the sender allowlist are
supplied and tested. The Discord path defers its interaction response
immediately after the slash command is received; the browser then executes
the command asynchronously so remote traffic never blocks the orb, hand
tracking, microphone, or Three.js animation loop.

### Emergency disable

Set `JARVIS_REMOTE_ENABLED=false` and restart the server for the persistent
default to be off again. If `REMOTE_ADMIN_TOKEN` is configured, the protected
`POST /api/remote/admin` endpoint can disable or re-enable remote control at
runtime without exposing any provider credentials to the browser.


## 3D Molecule & Atom Laboratory

The MARK 7 interface now includes a touch/desktop 3D chemistry laboratory. Open it with the `MOLECULE LAB` HUD control or say/type `open molecule lab`. It includes all 118 known elements, atomic numbers, masses, shell electron configurations, common valencies and oxidation states, interactive atomic-shell visualization, molecule templates (H₂O, CO₂, O₂, CH₄, NH₃ and Al₂O₃), atom add/remove/rearrange controls, bond inference, validation, responsive mobile controls, and adaptive quality. The chemistry engine is intentionally educational: bond inference and geometry are simplified heuristics and Al₂O₃ is presented as a simplified ionic formula-unit visualization rather than a literal molecular lattice.

## JARVIS learning and memory consolidation

JARVIS uses two local memory layers. `data/learning.jsonl` is episodic memory and records conversations and tool/API results. `data/semantic-memory.json` is consolidated long-term memory containing durable facts, preferences, corrections, projects, procedures, skills, and lower-confidence observations.

After each completed AI turn, JARVIS first records the experience locally, then runs a small best-effort consolidation pass through the active model. The model only proposes durable memories; the final memory write happens locally. Explicit `remember`, preference, and correction language is also learned by a local heuristic, so those memories can be created even when the consolidation model call fails.

This does not retrain or change the remote model weights. It gives every provider the same persistent local memory, so switching providers does not erase what JARVIS has learned. Secrets and API-key-like strings are redacted from episodic memory, and transient API observations are kept with lower confidence rather than treated as permanent facts.

Set `JARVIS_MEMORY_CONSOLIDATION=false` to disable the model-assisted consolidation pass while retaining local episodic memory and deterministic learning.

## Memory relationships and contradiction resolution

JARVIS now maintains three local memory layers:

- `data/learning.jsonl` — episodic experiences and tool results.
- `data/semantic-memory.json` — consolidated durable memories.
- `data/memory-graph.json` — entities and typed relationships.

The graph supports relationships such as `WORKS_ON`, `HAS_FEATURE`, `PREFERS`, `USES`, `KNOWS_ABOUT`, `PART_OF`, `DEPENDS_ON`, `LOCATED_IN`, `HAS_SKILL`, and `RELATED_TO`.

When new evidence conflicts with an existing relationship, stronger or explicit corrective evidence supersedes the older edge. Weakly conflicting evidence is marked `uncertain` instead of being deleted. Historical memories remain available for audit and future reasoning.

Example:

`Rajdeep -> WORKS_ON -> JARVIS MARK 7`

`JARVIS MARK 7 -> HAS_FEATURE -> Orb`

`JARVIS MARK 7 -> HAS_FEATURE -> Voice`

`JARVIS MARK 7 -> HAS_FEATURE -> Dashboard`

`JARVIS MARK 7 -> HAS_FEATURE -> Stock monitoring`

`Rajdeep -> PREFERS -> Cyan orb`

`Rajdeep -> KNOWS_ABOUT -> Minecraft`


## Advanced Agent Layer

MARK 7 now includes an additive Planner → Executor → QA/Verifier architecture inspired by the advanced `bertrandmbanwi/Jarvis` project. Existing orb, HUD, voice, hand tracking, molecule lab, Telegram/Discord, tools, memory, and provider flows are preserved.

Complex multi-step requests automatically enter the agent pipeline in `JARVIS_AGENT_MODE=auto`; simple conversation continues through the existing path. Work sessions persist in `data/agent-tasks.json`, and provider token usage is recorded in `data/ai-usage.json`. See `docs/ADVANCED_AGENT_ARCHITECTURE.md`.

## Autocoder
Self-editing code agent with approval, type-check verification and rollback — see [AUTOCODER.md](AUTOCODER.md).
