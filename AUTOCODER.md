# JARVIS Autocoder

A self-editing code agent built into JARVIS. You describe a change in plain words
("add a /api/ping route", "make the briefing mention the weather first"); it reads the
relevant files, writes **exact search/replace edits**, type-checks the whole project, fixes its
own mistakes, and **rolls back automatically** if it can't get a clean build.

## Turn it on

In `.env`:

```
AUTOCODER_ENABLED=true
AUTOCODER_MODE=propose        # or "auto"
JARVIS_ACCESS_TOKEN=...       # required (all JARVIS APIs need it)
```

Restart. An **⚙ AUTOCODER** button appears bottom-right. The agent also gets an `autocode` tool,
so you can just say "JARVIS, add X to yourself".

> Use `npm run dev` for live self-editing (hot reload). In a production build, edits are saved
> but need `npm run build` + restart to take effect.

## Modes

| Mode | What happens |
|---|---|
| `propose` (default) | Every change becomes a diff in the panel. Nothing is written until you click **Approve & apply**. |
| `auto` | Changes apply by themselves **only while you have armed auto mode** from the panel (1–60 min, default 10). Telegram/Discord can never arm it. |

## The safety net

1. **Path guard** – only `.ts .tsx .css .md .py` under `app/ components/ lib/ scripts/ docs/`. Android/device-controller source is excluded from the writable tree. No absolute paths, `..`, or symlink escapes.
2. **Protected files (never editable)** – `.env*`, `data/`, `package.json`/lock, `tsconfig`, `next.config`, `Dockerfile`, `lib/security.ts`, `lib/serverKey.ts`, `app/api/key/**`, `lib/remote/**`, `app/api/remote/**`, `android/**`, `app/api/android/**`, `lib/agents/androidTools.ts`, `lib/system/control.ts`, `lib/smarthome/**`, `lib/privacy/**`, `lib/evolution/**`, `app/api/privacy/**`, `app/api/evolution/**`, `lib/agents/tool-registry.ts`, `lib/tools/execute.ts`, `lib/agents/provider.ts`, `lib/voice/**`, `app/layout.tsx`, `app/api/chat/**`, `app/api/agent/**`, `app/api/tts/**`, `app/api/realtime/**`, `app/api/briefing/**`, `app/api/stocks/**`, `app/api/system-check/**`, `components/commandcenter/PrivacyView.tsx`, and the autocoder itself. Add more with `AUTOCODER_PROTECTED=lib/memory/*,app/api/chat/*`.
3. **Exact-match edits** – a `search` block must match exactly one place, otherwise the proposal is rejected (one automatic retry). Max 6 files / 20 edits per change.
4. **Verify against baseline** – `tsc --noEmit` runs before and after; only errors the change *introduced* count. Python files get `py_compile`.
5. **Self-repair** – new errors are fed back to the model (`AUTOCODER_REPAIR_ROUNDS`, default 2). Still broken → everything is restored from the snapshot.
6. **Snapshots + one-click rollback** – last 50 in `data/autocoder/snapshots/`.
7. **Audit log** – every propose / apply / arm / rollback in `data/autocoder/audit.log`.
8. **Auto mode refuses to run** if the type-checker isn't available (`npm install` first).

Type-checking proves the code compiles, not that it behaves — review diffs for anything important.

## Files added

```
lib/autocoder/{guard,store,verify,engine,tools}.ts
app/api/autocoder/route.ts          GET status/history · POST propose|apply|reject|rollback|arm|disarm
components/addons/AutocoderPanel.tsx
```

Small edits to existing files: `lib/agents/provider.ts` (optional `timeoutMs`),
`lib/agents/tool-registry.ts` (registers the tool), `components/addons/AddonsHost.tsx` (mounts the panel),
`.env.example`.

It uses whichever LLM provider JARVIS is already connected to. Bigger models (Claude, GPT-5, Gemini Pro)
write far more reliable edits than small ones.
