import { RealtimeVoice, type RealtimeState } from "./client";
import { RobotVoiceChain } from "./effects";
import { DamageController, type DamageKind } from "./damage";
import { setRealtimeLevel } from "./levelBus";
import { createToolBridge } from "./toolBridge";

type Snap = { state: RealtimeState; detail: string; damage: boolean; lastDamage: string };
type Listener = (s: Snap) => void;

let snap: Snap = { state: "idle", detail: "", damage: true, lastDamage: "" };
const listeners = new Set<Listener>();
const emit = (p: Partial<Snap>) => { snap = { ...snap, ...p }; listeners.forEach((l) => l(snap)); };

let rt: RealtimeVoice | null = null;
let chain: RobotVoiceChain | null = null;
let damage: DamageController | null = null;
let raf = 0;

function teardown() {
  cancelAnimationFrame(raf);
  damage?.stop(); damage = null;
  chain?.dispose(); chain = null;
  setRealtimeLevel(0);
}

export const voiceSession = {
  subscribe(l: Listener) { listeners.add(l); l(snap); return () => { listeners.delete(l); }; },

  async start() {
    if (rt) return;
    try {
      chain = await RobotVoiceChain.create(); // inside the click gesture
    } catch (e) {
      emit({ state: "error", detail: e instanceof Error ? e.message : "Audio init failed" });
      return;
    }
    const c = chain;
    damage = new DamageController(c.controls, (k: DamageKind | "recovered") => emit({ lastDamage: k }));
    damage.enabled = snap.damage;
    const bridge = createToolBridge((o) => rt?.send(o));
    rt = new RealtimeVoice({
      onRemoteStream: (s) => c.connectStream(s),
      onOpen: () => void bridge.onOpen(),
      onEvent: (e) => void bridge.onEvent(e),
      onState: (state, detail) => {
        emit({ state, detail: detail ?? "" });
        if (state === "live") { damage?.start(); const tick = () => { setRealtimeLevel(c.level()); raf = requestAnimationFrame(tick); }; tick(); }
        if (state === "idle" || state === "error") { teardown(); rt = null; }
      },
    });
    await rt.start();
  },

  stop(reason = "stopped") { rt?.stop(reason); },
  setDamage(on: boolean) { if (damage) damage.enabled = on; emit({ damage: on }); },
  triggerDamage(k?: DamageKind) { damage?.trigger(k); },

  /** Kill switch: stop the session and stop the server minting new keys. */
  async kill() {
    rt?.stop("kill switch");
    await fetch("/api/realtime/token", { method: "DELETE" }).catch(() => {});
  },
};
