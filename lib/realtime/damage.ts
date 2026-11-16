import type { DamageControls } from "./effects";

export type DamageKind = "dropout" | "sag" | "glitch";

/** Occasionally breaks the voice (dropout / power sag / glitch), then recovers. All via AudioParam automation. */
export class DamageController {
  enabled = true;
  intensity = 0.5; // 0..1: higher = more frequent
  private timer: ReturnType<typeof setTimeout> | null = null;
  private recoverTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private c: DamageControls, private onEvent?: (k: DamageKind | "recovered") => void) {}

  start() { this.stop(); this.schedule(); }

  stop() {
    if (this.timer) clearTimeout(this.timer);
    if (this.recoverTimer) clearTimeout(this.recoverTimer);
    this.timer = this.recoverTimer = null;
    this.restore(0.05);
  }

  private schedule() {
    const mean = 14_000 - this.intensity * 10_000; // 4s..14s
    this.timer = setTimeout(() => { if (this.enabled) this.trigger(); else this.schedule(); }, mean * (0.5 + Math.random()));
  }

  trigger(kind?: DamageKind) {
    const k = kind ?? (["dropout", "sag", "glitch"] as const)[Math.floor(Math.random() * 3)];
    const { ctx, master, drive, ringFreq, pitch, base } = this.c;
    const t = ctx.currentTime;
    const hold = (p: AudioParam) => { const v = p.value; p.cancelScheduledValues(t); p.setValueAtTime(v, t); };
    let dur = 0.5;

    if (k === "dropout") {
      hold(master.gain);
      let at = t;
      const bursts = 2 + Math.floor(Math.random() * 3);
      for (let i = 0; i < bursts; i++) {
        master.gain.linearRampToValueAtTime(0, (at += 0.01));
        master.gain.setValueAtTime(0, (at += 0.04 + Math.random() * 0.1));
        master.gain.linearRampToValueAtTime(base.master, (at += 0.01));
        at += 0.03 + Math.random() * 0.06;
      }
      master.gain.linearRampToValueAtTime(0, (at += 0.01));
      at += 0.15 + Math.random() * 0.3 * (0.5 + this.intensity);
      master.gain.setValueAtTime(0, at);
      dur = at - t;
    } else if (k === "sag") {
      if (pitch) { hold(pitch); pitch.linearRampToValueAtTime(base.pitch * 0.6, t + 0.2); }
      hold(ringFreq); ringFreq.linearRampToValueAtTime(base.ring * 0.4, t + 0.25);
      hold(master.gain); master.gain.linearRampToValueAtTime(base.master * 0.55, t + 0.25);
      dur = 0.9 + Math.random() * 0.6;
    } else {
      hold(drive.gain); drive.gain.linearRampToValueAtTime(base.drive * 3.5, t + 0.03);
      hold(ringFreq);
      const steps = 6 + Math.floor(Math.random() * 6);
      for (let i = 1; i <= steps; i++) ringFreq.setValueAtTime(20 + Math.random() * 380, t + i * 0.06);
      if (pitch) { hold(pitch); for (let i = 1; i <= steps; i++) pitch.setValueAtTime(base.pitch * (0.6 + Math.random() * 0.8), t + i * 0.06); }
      dur = steps * 0.06 + 0.1;
    }

    this.onEvent?.(k);
    this.recoverTimer = setTimeout(() => {
      this.restore(0.35);
      this.onEvent?.("recovered");
      this.schedule();
    }, dur * 1000);
  }

  private restore(sec: number) {
    const { ctx, master, drive, ringFreq, pitch, base } = this.c;
    const t = ctx.currentTime;
    const to = (p: AudioParam, v: number) => { const cur = p.value; p.cancelScheduledValues(t); p.setValueAtTime(cur, t); p.linearRampToValueAtTime(v, t + sec); };
    to(master.gain, base.master); to(drive.gain, base.drive); to(ringFreq, base.ring);
    if (pitch) to(pitch, base.pitch);
  }
}
