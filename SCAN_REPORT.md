> **Historical report notice (2026-11-16):** This scan report describes an earlier source snapshot and is not evidence that the current project passes build, type-check, security, or runtime validation. Current scope and implementation guidance are in `docs/AI_HANDOFF.md`; re-run all checks on the current release candidate.

# JARVIS MARK 7 — Scan Report

Date: 2026-08-14
Scope: full project as uploaded (`jarvis-mark-7-orb-molecule.zip`), including the
integrated Atom/Molecule Orb mode, Remote Command Gateway, voice pipeline, hand
tracking, and Three.js orb.

---

## 0. Environment constraint (read this first)

**This sandbox has no outbound network access for package installation.**
`npm install` / `npm ci` fail immediately with `403 Forbidden` from the npm
registry (confirmed directly — see §4). Because of that:

- `node_modules` could not be installed.
- `next build`, `next dev`, `npm run build`, and a *real* `next lint` /
  `tsc --noEmit` (with actual type packages for React/Next/Three/MediaPipe)
  **could not be run** in this environment.
- I am not claiming any of these passed. Where a check could only be done
  partially (see §4), I say exactly what was and wasn't verified.

This matches what's already documented in `HANDOFF.md` in this same repo —
every prior agent that touched this project hit the identical npm-install
wall in its sandbox. This isn't new information, but it's worth restating so
nobody assumes a green build was seen.

**What I did instead:** a full manual line-by-line read of every `.ts`/`.tsx`
file in the project (5,215 lines across 30 files), plus a best-effort static
pass with a locally available TypeScript compiler (see §4) to catch anything
a careful read alone might miss (unresolved identifiers, obviously malformed
syntax, etc.). §4 explains exactly what that pass could and couldn't check.

**You should run before deploying:**
```bash
npm install
npx tsc --noEmit
npm run build
npm run dev -- --webpack     # Android/Termux
npm run dev                  # everywhere else
```

---

## 1. Bugs found and fixed

### 1.1 Literal `\n\n` rendered as visible text in the HUD (real, user-visible bug)
**File:** `components/JarvisOrb.tsx`, line ~1170
**Was:**
```tsx
{moleculeLabOpen && <MoleculeLab embedded onClose={() => setMoleculeLabOpen(false)} theme={themeColor} />}\n\n      {diagnostics && (
```
The `\n\n` here was a literal two-character escape sequence sitting outside
any `{}` or tag in JSX — not an actual line break. JSX renders stray text
between elements as a text node, so this printed the literal characters
`\n\n` on screen as visible text in the HUD, between the Molecule Lab mount
point and the diagnostics panel.

**Fix:** replaced the literal `\n\n` with a real newline, restoring normal
JSX formatting. No behavior other than the stray visible text was touched.

### 1.2 GPU memory leak in the Atom/Molecule Orb mode (real, confirmed leak pattern)
**File:** `components/MoleculeLab.tsx` — `renderAtomicModel()` and
`renderMolecule()`

Both functions rebuild the on-screen atom/molecule every time they run —
which happens on every atom add/remove, every electron/proton/neutron
delta (voice command, gesture corner-pinch, or template load), and every
atom↔molecule mode switch. Before rebuilding, each function did:
```ts
const old = scene.getObjectByName("molecule");
if (old) scene.remove(old);
```
`scene.remove()` only unlinks the object from the render graph — it does
**not** free the GPU resources (geometries, materials, canvas-texture
sprites from `labelSprite()`) that object was holding. Three.js requires an
explicit `.dispose()` call on each geometry/material/texture, which was
never happening here. Over a session with repeated add/remove/particle-edit
actions (exactly what voice commands like "add two electrons" or gesture
corner-pinches trigger), this leaked an unbounded number of geometries,
materials, and canvas textures — a genuine, accumulating memory leak, not
just a style nit. (By contrast, `lib/orbScene.ts`'s `dispose()` already did
this correctly for the main orb — this fix brings `MoleculeLab.tsx` in line
with that existing pattern rather than inventing a new one.)

**Fix:** added a `disposeObject3D()` helper (traverses an object, disposes
every child's geometry, material(s), and any texture a material holds —
`map`, `alphaMap`, `emissiveMap`) and called it immediately before
`scene.remove(old)` in both `renderAtomicModel()` and `renderMolecule()`.
Also added the same disposal call to the Three.js scene's unmount cleanup
(previously only `renderer.dispose()` + `scene.clear()` ran there, which —
same issue — never freed the grid/stars/dust geometries and materials
allocated at mount).

No visual behavior, gesture behavior, or voice-command behavior changed —
this is purely resource cleanup that was missing.

### 1.3 Everything else checked and found *not* to be a bug
I want to be explicit about what I looked at carefully and did **not**
change, so nothing here reads as unverified:

- **`lib/orbScene.ts`** (1,049 lines, the main orb): geometry/material
  allocation is all one-time at scene creation (no leak on
  theme/performance-mode changes), `dispose()` already tears down every
  geometry/material/texture correctly, resize/RAF/listener cleanup is
  correct, and the theme system's `userData.themeRole` tagging is stable
  across repeated custom-color ↔ preset-theme switches.
- **`lib/handTracker.ts`** (392 lines): camera stream lifecycle, MediaPipe
  GPU→CPU fallback, hand-identity matching (position-based, not
  MediaPipe's flicker-prone Left/Right label), pinch hysteresis, and
  RAF/stream teardown in `stop()` are all correct and already carry
  detailed comments about prior fixes in this exact area.
- **`lib/voice/*`** (voiceRouter, onlineTTS, speechRecognition, platform):
  the speech queue correctly serializes local-command and AI-response
  speech so they never talk over each other; the online→browser TTS
  fallback path is fully covered (timeout, non-2xx, network failure, and
  playback-blocked all fall back correctly); the wake-word listener's
  auto-restart has a deliberate 250ms backoff to avoid Android Chrome mic
  stutter. No leaks, no unguarded async paths.
- **API routes** (`chat`, `key`, `tts`, `health`, all `remote/*`): no
  hardcoded secrets anywhere — every credential is read from
  `process.env` server-side only; `lib/serverKey.ts` never persists keys
  to disk and never returns them to the browser; Twilio signature
  verification and the admin-token check both use
  `crypto.timingSafeEqual` correctly (length-checked before comparing,
  which avoids both a timing side-channel and a `RangeError` from
  mismatched-length buffers).
- **`lib/laboratory/elements.ts`**: all 118 elements present; H, O, C, N,
  Al (needed for H₂O, CO₂, O₂, CH₄, NH₃, Al₂O₃) all resolve correctly
  through `ELEMENT_BY_SYMBOL`.
- **Embedded-only Molecule Lab**: `JarvisOrb.tsx` only ever renders
  `<MoleculeLab embedded ... />` — the non-embedded standalone
  `lab-overlay` JSX branch inside `MoleculeLab.tsx` (full periodic-table
  sidebar, template list, etc.) is unreachable dead code from the earlier
  "Integrated Atom/Molecule Visualization into Main Orb" change documented
  in `HANDOFF.md`. I did **not** remove it per your instruction not to
  remove/redesign working things unnecessarily, but flagging it: it means
  the periodic-table search box, template buttons, and BREAK/REARRANGE/
  VALIDATE buttons you'd see in that branch are **not** reachable from the
  running app today. All of that functionality is still present in
  embedded mode — just exclusively through voice commands and hand
  gestures (by design, per HANDOFF.md's "Integrated Atom/Molecule
  Visualization" entry), not through on-screen buttons. If you actually
  want those buttons reachable in embedded mode too, that's a product
  decision/feature addition, not a bug fix, so I left it alone.
- **Remote Command Gateway**: `deliverRemoteResult()` only delivers a
  reply for `SMS`/`WHATSAPP` sources, not `CALL`. This is not a bug I
  introduced or need to fix — it's explicitly documented as "Known
  limitation #4" in `HANDOFF.md` ("Call replies are acknowledgements
  rather than the final JARVIS answer"), a real constraint of Twilio's
  synchronous voice-webhook model, not an oversight.
- Grepped the whole project for any other literal `\n`/`\t` sequences
  outside string literals (the bug in §1.1's pattern) — none found. The
  one other `\n\n` hit in the codebase (`app/api/remote/events/route.ts`)
  is a legitimate SSE heartbeat comment (`": heartbeat\n\n"`), required by
  the SSE protocol, inside an actual string literal — correct as-is.
- No `TODO`/`FIXME`/`HACK` markers anywhere in the source.

---

## 2. Feature-by-feature walkthrough (static verification)

Since I can't launch the dev server, this is what I verified by tracing the
code paths rather than by clicking through a running app. I'm listing it
so you know exactly what "tested" means in §4 below.

| Area | What I traced | Result |
|---|---|---|
| Main orb | `createOrbScene()` mount/dispose lifecycle in `JarvisOrb.tsx`'s primary `useEffect` (stable `[]`-deps callbacks, runs once) | Correct, single scene instance, no duplicate creation |
| Atom/Molecule Orb integration | `moleculeLabOpen` toggles a CSS class that hides (not unmounts) the orb container; `<MoleculeLab embedded>` overlays it | Orb scene keeps running underneath (state preserved on return, per HANDOFF.md's design) — confirmed no separate route/page, everything mounts inside the same component tree |
| Voice → Molecule Lab bridge | `jarvis-molecule-voice` CustomEvent dispatched in `JarvisOrb.tsx`, listened for in `MoleculeLab.tsx` | Event name matches on both sides; regex-based intent routing for atoms/molecules/electrons/protons/neutrons/bonds and all 6 templates (H₂O, CO₂, O₂, CH₄, NH₃, Al₂O₃) traced end-to-end |
| Hand tracking → Molecule Lab bridge | `jarvis-hand-gesture` CustomEvent dispatched from `HandTracker.processHands()`, consumed by `MoleculeLab.tsx`'s gesture effect | Single shared camera/tracker (no second `getUserMedia` call); pinch-to-grab, corner-zone add/remove atom/electron, two-hand pinch zoom all trace correctly |
| Touch/mouse controls | `OrbitControls` on the lab's own renderer (embedded canvas), separate `OrbitControls` on the main orb | Both instances have independent `dispose()` calls; no leaked listeners on unmount |
| Performance Mode (Low/Auto/High + Medium) | `applyPerformanceMode()` in `JarvisOrb.tsx` → `orbScene.setPerformanceMode()` / `handTracker.setTrackingQuality()`; AUTO mode's FPS-sample hysteresis loop | Pixel-ratio caps compose correctly with Desktop Mode's separate cap (min of the two, not override); AUTO's up/down-shift hysteresis has a 6s cooldown and requires 3 low-FPS or 8 high-FPS samples before switching, preventing flapping |
| Desktop Mode | `detectDeviceMode()` — resolved once from UA-CH / UA string, not viewport width | Confirmed it can't be toggled by resize/rotation; Android path is completely unaffected (mode only ever adds behavior behind `desktopMode &&` guards) |
| Diagnostics | `localCommand()`'s diagnostics branch in `JarvisOrb.tsx` | Every line source-traced to a real live check (WebGL context probe, `navigator.onLine`, `getUserMedia` presence, live `/api/key` + `/api/health` round-trip) — nothing hardcoded |
| Local commands | Theme (name/hex/RGB), API key open/remove, clear conversation, memory show/clear/forget/remember, performance mode, diagnostics, molecule/atom lab | All regex-matched and handled before any AI request — confirmed `askAI()` calls `localCommand()` first and returns early on a match, so these all work with **no AI provider connected** |
| API-key popup | `/api/key` GET/POST/DELETE, `lib/serverKey.ts` | Key never leaves the server process; DELETE without a body defaults to the active provider; POST validates with a live 8-token completion request against the real provider endpoint before accepting the key |
| Remote Command Gateway | `/api/remote/*` routes, `lib/remote/gateway.ts`, `lib/remote/twilio.ts` | Signature verification, sender allowlist, rate limiting, dedup, and the same-origin HttpOnly session cookie all correctly gate every remote entry point; remote commands re-enter the exact same `askAI()`/`localCommand()` path as the orb (no duplicate command logic) |
| Browser voice (TTS) | `speak()` / `speakAIResponse()` in `voiceRouter.ts` | Local commands always use the browser voice; AI replies try online TTS first and fall back to the browser voice on any failure (timeout/network/unconfigured/playback-blocked), verified for each failure branch |

---

## 3. Fixes made (summary)

| # | File | Change | Why |
|---|---|---|---|
| 1 | `components/JarvisOrb.tsx` | Replaced a literal `\n\n` between two JSX blocks with a real newline | Was rendering as visible garbage text in the HUD |
| 2 | `components/MoleculeLab.tsx` | Added `disposeObject3D()` helper; called it before every `scene.remove(old)` of the "molecule" group, and in the scene's unmount cleanup | Fixes a real, accumulating GPU memory leak (geometries/materials/textures never freed on rebuild) |

Nothing else was changed. No feature was removed, redesigned, or rewritten.
No dependency versions, config files, or environment variable names were
touched. No secrets were added anywhere.

---

## 4. Tests performed / commands used / what could not run

```bash
# 1. Extracted the ZIP
unzip jarvis-mark-7-orb-molecule.zip

# 2. Attempted a real install (both failed — no network egress in this sandbox)
npm ping
# → npm error code E403 — 403 Forbidden - GET https://registry.npmjs.org/-/ping
npm install
# → npm error code E403 — 403 Forbidden - GET .../undici-types-7.18.2.tgz
```
Both confirmed the sandbox cannot reach the npm registry at all (not a
project-specific dependency problem — even the registry ping was rejected).
Consequently `node_modules` was never populated, and the following could
**not** be run and are **not** claimed to have passed:
- `npm run build` (`next build`)
- `npm run dev` / `npm run dev -- --webpack` (Termux/Android target)
- `npm run start`
- A real `next lint`
- A real `tsc --noEmit` with actual `@types/react`, `@types/three`,
  `@types/node`, `next`, and `@mediapipe/tasks-vision` type declarations

**What I ran instead**, using a TypeScript compiler already present in this
sandbox for unrelated tooling (`typescript@6.0.3`, vs. this project's
`^5` — noted so you know it isn't the exact pinned version):
```bash
tsc --noEmit -p tsconfig.json
```
Without `node_modules`, this reports ~430 diagnostics, and **all of them**
are `TS2307 Cannot find module` (react/next/three/@mediapipe) or the
implicit-`any` errors that cascade from those unresolved imports — i.e.
100% attributable to the missing `node_modules`, not to a code defect. I
confirmed this by diffing the full diagnostic output from before my edits
against after my edits (both normalized and byte-identical in count: 431
lines each) — my two fixes introduced zero new diagnostics of any kind,
including the cascading ones. This is a real but limited signal: it proves
the edited files still parse and the edits didn't newly break anything
TypeScript could see even in this degraded mode, but it is **not** a
substitute for a real typecheck against actual type packages, and I'm not
presenting it as one.

**Also performed (no network required):**
- Full manual read of all 30 `.ts`/`.tsx` files (5,215 lines) — see §1 and §2.
- `grep`-based sweep for other instances of the §1.1 bug pattern (stray
  escape sequences outside string literals) — none found elsewhere.
- `grep`-based sweep for `TODO`/`FIXME`/`HACK` markers — none found.
- Cross-checked every CSS class referenced from `.tsx` files against
  `app/globals.css` — all present (`.mic-idle` has no dedicated rule, which
  is correct: idle is the default state and needs no special styling beyond
  the shared `.mic-btn` rule).
- Confirmed no hardcoded API keys/secrets anywhere in the source tree
  (`grep` for common key patterns + manual read of every `process.env.*`
  usage — all read server-side only, all optional with safe fallbacks,
  none committed to `.env.example` with real values).

**You should run in a normal, network-connected environment before
deploying:**
```bash
npm install
npx tsc --noEmit
npm run build
npm run start          # or: npm run dev
npm run dev -- --webpack   # Android/Termux specifically, per README.md
```

---

## 5. Remaining issues / things worth your attention (not fixed — out of scope for a bug-fix pass)

1. **Standalone (non-embedded) `MoleculeLab` UI is dead code.** See §1.3.
   Not broken, just unreachable. Leave it, remove it, or wire it up as a
   deliberate feature decision — I didn't decide for you.
2. **`CALL`-sourced remote commands never get a spoken-back result** (only
   an immediate "processing" acknowledgement). Documented, pre-existing,
   architectural — see §1.3.
3. **This project has never had a confirmed green `npm run build` in any
   sandbox it's passed through** (this one, and per `HANDOFF.md`, at least
   one prior agent's sandbox too). I'd treat a first real build in your own
   environment as a meaningful checkpoint, not a formality — if anything
   surfaces there, it'll be the first real compiler feedback this exact
   code has gotten.
4. Minor, not fixed: several handler functions in `MoleculeLab.tsx`
   (`loadTemplate`, `addAtomOfElement`, `removeAtom`, `breakMolecule`,
   `rearrange`, `validate`) aren't wrapped in `useCallback`, so the voice-
   command listener effect (which lists them as dependencies) tears down
   and re-subscribes its event listener on every render. It's not a
   functional bug — the listener is always correctly re-attached with
   fresh closures — just avoidable churn. Left as-is since it's
   pre-existing, working, and fixing it would mean touching working state
   logic beyond the scope of a bug fix.

---

## 6. Security note

No provider credentials, admin tokens, or Twilio secrets are present
anywhere in this ZIP — `.env.example` ships with every value blank/placeholder
(confirmed by reading it directly). All server-side secrets are read
exclusively from `process.env` at request time and are never logged,
returned to the browser, or written to disk. This was true before my
changes and remains true after — I did not add, remove, or touch any
credential-handling code.

## 2026-08-14 follow-up — Orb visual integration

Implemented the requested visual direction: embedded Atom/Molecule mode no longer renders its previous lab header/status/gesture HUD; it is now a transparent 3D visual stage occupying the same central area while the existing JARVIS conversational HUD remains active. Added real Three.js `UnrealBloomPass` bloom for HIGH and MEDIUM modes, theme-synchronized holographic materials/glows for Amber/Blue/Purple/Green/Red/custom colors, smooth entrance/rotation/pulse animation, centered camera, and propagation of the existing global performance mode. LOW retains core atom/electron/bond visibility and skips bloom. The standalone non-embedded branch remains retained but is not mounted by the main orb. A full build remains unverified until dependencies can be installed in a network-connected environment.
