# Historical add-on notes: Realtime Voice + Android Hands

> **Current release scope notice (2026-11-16):** Android Hands / device control is excluded from JARVIS MARK 7. This file is retained only as historical engineering notes. Do not enable or advertise Android control as a supported release feature. The runtime now requires both `JARVIS_EXPERIMENTAL_DEVICE_CONTROL=true` and `ANDROID_HANDS_ENABLED=true` to register the legacy tools or expose the legacy API. A future universal controller must be designed separately with its own threat model and native agent architecture.

# JARVIS additions: Realtime Voice + Android Hands

## 0. Where the add-ons live (and what you can replace freely)
All add-on code is in NEW files only: `lib/realtime/`, `components/addons/`, `app/template.tsx`, `app/api/realtime/`,
`app/api/android/`, `lib/agents/androidTools.ts`, `android/`. `app/template.tsx` mounts the UI automatically, so
`app/layout.tsx`, `app/page.tsx`, `lib/orbScene.ts`, `lib/handTracker.ts`, `components/JarvisOrb.tsx`, `next.config.ts`
are IDENTICAL to your original and can be replaced wholesale at any time. Nothing in the add-ons imports them.
The only existing file edited is `lib/agents/tool-registry.ts` (2 lines: import + `registerAndroidTools(registerTool)`).
The orb glow is a separate overlay (`components/addons/OrbAudioGlow.tsx`). To make the orb mesh itself react to voice,
optionally apply `addons-optional/orb-mesh-reacts-to-voice.patch` to your orbScene (5 lines; skip if you replace the file).

## 1. Env (append to .env.local)
```
OPENAI_API_KEY=sk-...                  # or enter OpenAI via the AI popup
OPENAI_REALTIME_MODEL=gpt-realtime-2   # check your dashboard / pricing page
REALTIME_VOICE=alloy
REALTIME_MAX_SESSION_SECONDS=300
REALTIME_MAX_MINTS_PER_DAY=20
REALTIME_MIN_GAP_SECONDS=15

ANDROID_HANDS_ENABLED=true
ANDROID_BRIDGE_TOKEN=<long random string>
ANDROID_BRIDGE_URL=http://127.0.0.1:8765
ANDROID_AGENT_API_KEY=<Groq key>       # or GROQ_API_KEY
ANDROID_AGENT_MODEL=llama-3.3-70b-versatile
ANDROID_AGENT_MAX_STEPS=12
REALTIME_TOOLS=get_current_time,web_search,get_weather,convert_currency,android_*   # tools the voice may call
REALTIME_MAX_TOOL_CALLS_PER_DAY=100
# ANDROID_APP_ALLOWLIST=chrome=com.android.chrome,settings=com.android.settings
```
Also set a monthly budget/usage limit on the OpenAI project. That is the only cap that holds if code misbehaves.

## 2. Voice test (works on Termux)
`npm run dev`, open http://localhost:3000, tap 🎙 VOICE, allow the mic, talk (headphones help).
DAMAGE ON = random dropouts / power sags / glitches then recovery. KILL VOICE stops the session and blocks new keys.

## 3. Android test (needs a PC or a second phone)
Phone: enable Developer options > USB debugging; plug into the PC; accept the RSA prompt.
```
cd android
python selftest.py                      # offline sanity check, no phone needed
adb devices                             # must list your phone as "device"
export ANDROID_BRIDGE_TOKEN=<same token as .env.local>
python server.py --mode http            # keep running
```
In the JARVIS UI tap ARM ANDROID 10m, then ask JARVIS: "open settings on my phone", then "search for pizza near me".
Standalone MCP server (other clients): `pip install mcp && python server.py --mode mcp`.

## Safety
- App allowlist (policy.py / ANDROID_APP_ALLOWLIST); tap/type refused unless the foreground app is allowlisted.
- Autonomous agent: step limit (default 12, max 25), verifies each step, stops after 3 unverified steps, stops at sensitive controls (pay/buy/transfer...), never types into password fields.
- Kill switch: KILL ANDROID button, or `touch ~/.jarvis_android_kill`.
- Android tools only work while armed from the local UI (time-limited); Telegram/Discord cannot arm.
