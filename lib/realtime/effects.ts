// Robotic / damaged-hardware voice chain (Web Audio). Original design:
// remote stream -> highpass -> pitch shifter (AudioWorklet) -> [dry | 3 comb resonators | ring mod]
// -> drive -> waveshaper -> band-limit -> compressor -> master -> analyser -> speakers.

const PITCH_WORKLET = `
class JarvisPitch extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [{ name: "ratio", defaultValue: 0.85, minValue: 0.25, maxValue: 2, automationRate: "k-rate" }];
  }
  constructor() {
    super();
    this.W = Math.floor(sampleRate * 0.06);
    this.N = this.W * 2 + 8;
    this.buf = new Float32Array(this.N);
    this.w = 0;
    this.ph = 0;
  }
  rd(delay) {
    let p = this.w - delay;
    while (p < 0) p += this.N;
    const i = Math.floor(p), f = p - i;
    const a = this.buf[i % this.N], b = this.buf[(i + 1) % this.N];
    return a + (b - a) * f;
  }
  process(inputs, outputs, params) {
    const inp = inputs[0] && inputs[0][0];
    const out = outputs[0];
    if (!out || !out[0]) return true;
    const r = params.ratio[0];
    const o = out[0];
    for (let n = 0; n < o.length; n++) {
      this.buf[this.w] = inp ? inp[n] : 0;
      const p1 = this.ph, p2 = (this.ph + 0.5) % 1;
      const g1 = Math.sin(Math.PI * p1) ** 2, g2 = Math.sin(Math.PI * p2) ** 2;
      o[n] = this.rd(p1 * this.W + 1) * g1 + this.rd(p2 * this.W + 1) * g2;
      this.w = (this.w + 1) % this.N;
      this.ph += (1 - r) / this.W;
      if (this.ph >= 1) this.ph -= 1;
      if (this.ph < 0) this.ph += 1;
    }
    for (let c = 1; c < out.length; c++) out[c].set(o);
    return true;
  }
}
registerProcessor("jarvis-pitch", JarvisPitch);
`;

export type DamageControls = {
  ctx: AudioContext;
  master: GainNode;
  drive: GainNode;
  ringFreq: AudioParam;
  pitch: AudioParam | null;
  base: { pitch: number; ring: number; drive: number; master: number };
};

export class RobotVoiceChain {
  readonly ctx: AudioContext;
  private analyser: AnalyserNode;
  private buf: Float32Array;
  private smooth = 0;
  private src: MediaStreamAudioSourceNode | null = null;
  private muteEl: HTMLAudioElement | null = null;
  private nodes: AudioNode[] = [];
  private osc: OscillatorNode;
  controls!: DamageControls;

  private constructor(ctx: AudioContext) {
    this.ctx = ctx;
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 512;
    this.buf = new Float32Array(512);
    this.osc = ctx.createOscillator();
  }

  /** Call from a user gesture (button click) so the context may start. */
  static async create(): Promise<RobotVoiceChain> {
    const ctx = new AudioContext({ latencyHint: "interactive" });
    void ctx.resume();
    const chain = new RobotVoiceChain(ctx);
    await chain.build();
    return chain;
  }

  private async build() {
    const { ctx } = this;
    const track = <T extends AudioNode>(n: T): T => { this.nodes.push(n); return n; };

    // pitch shifter (falls back to bypass where worklets are unavailable, e.g. non-secure origin)
    let pitchNode: AudioWorkletNode | null = null;
    try {
      const url = URL.createObjectURL(new Blob([PITCH_WORKLET], { type: "application/javascript" }));
      await ctx.audioWorklet.addModule(url);
      URL.revokeObjectURL(url);
      pitchNode = track(new AudioWorkletNode(ctx, "jarvis-pitch", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] }));
    } catch { pitchNode = null; }

    const input = track(ctx.createGain());
    const hp = track(ctx.createBiquadFilter()); hp.type = "highpass"; hp.frequency.value = 90;
    input.connect(hp);
    const afterPitch = track(ctx.createGain());
    if (pitchNode) { hp.connect(pitchNode); pitchNode.connect(afterPitch); } else hp.connect(afterPitch);

    const sum = track(ctx.createGain());

    // dry
    const dry = track(ctx.createGain()); dry.gain.value = 0.55;
    afterPitch.connect(dry).connect(sum);

    // 3 parallel comb resonators (metallic body)
    for (const ms of [3.0, 5.1, 7.3]) {
      const d = track(ctx.createDelay(0.05)); d.delayTime.value = ms / 1000;
      const fb = track(ctx.createGain()); fb.gain.value = 0.62;
      const out = track(ctx.createGain()); out.gain.value = 0.22;
      afterPitch.connect(d); d.connect(fb); fb.connect(d); d.connect(out); out.connect(sum);
    }

    // ring modulator: osc drives the gain AudioParam of a gain node whose base gain is 0
    const ring = track(ctx.createGain()); ring.gain.value = 0;
    this.osc.type = "sine"; this.osc.frequency.value = 55; this.osc.connect(ring.gain); this.osc.start();
    const ringWet = track(ctx.createGain()); ringWet.gain.value = 0.5;
    afterPitch.connect(ring).connect(ringWet).connect(sum);

    // distortion
    const drive = track(ctx.createGain()); drive.gain.value = 1.6;
    const shaper = track(ctx.createWaveShaper());
    const curve = new Float32Array(2048);
    for (let i = 0; i < curve.length; i++) { const x = (i / (curve.length - 1)) * 2 - 1; curve[i] = Math.tanh(x * 3); }
    shaper.curve = curve as any; shaper.oversample = "4x";
    sum.connect(drive).connect(shaper);

    // band-limit like a cheap speaker, level-match, limit
    const hp2 = track(ctx.createBiquadFilter()); hp2.type = "highpass"; hp2.frequency.value = 180;
    const lp = track(ctx.createBiquadFilter()); lp.type = "lowpass"; lp.frequency.value = 5200;
    const comp = track(ctx.createDynamicsCompressor());
    const master = track(ctx.createGain()); master.gain.value = 0.9;
    shaper.connect(hp2).connect(lp).connect(comp).connect(master).connect(this.analyser).connect(ctx.destination);

    (this as any)._input = input;
    this.controls = {
      ctx, master, drive,
      ringFreq: this.osc.frequency,
      pitch: pitchNode ? pitchNode.parameters.get("ratio") ?? null : null,
      base: { pitch: 0.86, ring: 55, drive: 1.6, master: 0.9 },
    };
    this.controls.pitch?.setValueAtTime(this.controls.base.pitch, ctx.currentTime);
  }

  /** Feed the Realtime remote stream in. */
  connectStream(stream: MediaStream) {
    // Chrome only delivers WebRTC audio to Web Audio if the stream is also attached to a media element.
    const el = (this.muteEl = new Audio());
    el.muted = true; el.srcObject = stream; void el.play().catch(() => {});
    this.src = this.ctx.createMediaStreamSource(stream);
    this.src.connect((this as any)._input as AudioNode);
  }

  /** Processed-output loudness 0..1 (what the orb reacts to). */
  level(): number {
    this.analyser.getFloatTimeDomainData(this.buf as any);
    let s = 0;
    for (let i = 0; i < this.buf.length; i++) s += this.buf[i] * this.buf[i];
    const rms = Math.sqrt(s / this.buf.length);
    const v = Math.min(1, rms * 4);
    this.smooth += (v - this.smooth) * (v > this.smooth ? 0.5 : 0.15);
    return this.smooth;
  }

  dispose() {
    try { this.src?.disconnect(); } catch {}
    try { this.osc.stop(); } catch {}
    if (this.muteEl) { this.muteEl.pause(); this.muteEl.srcObject = null; }
    this.nodes.forEach((n) => { try { n.disconnect(); } catch {} });
    void this.ctx.close().catch(() => {});
  }
}
