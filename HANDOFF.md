> **Current handoff authority:** This older handoff predates the 2026-11-16 scope decision. Read [`docs/AI_HANDOFF.md`](docs/AI_HANDOFF.md) first; it supersedes conflicting instructions here. MARK 7 is now a privacy-conscious, voice-first AI workspace. Desktop, Android, cross-device, and smart-device control are explicitly out of scope.

# HANDOFF — JARVIS MARK 7 Remote Command System

## Scope completed

The existing JARVIS MARK 7 project was modified in place. The Three.js orb, hand
tracking, browser microphone/wake-word flow, local command implementation,
AI/Groq connection popup, memory, diagnostics, Desktop Mode, Performance Mode,
and existing browser voice output were left in their existing code paths.

A modular Remote Command Gateway was added for:
- Telegram bot messages
- Discord slash-command interactions

(As of 2026-08-15 this replaced an earlier Twilio-based SMS/WhatsApp/call
adapter — see the dated entry near the bottom of this file.)

Remote sources are normalized as `TELEGRAM` or `DISCORD` and are sent into
the existing client `askAI()` -> `localCommand()` path. No duplicate color,
performance, diagnostics, memory, or AI command implementation was introduced.

## Files added

- `lib/remote/types.ts` — normalized remote command/result types.
- `lib/remote/gateway.ts` — in-memory event gateway, allowlist, rate limiting,
  duplicate protection, runtime enable/disable, UI sessions, operational logs.
- `lib/remote/recipients.ts` — server-only short-lived recipient mapping.
- `lib/remote/telegram.ts` — Telegram webhook parsing, secret-token
  verification, sender validation, command normalization.
- `lib/remote/providers/telegram.ts` — Telegram outbound adapter (`sendMessage`)
  using server-side bot token.
- `lib/remote/discord.ts` — Discord interaction parsing, Ed25519 signature
  verification, sender validation, command normalization, PING/deferred/
  error interaction responses.
- `lib/remote/providers/discord.ts` — Discord signature verification and
  outbound followup-message adapter.
- `app/api/remote/session/route.ts` — same-origin HttpOnly UI session.
- `app/api/remote/events/route.ts` — authenticated SSE event stream and command
  claiming.
- `app/api/remote/result/route.ts` — authenticated result delivery bridge.
- `app/api/remote/admin/route.ts` — protected runtime emergency enable/disable.
- `app/api/remote/telegram/route.ts` — public Telegram webhook endpoint.
- `app/api/remote/discord/route.ts` — public Discord interactions endpoint.
- `HANDOFF.md` — this document.

## Files changed

- `components/JarvisOrb.tsx`
  - Added asynchronous SSE listener.
  - Remote commands enter the existing `askAI()` path.
  - Added temporary `REMOTE COMMAND: <SOURCE>` HUD indicator.
  - Existing orb voice/wake behavior remains separate.
- `app/globals.css`
  - Added only the small remote-command indicator styling.
- `.env.example`
  - Added placeholders for remote control and Twilio configuration.
- `README.md`
  - Added remote gateway architecture, security, and setup notes.

## Security implemented

- Remote control defaults to OFF: `JARVIS_REMOTE_ENABLED=false`.
- Telegram's `X-Telegram-Bot-Api-Secret-Token` header is verified server-side
  against `TELEGRAM_WEBHOOK_SECRET`.
- Discord's `X-Signature-Ed25519`/`X-Signature-Timestamp` headers are verified
  server-side against `DISCORD_PUBLIC_KEY` using Node's built-in `crypto`.
- Sender IDs must exactly match `REMOTE_ALLOWED_SENDERS`.
- Per-sender rate limiting is applied.
- Duplicate webhook protection is applied.
- Provider credentials never enter client JavaScript.
- Webhook secrets never enter client JavaScript.
- Logs contain command IDs/source metadata, not message bodies.
- Browser event/result access uses a same-origin HttpOnly UI session cookie.
- A protected admin endpoint provides a runtime emergency disable switch.
- Remote recipients are stored server-side and are never supplied by the
  browser when sending a reply.

## Provider setup still required

Nothing is preconfigured with real credentials.

The operator must supply, per provider they want active:
- `JARVIS_REMOTE_ENABLED=true`
- Telegram: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`
- Discord: `DISCORD_APPLICATION_ID`, `DISCORD_PUBLIC_KEY`
  (`DISCORD_BOT_TOKEN` only to register the slash command, not read at runtime)
- `REMOTE_ALLOWED_SENDERS`
- a strong `REMOTE_ADMIN_TOKEN`
- a public HTTPS deployment

Telegram's webhook (registered via `setWebhook`) must point to:
`POST /api/remote/telegram`

Discord's application "Interactions Endpoint URL" must point to:
`POST /api/remote/discord`, and a slash command with a required string
option named `command` (e.g. `/jarvis command:<text>`) must be registered
against the Discord API using `DISCORD_BOT_TOKEN`.

## Important behavior

- Telegram messages and Discord slash commands do not need `Hey JARVIS`.
- The existing orb microphone still uses its existing `Hey JARVIS` wake-word
  behavior and browser Web Speech recognition.
- Remote processing is asynchronous from the orb render/hand-tracking loop.
- Telegram replies are sent as a new `sendMessage` call after the browser
  executes the command.
- Discord interactions are deferred immediately (Discord shows "thinking…")
  because the interaction callback cannot synchronously wait for the
  browser's local UI execution; the real reply is delivered afterward as a
  followup message using the interaction's own token.
- The orb displays the remote source indicator and the resulting response in
  its existing voice/status area.

## Known limitations

1. The remote gateway uses in-memory state. Restarting the Next.js process
   clears queued events, duplicate history, runtime disable state, and
   recipient mappings.
2. A single active JARVIS browser session is the intended deployment model.
   Multiple tabs are protected against duplicate command execution with the
   server-side command claim operation, but all authenticated JARVIS UI tabs
   share the same gateway.
3. The actual Three.js/client state lives in the browser. Therefore remote
   webhooks enqueue work on the server and the connected JARVIS UI executes the
   existing client command system; the backend does not duplicate those UI
   commands.
4. Discord's immediate interaction response is a deferred acknowledgement
   ("thinking…") rather than the final JARVIS answer; the answer follows as a
   separate followup message.
5. Telegram and Discord are adapters, not a hard requirement of the command
   router; another provider should be added behind `lib/remote/providers/`
   and wired into the webhook adapter the same way.

## Tests performed

- Inspected the original project structure and existing command/voice paths.
- Added the remote modules and integration without replacing the existing orb.
- Checked that the project still contains its original API/voice/hand-tracking
  files.
- Attempted `npm install`/`npm ci` and TypeScript validation. The supplied
  environment's mounted `node_modules` had filesystem permission issues and a
  clean dependency install could not complete within the available execution
  window. Therefore a full `next build` was NOT claimed as passed.
- No provider credentials or live webhooks were available, so no live
  WhatsApp/SMS/call test was claimed.

## Next AI instructions

Do NOT rebuild the project.

1. Start from this ZIP and read `HANDOFF.md`.
2. Install dependencies in a normal writable project directory.
3. Run `npm install` and then `npm run build`.
4. Fix only compile/build errors caused by the new remote files if any appear.
5. Keep the existing `JarvisOrb.tsx` command implementation intact; do not
   duplicate local commands on the server.
6. Configure provider credentials only in the deployment environment.
7. Test in this order:
   - remote disabled => webhook rejected (Discord PING still answered)
   - invalid Telegram secret token => rejected
   - invalid Discord Ed25519 signature => 401, not a JSON interaction response
   - non-allowlisted sender => rejected
   - duplicate webhook/interaction => ignored
   - rate limit => rejected
   - allowlisted Telegram message => event reaches JARVIS and reply delivery works
   - allowlisted Discord slash command => deferred, event reaches JARVIS, and
     the followup message delivers the reply
   - emergency admin disable => new remote commands stop
8. Only after successful real tests should documentation state that a specific
   provider channel is operational.


## 3D Molecule & Atom Laboratory (added 2026-08-14)

### Implemented
- Added `components/MoleculeLab.tsx` as a self-contained Three.js laboratory overlay, preserving the existing JARVIS orb as the main interface.
- Added `lib/laboratory/elements.ts` containing 118 elements with atomic number, symbol, name, atomic mass, shell electron configuration, common valency, common oxidation states, group, period and visual category/color.
- Added atomic visualization with proton/neutron particles and electron shells.
- Added interactive molecule mode with H₂O, CO₂, O₂, CH₄, NH₃ and Al₂O₃ templates.
- Added atom add/remove/rearrange, bond breaking, heuristic bond validation and 3D atom selection.
- Added mobile touch support through Three.js OrbitControls (one-finger rotate, pinch zoom, two-finger pan) and desktop mouse/keyboard controls.
- Added automatic low-quality selection for lower-end mobile devices based on available device memory/core count, plus manual HIGH/LOW/AUTO quality.
- Added a scientific disclaimer in the UI distinguishing reference data from simplified geometry, bond inference, colors and particle visuals.
- Added `MOLECULE LAB` HUD button and `open molecule lab` local/remote command handling.

### Validation
- No new npm dependency was required beyond the existing Three.js dependency.
- A full TypeScript/build validation could not be completed in the sandbox because the uploaded project does not contain installed `node_modules` and dependency installation was unavailable. Run `npm ci` followed by `npm run build` in the normal project environment before production deployment.

## Molecule Lab Hand-Tracking Upgrade

Added hand-tracking interaction to the existing Molecule & Atom Laboratory without opening a second camera or replacing the existing JARVIS gesture system.

### Changed
- `lib/handTracker.ts`: broadcasts a browser-local `jarvis-hand-gesture` event from the already-running MediaPipe tracker.
- `components/MoleculeLab.tsx`: listens for those events and supports pinch selection/grabbing, atom movement, two-hand pinch zoom, gesture corner actions for adding/removing atoms and adding/removing simulated electrons, and gesture-driven camera navigation.
- `app/globals.css`: added non-interactive gesture HUD labels.

### Gesture controls
- Pinch an atom: select/grab it.
- Move while pinching: move the selected atom in the lab's 3D work plane.
- Release pinch: drop the atom and re-evaluate simplified bonds.
- Pinch with two hands: zoom.
- Pinch the top-left HUD zone: add selected atom.
- Pinch the top-right HUD zone: remove selected atom.
- Pinch the bottom-left HUD zone: remove one simulated electron from the selected atom.
- Pinch the bottom-right HUD zone: add one simulated electron to the selected atom.
- When no atom is grabbed, a single pinch can rotate the laboratory view.

Electron changes are explicitly a simplified charge/visualization model and do not simulate real-time quantum electron dynamics.

### Validation
`npx tsc --noEmit` could not complete because the supplied environment has broken/incomplete installed type-definition packages (`@types/node`, React, Three, etc.). `npm ci --ignore-scripts` was also unavailable in the execution environment. No external provider credentials were added.

## 2026-08-14 Molecule Lab Voice Control Update

Added a dedicated `jarvis-molecule-voice` event bridge so the existing JARVIS voice/local-command pipeline can control the Molecule Lab without replacing the existing microphone, AI, hand tracking, orb, or command systems.

Supported voice actions include:
- create/load/build known templates: H2O, CO2, O2, CH4, NH3, Al2O3
- select/inspect/show an element
- add/remove an element atom
- add/remove electrons, protons, or neutrons (numeric counts and common number words)
- switch atom/molecule mode
- break molecule/bonds
- rearrange atoms
- validate/check bonds

Particle changes are explicitly represented as simplified educational deltas. They do not claim to simulate real nuclear/electron physics.

Files changed:
- `components/MoleculeLab.tsx`
- `components/JarvisOrb.tsx`

Validation note: dependency installation is not present in this environment. `npm run build` could not execute because `next` is not installed, and the project has no `typecheck` script. Run `npm install` followed by `npm run build` in the target environment before production use.

## Latest change: normal-rate hand tracking in Low Performance Mode

Hand tracking detection cadence is now fixed at approximately 30 FPS (33 ms) in High, Medium, and Low Performance Modes. Low mode still reduces visual/3D complexity elsewhere, but it no longer throttles MediaPipe hand detection to 80 ms. This keeps pinch, drag, rotation, and zoom gestures responsive on mobile while preserving the existing tracker and camera architecture.

## 2026-08-14 — Integrated Atom/Molecule Visualization into Main Orb

The MoleculeLab was changed from a full-screen standalone laboratory overlay to an embedded `embedded` mode rendered directly over the existing JARVIS orb. `JarvisOrb.tsx` now mounts `<MoleculeLab embedded ...>` when molecule mode is opened and fades the underlying orb scene without unmounting it, so returning to the normal orb preserves its scene state.

Changed files:
- `components/MoleculeLab.tsx` — added `embedded` prop and compact in-orb visualization mode.
- `components/JarvisOrb.tsx` — molecule mode now uses the embedded laboratory and temporarily hides the underlying orb visually.
- `app/globals.css` — added embedded molecule/orb transition and responsive styling.

Existing voice event routing (`jarvis-molecule-voice`), hand tracking, touch/mouse controls, molecule data, and particle editing were preserved.

Validation: static TypeScript check was attempted, but dependencies are not installed in this environment, so the project reports missing `next`, React, Node type declarations, etc. No production build was claimed.

## 2026-08-14 — Integrated Orb Atom/Molecule Visual Redesign

The Atom/Molecule experience was refined so the running JARVIS UI uses the existing central orb area as the visual stage instead of showing the previous embedded laboratory controls. The embedded runtime now renders only the 3D atom/molecule canvas over the same central visual region; the existing conversational HUD, transcript, microphone, status, and controls remain in the main JARVIS interface. The old standalone MoleculeLab component branch is retained for compatibility but is not mounted by `JarvisOrb`.

Changes:
- `components/MoleculeLab.tsx`: embedded mode is now a transparent, UI-free 3D visual stage; atom/molecule animation is centered in the orb area; smooth formation scaling and continuous rotation/pulse were added.
- `components/MoleculeLab.tsx`: added real `UnrealBloomPass` post-processing for HIGH and MEDIUM-quality visualization; LOW mode skips bloom to preserve performance.
- `components/MoleculeLab.tsx`: theme color now drives the atomic/molecular materials, nucleus, electrons, bonds, glow, particles, labels, and bloom stage. Amber remains the JARVIS default while blue/purple/green/red/custom themes propagate dynamically.
- `components/MoleculeLab.tsx`: HIGH uses stronger bloom, more particles and higher pixel ratio; MEDIUM retains bloom and major holographic effects with reduced complexity; LOW keeps core particles/bonds/electrons visible without bloom.
- `components/MoleculeLab.tsx`: camera is centered on the same visual origin as the orb and uses transparent rendering so the normal JARVIS HUD remains visible around it.
- `components/JarvisOrb.tsx`: passes the existing global performance mode into the atom/molecule renderer and renames the manual launcher to `ATOM / MOLECULE`; voice feedback now describes a mode switch rather than opening a separate laboratory.
- `app/globals.css`: added a short orb-to-molecule visual transition and transparent central-stage styling.

Validation:
- Full npm/Next build could not be executed in this sandbox because dependencies are not installed and package installation requires network access.
- `tsc --noEmit -p tsconfig.json` was run with the globally available TypeScript compiler. The remaining diagnostics are dominated by missing installed React/Next/Three/MediaPipe type packages; the previous optional-delta diagnostics in `MoleculeLab.tsx` were fixed. A real project typecheck/build should still be run after `npm install` in a network-connected environment.

## 2026-08-15 — Remote Command Gateway: Twilio replaced with Telegram + Discord

The Twilio-based SMS/WhatsApp/call adapter was removed and replaced with
Telegram and Discord adapters. This only touches the Remote Command Gateway
(`lib/remote/*`, `app/api/remote/*`) — the orb, voice, hand tracking,
molecule lab, and AI/TTS paths are unchanged.

### Changed
- `lib/remote/types.ts`: `RemoteSource` is now `"ORB" | "TELEGRAM" | "DISCORD"`
  (previously `"ORB" | "WHATSAPP" | "SMS" | "CALL"`).
- `lib/remote/gateway.ts`: `publicRemoteStatus()` now reports
  `telegramConfigured`/`discordConfigured` independently; `configured` is true
  once at least one provider plus `REMOTE_ALLOWED_SENDERS` is set.
  `deliverRemoteResult()` now dispatches to the Telegram or Discord provider
  based on `result.source`.
- `app/api/remote/result/route.ts`: accepts `source` of `"TELEGRAM"` or
  `"DISCORD"` only.
- `.env.example`, `README.md`: Twilio configuration/setup replaced with
  Telegram bot and Discord application setup instructions.
- `components/JarvisOrb.tsx`: no changes needed — it reads `RemoteCommand.source`
  generically and renders it as-is in the `REMOTE COMMAND: <SOURCE>` HUD label.

### Added
- `lib/remote/telegram.ts` / `lib/remote/providers/telegram.ts` — inbound
  webhook parsing (secret-token verification, JSON `Update` body) and
  outbound `sendMessage` delivery via the Telegram Bot API.
- `lib/remote/discord.ts` / `lib/remote/providers/discord.ts` — inbound
  interaction parsing (Ed25519 signature verification using Node's built-in
  `crypto`, no extra dependency), PING handling, deferred-response handling,
  and outbound delivery via the interaction's followup-message webhook
  (no bot token needed at runtime).
- `app/api/remote/telegram/route.ts`, `app/api/remote/discord/route.ts` —
  public webhook endpoints, replacing `app/api/remote/twilio/route.ts`.

### Removed
- `lib/remote/twilio.ts`, `lib/remote/providers/twilio.ts`,
  `app/api/remote/twilio/route.ts`.
- The `CALL` source and phone/voice handling entirely — Telegram and Discord
  are text/chat platforms, not telephony providers, so there is no direct
  replacement for the old inbound-call path. If voice-call remote control is
  still wanted, a telephony provider would need to be added back separately.

### Behavior notes
- Recipient tracking (`lib/remote/recipients.ts`) is unchanged: it still maps
  a command id to an opaque provider-specific string with the existing
  10-minute TTL. For Telegram that string is the chat id; for Discord it is
  `"<applicationId>:<interactionToken>"` (Discord followup tokens are valid
  for 15 minutes, so they don't expire before the existing TTL does).
- Sender allowlist entries are now namespaced per provider
  (`telegram:<user id>`, `discord:<user id>`) so the same
  `REMOTE_ALLOWED_SENDERS` list can safely hold both.
- Discord's PING interaction is answered even while `JARVIS_REMOTE_ENABLED`
  is `false`, since Discord requires a live PONG response to keep the
  Interactions Endpoint URL marked valid; PING carries no user command so
  this doesn't weaken the disabled-by-default posture.

### Validation
- No `npm install` / `next build` / `tsc --noEmit` was run in this pass (this
  sandbox has no network access for dependency installation, consistent with
  earlier entries in this file). The new files follow the exact
  import/export/typing patterns of the Twilio files they replace, and no
  other file references the removed Twilio modules or removed `SMS`/
  `WHATSAPP`/`CALL` source values (`components/JarvisOrb.tsx` reads
  `RemoteCommand.source` generically). Run `npm install` then `npm run build`
  in a network-connected environment before deploying, and register real
  Telegram/Discord credentials before setting `JARVIS_REMOTE_ENABLED=true`.
- No provider credentials or live webhooks were available, so no live
  Telegram/Discord test was performed.
