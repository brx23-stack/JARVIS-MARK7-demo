import {
  FilesetResolver,
  HandLandmarker,
  type NormalizedLandmark,
} from "@mediapipe/tasks-vision";

const WASM_CDN =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

// Landmark indices (MediaPipe hand model)
const WRIST = 0;
const THUMB_TIP = 4;
const INDEX_TIP = 8;
const MIDDLE_MCP = 9;

// Pinch hysteresis: thumb–index distance relative to hand size
const PINCH_ON = 0.32;
const PINCH_OFF = 0.45;

// How strongly hand movement rotates the orb (radians per normalized unit)
const ROTATE_SPEED = 5.0;

// How close (normalized image units) a hand's new position must be to a
// hand from the previous frame to count as the same hand.
const HAND_MATCH_RADIUS = 0.3;

export type GestureMode = "idle" | "spin" | "zoom";
export type TrackingQuality = "high" | "medium" | "low";

export interface TrackerStatus {
  hands: number;
  mode: GestureMode;
}

export interface HandGesturePoint {
  x: number;
  y: number;
  pinching: boolean;
}

export interface HandGestureEventDetail {
  mode: GestureMode;
  points: HandGesturePoint[];
  timestamp: number;
}

export interface HandTrackerCallbacks {
  /** Called when a single pinched hand drags: deltas in mirrored normalized coords. */
  onRotate(deltaTheta: number, deltaPhi: number): void;
  /** Called when both hands pinch and spread/close: multiply camera distance by factor. */
  onZoom(factor: number): void;
  onStatus(status: TrackerStatus): void;
}

interface Point {
  x: number;
  y: number;
}

interface HandState {
  pinching: boolean;
  grab: Point; // smoothed pinch midpoint, mirrored
}

export class HandTracker {
  private video: HTMLVideoElement;
  private overlay: HTMLCanvasElement;
  private callbacks: HandTrackerCallbacks;
  private landmarker: HandLandmarker | null = null;
  private stream: MediaStream | null = null;
  private rafId = 0;
  private running = false;
  private lastVideoTime = -1;
  private lastDetectionAt = 0;
  private trackingQuality: TrackingQuality = "high";

  // Tracked by array position, matched frame-to-frame by proximity to the
  // previous frame's grab point — not by MediaPipe's Left/Right label. That
  // label carries its own per-frame confidence score which the code used to
  // discard; whichever hand isn't front-and-center (very often the second
  // hand in a two-hand gesture) gets classified ambiguously and can flip
  // Left/Right between frames. Keying state off that label meant every flip
  // looked like "the old hand left, a new one appeared", wiping its smoothed
  // position and pinch hysteresis and producing visible jitter. Matching by
  // where the hand actually was last frame is stable regardless of what
  // MediaPipe calls it.
  private handStates: HandState[] = [];
  private prevMode: GestureMode = "idle";
  private prevSpinGrab: Point | null = null;
  private prevZoomDist: number | null = null;
  private lastStatus: TrackerStatus = { hands: 0, mode: "idle" };
  private themeColor = "#00d9ff";

  constructor(
    video: HTMLVideoElement,
    overlay: HTMLCanvasElement,
    callbacks: HandTrackerCallbacks,
  ) {
    this.video = video;
    this.overlay = overlay;
    this.callbacks = callbacks;
  }

  /**
   * Starts the single camera stream that both the video preview and hand
   * tracking share. `mode` only adjusts the requested constraints:
   *  - "mobile" (default): unchanged from before — a front-facing camera at
   *    640x480, matching existing Android/mobile behavior exactly.
   *  - "desktop": no `facingMode` (meaningless on a PC webcam and would
   *    otherwise needlessly filter out external/virtual cameras — including
   *    an Android phone used as a webcam), and a higher ideal resolution
   *    since desktop hardware/webcams typically handle it fine. Leaving the
   *    device unpinned also lets the browser's own camera-selection UI
   *    offer a choice when more than one camera is available.
   */
  async start(mode: "mobile" | "desktop" = "mobile"): Promise<void> {
    if (this.running || this.stream) return;
    const videoConstraints: MediaTrackConstraints =
      mode === "desktop"
        ? { width: { ideal: 1280 }, height: { ideal: 720 } }
        : { width: 640, height: 480, facingMode: "user" };

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: videoConstraints,
        audio: false,
      });
      this.video.srcObject = this.stream;
      await this.video.play();

      const fileset = await FilesetResolver.forVisionTasks(WASM_CDN);
      const options = {
        baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" as const },
        runningMode: "VIDEO" as const,
        numHands: 2,
        minHandDetectionConfidence: 0.6,
        minHandPresenceConfidence: 0.6,
        minTrackingConfidence: 0.6,
      };
      try {
        this.landmarker = await HandLandmarker.createFromOptions(fileset, options);
      } catch {
        // Some browsers/GPUs reject the GPU delegate — fall back to CPU
        this.landmarker = await HandLandmarker.createFromOptions(fileset, {
          ...options,
          baseOptions: { ...options.baseOptions, delegate: "CPU" as const },
        });
      }

      this.running = true;
      this.lastVideoTime = -1;
      this.lastDetectionAt = 0;
      this.loop();
    } catch (err) {
      // If getUserMedia or landmarker init fails partway through, don't
      // leave the camera stream running with nothing consuming it.
      this.landmarker?.close();
      this.landmarker = null;
      this.cleanupStream();
      throw err;
    }
  }

  setThemeColor(color: string): void {
    this.themeColor = color;
  }

  setTrackingQuality(quality: TrackingQuality): void {
    this.trackingQuality = quality;
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
    this.landmarker?.close();
    this.landmarker = null;
    this.cleanupStream();
    this.handStates = [];
    this.prevMode = "idle";
    this.prevSpinGrab = null;
    this.prevZoomDist = null;
    this.lastVideoTime = -1;
    const ctx = this.overlay.getContext("2d");
    ctx?.clearRect(0, 0, this.overlay.width, this.overlay.height);
    this.emitStatus({ hands: 0, mode: "idle" });
  }

  private cleanupStream(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
  }

  // Hand tracking targets a high-refresh ~60 FPS cadence in every Performance
  // Mode. Graphics quality may still be reduced independently, but gesture
  // detection is kept responsive for smooth pinch/drag/zoom and Molecule Lab
  // manipulation. The actual rate remains bounded by camera frames and the
  // device/MediaPipe inference speed, so weaker devices can naturally run below
  // 60 FPS without blocking the rest of JARVIS.
  private intervalMs(): number {
    return 16;
  }

  private loop = () => {
    if (!this.running) return;
    this.rafId = requestAnimationFrame(this.loop);

    if (!this.landmarker || this.video.readyState < 2) return;
    if (this.video.currentTime === this.lastVideoTime) return;
    const now = performance.now();
    if (now - this.lastDetectionAt < this.intervalMs()) return;
    this.lastDetectionAt = now;
    this.lastVideoTime = this.video.currentTime;

    try {
      const result = this.landmarker.detectForVideo(this.video, now);
      this.processHands(result.landmarks);
      this.drawOverlay(result.landmarks);
    } catch {
      // A transient MediaPipe/WebGL failure must not terminate the app loop.
    }
  };

  private processHands(landmarks: NormalizedLandmark[][]): void {
    const pinchedGrabs: Point[] = [];
    const matched = new Set<HandState>();
    // Built alongside pinchedGrabs below, from each hand's own tracked
    // (smoothed) grab point and hysteresis state - see the dispatch below
    // for why this replaces a separate post-hoc lookup.
    const handPoints: HandGesturePoint[] = [];

    landmarks.forEach((lm) => {
      const handScale = dist2d(lm[WRIST], lm[MIDDLE_MCP]);
      if (handScale < 1e-6) return;
      const pinchRatio = dist2d(lm[THUMB_TIP], lm[INDEX_TIP]) / handScale;

      // Mirrored so hand-right = screen-right from the user's perspective
      const raw: Point = {
        x: 1 - (lm[THUMB_TIP].x + lm[INDEX_TIP].x) / 2,
        y: (lm[THUMB_TIP].y + lm[INDEX_TIP].y) / 2,
      };

      // Find the closest not-yet-claimed state from last frame. This is
      // what keeps a hand's identity stable even when MediaPipe's Left/
      // Right label for it flickers.
      let state: HandState | null = null;
      let bestDist = HAND_MATCH_RADIUS;
      for (const candidate of this.handStates) {
        if (matched.has(candidate)) continue;
        const d = Math.hypot(candidate.grab.x - raw.x, candidate.grab.y - raw.y);
        if (d < bestDist) {
          bestDist = d;
          state = candidate;
        }
      }
      if (!state) {
        state = { pinching: false, grab: raw };
        this.handStates.push(state);
      }
      matched.add(state);

      // Hysteresis so the pinch doesn't flicker on/off at the threshold
      if (state.pinching && pinchRatio > PINCH_OFF) state.pinching = false;
      else if (!state.pinching && pinchRatio < PINCH_ON) state.pinching = true;

      // Lower tracking quality also means a lower detection rate, so use a
      // slightly stronger smoothing pull per sample to keep motion looking
      // continuous rather than jumpy between the sparser updates.
      const alpha =
        this.trackingQuality === "high" ? 0.4 : this.trackingQuality === "medium" ? 0.34 : 0.28;
      state.grab = {
        x: state.grab.x + (raw.x - state.grab.x) * alpha,
        y: state.grab.y + (raw.y - state.grab.y) * alpha,
      };

      if (state.pinching) pinchedGrabs.push(state.grab);
      handPoints.push({ x: state.grab.x, y: state.grab.y, pinching: state.pinching });
    });

    // Drop state for hands that left the frame
    this.handStates = this.handStates.filter((state) => matched.has(state));

    const mode: GestureMode =
      pinchedGrabs.length >= 2 ? "zoom" : pinchedGrabs.length === 1 ? "spin" : "idle";

    // Reset reference points on any mode change to avoid jumps
    if (mode !== this.prevMode) {
      this.prevSpinGrab = null;
      this.prevZoomDist = null;
      this.prevMode = mode;
    }

    if (mode === "spin") {
      const grab = pinchedGrabs[0];
      if (this.prevSpinGrab) {
        const dx = grab.x - this.prevSpinGrab.x;
        const dy = grab.y - this.prevSpinGrab.y;
        if (Math.abs(dx) > 1e-4 || Math.abs(dy) > 1e-4) {
          this.callbacks.onRotate(dx * ROTATE_SPEED, dy * ROTATE_SPEED);
        }
      }
      this.prevSpinGrab = grab;
    } else if (mode === "zoom") {
      const d = Math.hypot(
        pinchedGrabs[0].x - pinchedGrabs[1].x,
        pinchedGrabs[0].y - pinchedGrabs[1].y,
      );
      if (this.prevZoomDist && d > 1e-4) {
        // Spread hands apart -> factor < 1 -> camera moves closer
        const factor = Math.min(1.18, Math.max(0.85, this.prevZoomDist / d));
        this.callbacks.onZoom(factor);
      }
      this.prevZoomDist = d;
    }

    if (landmarks.length === 0) {
      this.prevSpinGrab = null;
      this.prevZoomDist = null;
      this.prevMode = "idle";
    }

    this.emitStatus({ hands: landmarks.length, mode });

    // Broadcast the already-running hand tracker so interactive modules such
    // as the Molecule Lab can reuse the existing camera/tracking session
    // instead of opening a second camera stream. This is intentionally a
    // browser-local event and carries no camera frames or private data.
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent<HandGestureEventDetail>("jarvis-hand-gesture", {
        detail: {
          mode,
          points: handPoints,
          timestamp: performance.now(),
        },
      }));
    }
  }

  private emitStatus(status: TrackerStatus): void {
    if (
      status.hands !== this.lastStatus.hands ||
      status.mode !== this.lastStatus.mode
    ) {
      this.lastStatus = status;
      this.callbacks.onStatus(status);
    }
  }

  private drawOverlay(landmarks: NormalizedLandmark[][]): void {
    const ctx = this.overlay.getContext("2d");
    if (!ctx) return;
    const { width, height } = this.overlay;
    ctx.clearRect(0, 0, width, height);

    for (const lm of landmarks) {
      const thumb = lm[THUMB_TIP];
      const index = lm[INDEX_TIP];
      // Overlay canvas sits on the mirrored video preview, so mirror x here too
      const tx = (1 - thumb.x) * width;
      const ty = thumb.y * height;
      const ix = (1 - index.x) * width;
      const iy = index.y * height;

      const handScale = dist2d(lm[WRIST], lm[MIDDLE_MCP]);
      const pinched =
        handScale > 1e-6 && dist2d(thumb, index) / handScale < PINCH_ON;

      ctx.strokeStyle = pinched ? this.themeColor : `${this.themeColor}80`;
      ctx.lineWidth = pinched ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(ix, iy);
      ctx.stroke();

      ctx.fillStyle = pinched ? this.themeColor : `${this.themeColor}b3`;
      for (const [x, y] of [
        [tx, ty],
        [ix, iy],
      ]) {
        ctx.beginPath();
        ctx.arc(x, y, pinched ? 5 : 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}

function dist2d(a: NormalizedLandmark, b: NormalizedLandmark): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
