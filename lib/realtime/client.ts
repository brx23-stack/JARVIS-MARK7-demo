import { cancelSpeech } from "@/lib/voice/voiceRouter";

export type RealtimeState = "idle" | "connecting" | "live" | "error";
type Opts = {
  onState?: (s: RealtimeState, detail?: string) => void;
  /** If set, you own playback (the effects chain plugs in here). */
  onRemoteStream?: (stream: MediaStream) => void;
  onEvent?: (event: any) => void;
  onOpen?: () => void;
};

export class RealtimeVoice {
  state: RealtimeState = "idle";
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private mic: MediaStream | null = null;
  private audioEl: HTMLAudioElement | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private gen = 0;

  constructor(private opts: Opts = {}) {}

  private set(s: RealtimeState, detail?: string) {
    this.state = s;
    this.opts.onState?.(s, detail);
  }

  async start() {
    if (this.pc || this.state === "connecting") return;
    const gen = ++this.gen;
    this.set("connecting");
    cancelSpeech(); // never talk over the old TTS path
    try {
      const r = await fetch("/api/realtime/token", { method: "POST" });
      const tok = await r.json().catch(() => ({}));
      if (!r.ok || !tok.value) throw new Error(tok.error || `Token request failed (${r.status})`);
      if (gen !== this.gen) return;

      this.mic = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      if (gen !== this.gen) return this.cleanup();

      const pc = new RTCPeerConnection();
      this.pc = pc;
      this.mic.getTracks().forEach((t) => pc.addTrack(t, this.mic!));

      pc.ontrack = (e) => {
        const stream = e.streams[0];
        if (this.opts.onRemoteStream) this.opts.onRemoteStream(stream);
        else {
          const el = (this.audioEl = document.createElement("audio"));
          el.autoplay = true;
          el.srcObject = stream;
        }
      };
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "connected") this.set("live");
        if (pc.connectionState === "failed") this.stop("connection failed");
      };

      this.dc = pc.createDataChannel("oai-events");
      this.dc.onopen = () => this.opts.onOpen?.();
      this.dc.onmessage = (m) => {
        try { this.opts.onEvent?.(JSON.parse(m.data)); } catch {}
      };

      await pc.setLocalDescription(await pc.createOffer());
      const sdp = await fetch("https://api.openai.com/v1/realtime/calls", {
        method: "POST",
        body: pc.localDescription!.sdp,
        headers: { Authorization: `Bearer ${tok.value}`, "Content-Type": "application/sdp" },
      });
      if (!sdp.ok) throw new Error(`Realtime connect failed (${sdp.status})`);
      if (gen !== this.gen) return this.cleanup();
      await pc.setRemoteDescription({ type: "answer", sdp: await sdp.text() });

      // Hard session cap, enforced client-side. The server also limits sessions/day.
      this.timer = setTimeout(() => this.stop("session time limit reached"), tok.maxSessionSeconds * 1000);
    } catch (e) {
      this.cleanup();
      this.set("error", e instanceof Error ? e.message : "Realtime failed");
    }
  }

  send(event: unknown) {
    if (this.dc?.readyState === "open") this.dc.send(JSON.stringify(event));
  }

  stop(reason?: string) {
    this.gen++;
    this.cleanup();
    this.set("idle", reason);
  }

  private cleanup() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.dc?.close();
    this.pc?.close();
    this.mic?.getTracks().forEach((t) => t.stop());
    if (this.audioEl) { this.audioEl.pause(); this.audioEl.srcObject = null; }
    this.dc = this.pc = this.mic = this.audioEl = null;
  }
}
