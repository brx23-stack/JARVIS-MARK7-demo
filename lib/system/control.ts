// ——— System control ———
//
// Lets JARVIS control the machine it's running on: volume, media playback,
// opening a small set of pre-approved apps/URLs. Deliberately NOT "run
// arbitrary shell command the model asked for" — that would let anything
// the model hallucinates (or a prompt-injected web page/email/remote
// message) execute on your machine. Instead:
//   - media/volume actions map to a small fixed switch statement, one
//     branch per OS, with no user/model-supplied text reaching the shell
//   - "open app" only accepts a name that exists as a key in
//     SYSTEM_APP_ALLOWLIST below, which you populate yourself in
//     .env.local — the model can pick a key, never a path or command
//
// This keeps the blast radius of "the AI decided to call a tool" bounded
// to a short list of things you explicitly opted into.

import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);
const COMMAND_TIMEOUT_MS = 5_000;

type Platform = "darwin" | "win32" | "linux";

function detectPlatform(): Platform {
  const p = process.platform;
  if (p === "darwin" || p === "win32" || p === "linux") return p;
  return "linux";
}

// Populate via SYSTEM_APP_ALLOWLIST in .env.local, e.g.:
//   SYSTEM_APP_ALLOWLIST=spotify:Spotify,notes:Notes,browser:Google Chrome
// Left-hand side is the name the model refers to it by; right-hand side is
// the exact app name passed to the OS opener (macOS `open -a "<name>"`,
// Windows `start "" "<name>"`, Linux `xdg-open <name>` treated as a command).
function getAppAllowlist(): Record<string, string> {
  const raw = process.env.SYSTEM_APP_ALLOWLIST || "";
  const map: Record<string, string> = {};
  for (const entry of raw.split(",")) {
    const [key, ...rest] = entry.split(":");
    if (key && rest.length) map[key.trim().toLowerCase()] = rest.join(":").trim();
  }
  return map;
}

async function run(cmd: string): Promise<void> {
  await execAsync(cmd, { timeout: COMMAND_TIMEOUT_MS });
}

export async function openApp(name: string): Promise<string> {
  const allowlist = getAppAllowlist();
  const target = allowlist[name.trim().toLowerCase()];
  if (!target) {
    const known = Object.keys(allowlist);
    return known.length
      ? `"${name}" isn't in the allowed app list. Configured apps: ${known.join(", ")}.`
      : `No apps are configured. Set SYSTEM_APP_ALLOWLIST in .env.local to enable this.`;
  }
  const platform = detectPlatform();
  try {
    if (platform === "darwin") await run(`open -a "${target}"`);
    else if (platform === "win32") await run(`start "" "${target}"`);
    else await run(`${target} &`); // linux: allowlist value is the launch command itself
    return `Opened ${name}.`;
  } catch (err) {
    return `Failed to open ${name}: ${err instanceof Error ? err.message : "unknown error"}`;
  }
}

export async function setSystemVolume(percent: number): Promise<string> {
  const clamped = Math.max(0, Math.min(100, Math.round(percent)));
  const platform = detectPlatform();
  try {
    if (platform === "darwin") await run(`osascript -e "set volume output volume ${clamped}"`);
    else if (platform === "win32") {
      // Windows has no simple CLI volume setter; nircmd is the common
      // lightweight tool for this — install it separately if you want this
      // branch to work, otherwise it reports the limitation below.
      throw new Error("Volume control on Windows requires nircmd or a similar tool to be installed.");
    } else await run(`amixer set Master ${clamped}%`);
    return `Volume set to ${clamped}%.`;
  } catch (err) {
    return `Couldn't set volume: ${err instanceof Error ? err.message : "unknown error"}`;
  }
}

export async function mediaControl(action: "play" | "pause" | "next" | "previous"): Promise<string> {
  const platform = detectPlatform();
  const keyMap = { play: "play", pause: "pause", next: "next track", previous: "previous track" } as const;
  try {
    if (platform === "darwin") {
      // Uses macOS media key simulation via System Events.
      const keyCode = { play: 16, pause: 16, next: 17, previous: 18 }[action];
      await run(`osascript -e 'tell application "System Events" to key code ${keyCode}'`);
    } else if (platform === "linux") {
      await run(`playerctl ${action === "previous" ? "previous" : action}`);
    } else {
      throw new Error("Media key control isn't wired up for Windows in this build.");
    }
    return `Media: ${keyMap[action]}.`;
  } catch (err) {
    return `Couldn't control media: ${err instanceof Error ? err.message : "unknown error"}`;
  }
}
