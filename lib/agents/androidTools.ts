// Bridges the Python Android layer (android/server.py --mode http) into the agent tool registry.
// Gates: ANDROID_HANDS_ENABLED=true AND the owner has "armed" Android control from the local UI (time-limited).
// Telegram/Discord commands can use the tools only while armed; they can never arm it themselves.

const K = "__jarvisAndroidArm";
const g = globalThis as unknown as Record<string, number>;

export function armAndroid(minutes: number) {
  const m = Math.min(60, Math.max(1, Math.floor(minutes) || 10));
  g[K] = Date.now() + m * 60_000;
  return androidStatus();
}
export function disarmAndroid() { g[K] = 0; return androidStatus(); }
export function androidStatus() {
  const left = Math.max(0, (g[K] ?? 0) - Date.now());
  return { enabled: process.env.ANDROID_HANDS_ENABLED === "true", armed: left > 0, minutesLeft: Math.ceil(left / 60_000) };
}

const base = () => process.env.ANDROID_BRIDGE_URL || "http://127.0.0.1:8765";

export async function bridgeFetch(path: string, body?: unknown, timeoutMs = 20_000) {
  const res = await fetch(base() + path, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", "x-bridge-token": process.env.ANDROID_BRIDGE_TOKEN || "" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Android bridge ${res.status}: ${text.slice(0, 200)}`);
  return text;
}

async function call(name: string, args: Record<string, unknown>, timeoutMs?: number) {
  const st = androidStatus();
  if (!st.armed) throw new Error("Android control is not armed. Tap ARM ANDROID in the JARVIS UI first.");
  return bridgeFetch("/tool", { name, args }, timeoutMs);
}

const def = (name: string, description: string, properties: Record<string, unknown>, required: string[] = []) => ({
  type: "function",
  function: { name, description, parameters: { type: "object", properties, required } },
});

/** Called by tool-registry.ts (avoids a circular import). */
export function registerAndroidTools(register: (d: any, h: (a: Record<string, unknown>) => Promise<string>) => void) {
  if (process.env.JARVIS_EXPERIMENTAL_DEVICE_CONTROL !== "true" || process.env.ANDROID_HANDS_ENABLED !== "true") return;
  register(def("android_open_app", "Open an allowlisted app on the connected Android phone by name (e.g. chrome, settings).", { app: { type: "string" } }, ["app"]),
    (a) => call("open_app", a));
  register(def("android_tap", "Tap the Android screen at x,y pixels, or on an on-screen element by its visible text.", { x: { type: "number" }, y: { type: "number" }, text: { type: "string" } }),
    (a) => call("tap", a));
  register(def("android_type_text", "Type ASCII text into the focused field on the Android phone.", { text: { type: "string" } }, ["text"]),
    (a) => call("type_text", a));
  register(def("android_swipe", "Swipe the Android screen: direction up|down|left|right.", { direction: { type: "string", enum: ["up", "down", "left", "right"] } }, ["direction"]),
    (a) => call("swipe", a));
  register(def("android_read_screen", "Read the current Android screen as a compact list of visible elements.", {}),
    (a) => call("read_screen", a));
  register(def("android_run_agent_task", "Do a multi-step task on the Android phone (fast scripted flows first, then an autonomous step-limited agent). Describe the goal in plain words.", { task: { type: "string" } }, ["task"]),
    (a) => call("run_agent_task", a, 180_000));
}
