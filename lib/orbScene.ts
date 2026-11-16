import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { ELEMENTS, ELEMENT_BY_SYMBOL, type ElementData } from "./laboratory/elements";
import {
  valenceLimit,
  formulaOf,
  inferBonds,
  findTemplate,
  findElement,
  normalizeVoice,
  type LabAtom,
  type Bond,
  type MoleculeTemplate,
} from "./molecule/chemistry";

export type OrbTheme = "blue" | "amber" | "green" | "purple" | "red";
export type VoiceState = "idle" | "listening" | "thinking" | "speaking";
export type PerformanceMode = "auto" | "high" | "medium" | "low";

export interface OrbSceneApi {
  /** Rotate the camera around the orb by the given angles (radians). */
  rotateBy(deltaTheta: number, deltaPhi: number): void;
  /** Multiply the camera distance by `factor` (<1 zooms in, >1 zooms out). */
  zoomBy(factor: number): void;
  zoomIn(): void;
  zoomOut(): void;
  resetView(): void;
  setVoiceState(state: VoiceState): void;
  setTheme(theme: OrbTheme): void;
  setCustomColor(hex: string): void;
  setPerformanceMode(mode: PerformanceMode): void;
  getPerformanceInfo(): { fps: number; renderQuality: string; webgl: boolean };
  dispose(): void;

  // ——— molecule / atom mode ———
  /** Smoothly morphs the existing orb into the atom/molecule visualization, in-place. */
  enterMoleculeMode(): void;
  /** Smoothly morphs the visualization back into the normal orb. */
  exitMoleculeMode(): void;
  isMoleculeModeActive(): boolean;
  /** Parses one voice command for molecule mode; returns false if it wasn't a molecule command. */
  moleculeCommand(rawText: string, respond: (text: string) => void): boolean;
  /** Routes a `jarvis-hand-gesture` event into atom select/grab/move/add/remove. */
  handleMoleculeGesture(
    detail: { mode: "idle" | "spin" | "zoom"; points: Array<{ x: number; y: number; pinching: boolean }> },
    onMessage?: (text: string) => void,
  ): void;
  getMoleculeReadout(): {
    active: boolean;
    displayMode: "atom" | "molecule";
    formula: string;
    atomCount: number;
    bondCount: number;
    selectedElement: string;
    message: string;
  };
}

const HOME_POSITION = new THREE.Vector3(0, 0.5, 5.5);
const MIN_DISTANCE = 0.6;
const MAX_DISTANCE = 40;

export interface OrbSceneOptions {
  /** Desktop PCs get a higher device-pixel-ratio cap for a sharper orb;
   * mobile keeps its original cap unchanged for performance/battery. */
  desktopMode?: boolean;
}

export function createOrbScene(
  container: HTMLElement,
  options: OrbSceneOptions = {},
): OrbSceneApi {
  const width = container.clientWidth;
  const height = container.clientHeight;
  const pixelRatioCap = options.desktopMode ? 3 : 2;

  // ——— SCENE ———
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, width / height, 0.1, 500);
  camera.position.copy(HOME_POSITION);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(width, height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, pixelRatioCap));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.8;
  container.appendChild(renderer.domElement);
  let performanceMode: PerformanceMode = "auto";
  let renderQuality = "HIGH";
  let currentPixelRatioCap = pixelRatioCap;
  let lastFps = 60;
  let fpsFrames = 0;
  let fpsWindowStart = performance.now();
  // Auto-quality controller: use hysteresis so mobile/low-power devices do not
  // bounce between quality levels when FPS briefly fluctuates.
  let autoQualityCooldown = 0;
  let autoQualityStableSince = performance.now();
  let autoQualityLastDecision = "HIGH";

  // ——— POST PROCESSING ———
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));

  const bloom = new UnrealBloomPass(
    new THREE.Vector2(width, height),
    1.8, // strength
    0.4, // radius
    0.2, // threshold
  );
  composer.addPass(bloom);

  // Chromatic aberration + color grade shader
  const chromaticShader = {
    uniforms: {
      tDiffuse: { value: null },
      uTime: { value: 0 },
      uIntensity: { value: 0.003 },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D tDiffuse;
      uniform float uTime;
      uniform float uIntensity;
      varying vec2 vUv;
      void main() {
        vec2 dir = vUv - vec2(0.5);
        float d = length(dir);
        float offset = uIntensity * d;
        // Slight flicker
        float flicker = 1.0 + 0.02 * sin(uTime * 30.0) * sin(uTime * 7.3);
        vec4 cr = texture2D(tDiffuse, vUv + dir * offset);
        vec4 cg = texture2D(tDiffuse, vUv);
        vec4 cb = texture2D(tDiffuse, vUv - dir * offset * 0.5);
        gl_FragColor = vec4(cr.r, cg.g * 1.05, cb.b * 0.6, 1.0) * flicker;
        // Neutral color grade: theme colors are supplied by the Three.js materials.
        gl_FragColor.rgb *= vec3(1.0, 1.0, 1.0);
      }
    `,
  };
  const chromaticPass = new ShaderPass(chromaticShader);
  composer.addPass(chromaticPass);

  // Controls
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.04;
  controls.minDistance = MIN_DISTANCE;
  controls.maxDistance = MAX_DISTANCE;
  controls.zoomSpeed = 1.4;
  controls.enablePan = false;

  // ——— CENTRALIZED THEME PALETTE ———
  const THEMES: Record<OrbTheme, { bright: number; mid: number; dim: number; faint: number; hot: number }> = {
    blue:   { bright: 0x00d9ff, mid: 0x0088ff, dim: 0x0055aa, faint: 0x003355, hot: 0x9fffff },
    amber:  { bright: 0xffaa30, mid: 0xdd7700, dim: 0x884400, faint: 0x553300, hot: 0xffcc66 },
    green:  { bright: 0x39ff88, mid: 0x00c96b, dim: 0x087a4b, faint: 0x06452f, hot: 0xa8ffd2 },
    purple: { bright: 0xc56bff, mid: 0x8d35ff, dim: 0x5b1e9e, faint: 0x34105f, hot: 0xe5b8ff },
    red:    { bright: 0xff4f6d, mid: 0xff1648, dim: 0x9e102f, faint: 0x52091b, hot: 0xffb3c0 },
  };
  let activeTheme: OrbTheme = "amber";
  let C_BRIGHT = THEMES.amber.bright;
  let C_MID = THEMES.amber.mid;
  let C_DIM = THEMES.amber.dim;
  let C_FAINT = THEMES.amber.faint;
  let C_HOT = THEMES.amber.hot;

  const VOICE_ENERGY: Record<VoiceState, number> = {
    idle: 0,
    listening: 0.35,
    thinking: 0.75,
    speaking: 1,
  };

  // ——— ORB ROOT ———
  // Every part of the orb (shells, core, orbiting debris, text, dust, rings)
  // lives under this group.
  const orbGroup = new THREE.Group();
  scene.add(orbGroup);

  // All of the orb's "idle" visuals (shells, panels, core, debris, dust,
  // scan rings, drifting text) live under this sub-group so molecule mode
  // can fade/scale the whole orb out as one unit instead of touching each
  // layer's material individually. The atom/molecule visualization lives
  // in the sibling `moleculeGroup` below — same scene, camera, renderer,
  // and animation loop as the orb, just swapped in and out.
  const orbVisuals = new THREE.Group();
  orbGroup.add(orbVisuals);

  // ——— MATERIAL HELPERS ———
  function lineMat(color: number, opacity = 1) {
    return new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
  }

  function roleForColor(color: number): keyof typeof THEMES["blue"] | null {
    if (color === 0x00d9ff || color === 0xffaa30 || color === 0x39ff88 || color === 0xc56bff || color === 0xff4f6d) return "bright";
    if (color === 0x0088ff || color === 0xdd7700 || color === 0x00c96b || color === 0x8d35ff || color === 0xff1648 || color === 0xc8e4ff) return "mid";
    if (color === 0x0055aa || color === 0x884400 || color === 0x087a4b || color === 0x5b1e9e || color === 0x9e102f || color === 0x7896b0) return "dim";
    if (color === 0x003355 || color === 0x553300 || color === 0x06452f || color === 0x34105f || color === 0x52091b || color === 0x3b4d5e) return "faint";
    if (color === 0x9fffff || color === 0xffcc66 || color === 0xa8ffd2 || color === 0xe5b8ff || color === 0xffb3c0) return "hot";
    return null;
  }

  function applyTheme(theme: OrbTheme) {
    activeTheme = theme;
    const palette = THEMES[theme];
    C_BRIGHT = palette.bright;
    C_MID = palette.mid;
    C_DIM = palette.dim;
    C_FAINT = palette.faint;
    C_HOT = palette.hot;

    scene.traverse((obj) => {
      const material = (obj as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      const materials = Array.isArray(material) ? material : material ? [material] : [];
      for (const mat of materials) {
        const color = (mat as THREE.Material & { color?: THREE.Color }).color;
        if (!color) continue;
        const role = (mat.userData.themeRole as keyof typeof palette | undefined) ?? roleForColor(color.getHex());
        if (role) {
          mat.userData.themeRole = role;
          color.setHex(palette[role]);
          mat.needsUpdate = true;
        }
      }
    });
  }

  // ——— UTILITY: Create ring at latitude ———
  function latRing(radius: number, lat: number, segs = 120) {
    const r = radius * Math.cos(lat);
    const y = radius * Math.sin(lat);
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      pts.push(new THREE.Vector3(r * Math.cos(a), y, r * Math.sin(a)));
    }
    return new THREE.BufferGeometry().setFromPoints(pts);
  }

  // ——— UTILITY: Create meridian ———
  function meridian(radius: number, lon: number, segs = 120) {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= segs; i++) {
      const lat = (i / segs) * Math.PI - Math.PI / 2;
      pts.push(
        new THREE.Vector3(
          radius * Math.cos(lat) * Math.cos(lon),
          radius * Math.sin(lat),
          radius * Math.cos(lat) * Math.sin(lon),
        ),
      );
    }
    return new THREE.BufferGeometry().setFromPoints(pts);
  }

  // ═══════════════════════════════════════════════
  // LAYER 1: OUTER SHELL — dense wireframe grid
  // ═══════════════════════════════════════════════
  const outerShell = new THREE.Group();
  const R1 = 2.0;

  // Dense latitude rings (30+)
  for (let i = -15; i <= 15; i++) {
    const lat = (i / 15) * (Math.PI / 2) * 0.95;
    const opacity = i % 3 === 0 ? 0.5 : 0.12;
    const color = i % 3 === 0 ? C_MID : C_FAINT;
    outerShell.add(new THREE.Line(latRing(R1, lat), lineMat(color, opacity)));
  }

  // Dense meridians (24)
  for (let i = 0; i < 24; i++) {
    const lon = (i / 24) * Math.PI * 2;
    const isMajor = i % 6 === 0;
    outerShell.add(
      new THREE.Line(
        meridian(R1, lon),
        lineMat(isMajor ? C_MID : C_FAINT, isMajor ? 0.6 : 0.1),
      ),
    );
  }

  // 4 bright cross meridians (the "plus" shape) — wide bands
  const CROSS_LINES = 18;
  const CROSS_SPREAD = 0.25; // radians total width
  for (let i = 0; i < 4; i++) {
    const lon = (i / 4) * Math.PI * 2;
    for (let j = 0; j < CROSS_LINES; j++) {
      const t = (j / (CROSS_LINES - 1)) * 2 - 1; // -1 to 1
      const offset = (t * CROSS_SPREAD) / 2;
      const falloff = 1 - Math.abs(t) * 0.7; // brighter at center, dimmer at edges
      const opacity = 0.85 * falloff;
      const color = Math.abs(t) < 0.3 ? C_BRIGHT : C_MID;
      outerShell.add(
        new THREE.Line(meridian(R1, lon + offset, 200), lineMat(color, opacity)),
      );
    }
  }

  // Bright equator band — wide
  const EQ_LINES = 20;
  const EQ_SPREAD = 0.35;
  for (let j = 0; j < EQ_LINES; j++) {
    const t = (j / (EQ_LINES - 1)) * 2 - 1;
    const offset = (t * EQ_SPREAD) / 2;
    const falloff = 1 - Math.abs(t) * 0.65;
    const opacity = 0.8 * falloff;
    const color = Math.abs(t) < 0.3 ? C_BRIGHT : C_MID;
    outerShell.add(
      new THREE.Line(latRing(R1, offset, 200), lineMat(color, opacity)),
    );
  }

  orbVisuals.add(outerShell);

  // ═══════════════════════════════════════════════
  // LAYER 2: GRID PANELS on the sphere surface
  // ═══════════════════════════════════════════════
  const panelGroup = new THREE.Group();

  function createSpherePanel(
    latCenter: number,
    lonCenter: number,
    latSpan: number,
    lonSpan: number,
    radius: number,
    divisions = 4,
  ) {
    const group = new THREE.Group();
    const mat = lineMat(C_DIM, 0.25);

    // horizontal lines
    for (let i = 0; i <= divisions; i++) {
      const lat = latCenter - latSpan / 2 + (i / divisions) * latSpan;
      const pts: THREE.Vector3[] = [];
      for (let j = 0; j <= divisions * 4; j++) {
        const lon = lonCenter - lonSpan / 2 + (j / (divisions * 4)) * lonSpan;
        pts.push(
          new THREE.Vector3(
            radius * Math.cos(lat) * Math.cos(lon),
            radius * Math.sin(lat),
            radius * Math.cos(lat) * Math.sin(lon),
          ),
        );
      }
      group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat));
    }

    // vertical lines
    for (let j = 0; j <= divisions; j++) {
      const lon = lonCenter - lonSpan / 2 + (j / divisions) * lonSpan;
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= divisions * 4; i++) {
        const lat = latCenter - latSpan / 2 + (i / (divisions * 4)) * latSpan;
        pts.push(
          new THREE.Vector3(
            radius * Math.cos(lat) * Math.cos(lon),
            radius * Math.sin(lat),
            radius * Math.cos(lat) * Math.sin(lon),
          ),
        );
      }
      group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat));
    }

    return group;
  }

  // Scatter panels across the sphere
  for (let i = 0; i < 30; i++) {
    const lat = (Math.random() - 0.5) * Math.PI * 0.8;
    const lon = Math.random() * Math.PI * 2;
    const size = 0.15 + Math.random() * 0.25;
    const panel = createSpherePanel(
      lat,
      lon,
      size,
      size,
      R1 + 0.01,
      3 + Math.floor(Math.random() * 3),
    );
    panelGroup.add(panel);
  }
  orbVisuals.add(panelGroup);

  // ═══════════════════════════════════════════════
  // LAYER 3: SECONDARY SHELL — offset, partial arcs
  // ═══════════════════════════════════════════════
  const shell2 = new THREE.Group();
  const R2 = 2.12;

  // Partial arcs at random latitudes
  for (let i = 0; i < 16; i++) {
    const lat = (Math.random() - 0.5) * Math.PI * 0.85;
    const startLon = Math.random() * Math.PI * 2;
    const arcLen = 0.3 + Math.random() * 1.2;
    const pts: THREE.Vector3[] = [];
    const segs = 60;
    const r = R2 * Math.cos(lat);
    const y = R2 * Math.sin(lat);
    for (let j = 0; j <= segs; j++) {
      const a = startLon + (j / segs) * arcLen;
      pts.push(new THREE.Vector3(r * Math.cos(a), y, r * Math.sin(a)));
    }
    shell2.add(
      new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(pts),
        lineMat(C_MID, 0.2 + Math.random() * 0.3),
      ),
    );
  }

  // Partial meridian arcs
  for (let i = 0; i < 12; i++) {
    const lon = Math.random() * Math.PI * 2;
    const startLat = (Math.random() - 0.5) * Math.PI * 0.8;
    const arcLen = 0.3 + Math.random() * 0.8;
    const pts: THREE.Vector3[] = [];
    const segs = 40;
    for (let j = 0; j <= segs; j++) {
      const lat = startLat + (j / segs) * arcLen;
      pts.push(
        new THREE.Vector3(
          R2 * Math.cos(lat) * Math.cos(lon),
          R2 * Math.sin(lat),
          R2 * Math.cos(lat) * Math.sin(lon),
        ),
      );
    }
    shell2.add(
      new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(pts),
        lineMat(C_DIM, 0.15 + Math.random() * 0.2),
      ),
    );
  }
  orbVisuals.add(shell2);

  // ═══════════════════════════════════════════════
  // LAYER 4: INNER CORE — spiral geodesic
  // ═══════════════════════════════════════════════
  const innerCore = new THREE.Group();
  const R3 = 0.9;

  // Dense spirals
  for (let s = 0; s < 8; s++) {
    const pts: THREE.Vector3[] = [];
    const turns = 3 + Math.random() * 2;
    const segs = 300;
    const phase = (s / 8) * Math.PI * 2;
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const lat = t * Math.PI - Math.PI / 2;
      const lon = t * turns * Math.PI * 2 + phase;
      pts.push(
        new THREE.Vector3(
          R3 * Math.cos(lat) * Math.cos(lon),
          R3 * Math.sin(lat),
          R3 * Math.cos(lat) * Math.sin(lon),
        ),
      );
    }
    innerCore.add(
      new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(pts),
        lineMat(C_BRIGHT, 0.3 + Math.random() * 0.2),
      ),
    );
  }

  // Inner latitude rings
  for (let i = -6; i <= 6; i++) {
    const lat = (i / 6) * (Math.PI / 2) * 0.9;
    innerCore.add(new THREE.Line(latRing(R3, lat, 80), lineMat(C_DIM, 0.2)));
  }

  // Inner meridians
  for (let i = 0; i < 12; i++) {
    const lon = (i / 12) * Math.PI * 2;
    innerCore.add(new THREE.Line(meridian(R3, lon, 80), lineMat(C_DIM, 0.15)));
  }

  orbVisuals.add(innerCore);

  // ═══════════════════════════════════════════════
  // LAYER 5: INNERMOST CORE — bright hot center
  // ═══════════════════════════════════════════════
  const coreR = 0.25;

  // Icosahedron wireframe core
  const icoGeo = new THREE.IcosahedronGeometry(coreR, 1);
  const icoEdges = new THREE.EdgesGeometry(icoGeo);
  const icoWireMat = lineMat(C_HOT, 0.9);
  const icoWire = new THREE.LineSegments(icoEdges, icoWireMat);
  orbVisuals.add(icoWire);

  // Glowing center sphere — subtle, see-through
  const coreSphereMat = new THREE.MeshBasicMaterial({
    color: C_HOT,
    transparent: true,
    opacity: 0.15,
    blending: THREE.AdditiveBlending,
  });
  const coreSphere = new THREE.Mesh(new THREE.SphereGeometry(0.15, 16, 16), coreSphereMat);
  orbVisuals.add(coreSphere);

  // Larger faint glow — very subtle
  const glowSphereMat = new THREE.MeshBasicMaterial({
    color: C_MID,
    transparent: true,
    opacity: 0.04,
    blending: THREE.AdditiveBlending,
  });
  const glowSphere = new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 16), glowSphereMat);
  orbVisuals.add(glowSphere);

  // ═══════════════════════════════════════════════
  // CODE TEXT — tiny, dense, scattered
  // ═══════════════════════════════════════════════
  const codeSnippets = [
    "sys.init()", "0xFF3A", "malloc()", ">> SCAN", "void*", "ACK",
    "SYNC OK", "ptr_ref", "exec()", "hash256", "::bind", "core.0",
    "01101001", "10110100", ">>> RDY", "HEAP 4K", "TCP/SYN",
    "mutex.lk", "IRQ 0x7", "DMA xfer", "REG EAX", "FAULT 0",
    "kernel.d", "pipe |>", "chmod +x", "fork()", "SIGTERM",
    "eth0: UP", "AES-256", "RSA 4096", "TLS 1.3", "HTTP/2",
    "latency", "200 OK", "PATCH /", "fn main", "use std",
    "impl Orb", "async {}", "spawn()", "arc::new", ".unwrap",
  ];

  interface SpriteDrift {
    phi: number;
    theta: number;
    r: number;
    speed: number;
  }

  function makeTextSprite(text: string, size = 0.08) {
    const c = document.createElement("canvas");
    c.width = 256;
    c.height = 32;
    const ctx = c.getContext("2d")!;
    ctx.font = "bold 14px Courier New";
    const alpha = 0.35 + Math.random() * 0.55;
    // Bake the glyphs in plain white so the sprite's actual color comes
    // entirely from `material.color` below (which the theme system tints
    // per-role, same as every other themed part of the orb). Baking a
    // fixed amber/orange into the texture pixels here meant a same-hued
    // tint could only ever darken it, never shift it toward blue/green/
    // purple/red — so this text (a huge share of the orb's visible
    // surface) stayed amber-looking under every theme, and washed toward
    // white under bloom on bright pulses.
    ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, 128, 16);
    const tex = new THREE.CanvasTexture(c);
    tex.minFilter = THREE.LinearFilter;
    const s = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: tex,
        color: C_BRIGHT,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    s.scale.set(size * 5, size * 0.7, 1);
    return s;
  }

  function scatterText(count: number, sizeFn: () => number, rFn: () => number, speedScale: [number, number]) {
    const group = new THREE.Group();
    for (let i = 0; i < count; i++) {
      const sp = makeTextSprite(
        codeSnippets[Math.floor(Math.random() * codeSnippets.length)],
        sizeFn(),
      );
      const phi = Math.acos(2 * Math.random() - 1);
      const theta = Math.random() * Math.PI * 2;
      const r = rFn();
      sp.position.set(
        r * Math.sin(phi) * Math.cos(theta),
        r * Math.cos(phi),
        r * Math.sin(phi) * Math.sin(theta),
      );
      sp.userData = {
        phi,
        theta,
        r,
        speed:
          (speedScale[0] + Math.random() * speedScale[1]) *
          (Math.random() > 0.5 ? 1 : -1),
      } satisfies SpriteDrift;
      group.add(sp);
    }
    return group;
  }

  // On outer sphere — dense text coverage
  const textOuter = scatterText(
    1200,
    () => 0.04 + Math.random() * 0.04,
    () => R1 + 0.03 + Math.random() * 0.08,
    [0.0002, 0.0008],
  );
  orbVisuals.add(textOuter);

  // On inner core — more text
  const textInner = scatterText(
    100,
    () => 0.03 + Math.random() * 0.03,
    () => R3 + 0.02,
    [0.0005, 0.001],
  );
  orbVisuals.add(textInner);

  // Floating ambient text between shells
  const textAmbient = scatterText(
    400,
    () => 0.03,
    () => R3 + 0.2 + Math.random() * (R1 - R3 - 0.3),
    [0.0003, 0.0006],
  );
  orbVisuals.add(textAmbient);

  // ═══════════════════════════════════════════════
  // ORBITING DEBRIS / ROCKS
  // ═══════════════════════════════════════════════
  // Shared geometries for performance — reuse across 250 satellites
  const debrisGeos = [
    new THREE.IcosahedronGeometry(0.012, 0),
    new THREE.IcosahedronGeometry(0.02, 0),
    new THREE.IcosahedronGeometry(0.03, 1),
    new THREE.IcosahedronGeometry(0.008, 0),
    new THREE.TetrahedronGeometry(0.015, 0),
    new THREE.OctahedronGeometry(0.018, 0),
  ];
  interface DebrisOrbit {
    orbitR: number;
    speed: number;
    tiltX: number;
    tiltZ: number;
    phase: number;
  }
  const debris: THREE.Mesh[] = [];
  for (let i = 0; i < 250; i++) {
    const geo = debrisGeos[Math.floor(Math.random() * debrisGeos.length)];
    const mat = new THREE.MeshBasicMaterial({
      color: Math.random() > 0.7 ? C_BRIGHT : C_MID,
      transparent: true,
      opacity: 0.3 + Math.random() * 0.6,
      blending: THREE.AdditiveBlending,
    });
    const mesh = new THREE.Mesh(geo, mat);
    const orbitR = 1.2 + Math.random() * 4.0;
    const speed = (0.08 + Math.random() * 0.6) * (Math.random() > 0.5 ? 1 : -1);
    const tiltX = (Math.random() - 0.5) * Math.PI * 0.9;
    const tiltZ = (Math.random() - 0.5) * Math.PI * 0.5;
    const phase = Math.random() * Math.PI * 2;
    mesh.userData = { orbitR, speed, tiltX, tiltZ, phase } satisfies DebrisOrbit;
    debris.push(mesh);
    orbVisuals.add(mesh);

    // ~15% get a faint trailing line
    if (Math.random() > 0.85) {
      const trailPts: THREE.Vector3[] = [];
      for (let j = 0; j <= 15; j++) {
        const a = -(j / 15) * 0.3;
        trailPts.push(
          new THREE.Vector3(
            orbitR * Math.cos(a + phase),
            orbitR * 0.08 * Math.sin(a * 3),
            orbitR * Math.sin(a + phase),
          ),
        );
      }
      const trail = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(trailPts),
        lineMat(C_FAINT, 0.08),
      );
      mesh.add(trail);
    }
  }

  // ═══════════════════════════════════════════════
  // DUST PARTICLES — lots of them
  // ═══════════════════════════════════════════════
  const dustCount = 2000;
  const dustPos = new Float32Array(dustCount * 3);

  for (let i = 0; i < dustCount; i++) {
    // Concentrate near the sphere, sparse further out
    const rr = 0.5 + Math.pow(Math.random(), 0.6) * 7;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    dustPos[i * 3] = rr * Math.sin(phi) * Math.cos(theta);
    dustPos[i * 3 + 1] = rr * Math.cos(phi);
    dustPos[i * 3 + 2] = rr * Math.sin(phi) * Math.sin(theta);
  }

  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute("position", new THREE.Float32BufferAttribute(dustPos, 3));

  // Soft dot texture
  const dotC = document.createElement("canvas");
  dotC.width = dotC.height = 64;
  const dCtx = dotC.getContext("2d")!;
  const g = dCtx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255,170,48,1)");
  g.addColorStop(0.2, "rgba(255,120,20,0.6)");
  g.addColorStop(0.5, "rgba(200,80,0,0.15)");
  g.addColorStop(1, "rgba(100,40,0,0)");
  dCtx.fillStyle = g;
  dCtx.fillRect(0, 0, 64, 64);

  const dustMat = new THREE.PointsMaterial({
    map: new THREE.CanvasTexture(dotC),
    size: 0.04,
    transparent: true,
    opacity: 0.5,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    sizeAttenuation: true,
    color: C_BRIGHT,
  });
  const dustPoints = new THREE.Points(dustGeo, dustMat);
  orbVisuals.add(dustPoints);

  // ═══════════════════════════════════════════════
  // SCANNING RINGS
  // ═══════════════════════════════════════════════
  function makeScanRing(radius: number, thickness = 0.015) {
    const geo = new THREE.RingGeometry(radius - thickness, radius + thickness, 120);
    const mat = new THREE.MeshBasicMaterial({
      color: C_BRIGHT,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = Math.PI / 2;
    return mesh;
  }

  const scanRing1 = makeScanRing(R1, 0.01);
  const scanRing2 = makeScanRing(R1 * 0.7, 0.008);
  orbVisuals.add(scanRing1, scanRing2);

  // ═══════════════════════════════════════════════
  // HEXAGONAL NODES — small tech details
  // ═══════════════════════════════════════════════
  for (let i = 0; i < 15; i++) {
    const phi = Math.acos(2 * Math.random() - 1);
    const theta = Math.random() * Math.PI * 2;
    const r = R1 + 0.02;
    const hexGeo = new THREE.CircleGeometry(0.03 + Math.random() * 0.02, 6);
    const hexEdges = new THREE.EdgesGeometry(hexGeo);
    const hex = new THREE.LineSegments(hexEdges, lineMat(C_MID, 0.5));
    hex.position.set(
      r * Math.sin(phi) * Math.cos(theta),
      r * Math.cos(phi),
      r * Math.sin(phi) * Math.sin(theta),
    );
    hex.lookAt(0, 0, 0);
    outerShell.add(hex);
  }

  // ═══════════════════════════════════════════════
  // MOLECULE / ATOM MODE
  // ═══════════════════════════════════════════════
  // Lives in the same scene/camera/renderer/animation loop as the orb
  // (above). "Entering" molecule mode fades+scales `orbVisuals` out and
  // `moleculeGroup` in over MOLECULE_TRANSITION_MS; "exiting" reverses it.
  // Every material below carries `userData.themeRole` so the existing
  // applyTheme()/setCustomColor() traversal (which already walks the whole
  // `scene`) re-tints it automatically — no separate theming path.
  const moleculeGroup = new THREE.Group();
  moleculeGroup.visible = false;
  orbGroup.add(moleculeGroup);

  const MOLECULE_TRANSITION_MS = 700;
  type MoleculeUIMode = "orb" | "entering" | "molecule" | "exiting";
  let moleculeUIMode: MoleculeUIMode = "orb";
  let transitionStart = 0;
  let transitionFrom = 0;

  type DisplayMode = "atom" | "molecule";
  let displayMode: DisplayMode = "atom";
  let selectedElement: ElementData = ELEMENT_BY_SYMBOL.C;
  let atoms: LabAtom[] = [];
  let bonds: Bond[] = [];
  let selectedAtomId: string | null = null;
  let atomicDeltas = { electron: 0, proton: 0, neutron: 0 };
  let moleculeMessage = "";

  function emitMoleculeMessage(text: string) {
    moleculeMessage = text;
  }

  // ——— label sprite: baked white glyphs tinted via material.color, same
  // pattern as makeTextSprite() above, so theme changes retint it live.
  function moleculeLabelSprite(text: string, role: keyof typeof THEMES["blue"]) {
    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 96;
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, 320, 96);
    ctx.font = "bold 42px Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.shadowBlur = 12;
    ctx.shadowColor = "rgba(255,255,255,0.9)";
    ctx.fillStyle = "#ffffff";
    ctx.fillText(text, 160, 48);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.SpriteMaterial({
      map: tex,
      color: THEMES[activeTheme][role],
      transparent: true,
      depthWrite: false,
    });
    mat.userData.themeRole = role;
    const sp = new THREE.Sprite(mat);
    sp.scale.set(1.1, 0.33, 1);
    return sp;
  }

  function moleculeGlowSprite(role: keyof typeof THEMES["blue"], size = 2.2, opacity = 0.9) {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 128;
    const ctx = canvas.getContext("2d")!;
    const gradient = ctx.createRadialGradient(64, 64, 2, 64, 64, 62);
    gradient.addColorStop(0, "rgba(255,255,255,0.95)");
    gradient.addColorStop(0.14, "#ffffff");
    gradient.addColorStop(0.45, "#ffffff88");
    gradient.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.SpriteMaterial({
      map: tex,
      color: THEMES[activeTheme][role],
      transparent: true,
      opacity,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    mat.userData.themeRole = role;
    const sp = new THREE.Sprite(mat);
    sp.scale.set(size, size, 1);
    return sp;
  }

  function disposeObject3D(root: THREE.Object3D) {
    root.traverse((child: THREE.Object3D) => {
      const mesh = child as Partial<THREE.Mesh> & Partial<THREE.Sprite>;
      if (mesh.geometry) mesh.geometry.dispose();
      const material = mesh.material;
      if (!material) return;
      const materials = Array.isArray(material) ? material : [material];
      for (const mat of materials) {
        const texturedMat = mat as THREE.Material & {
          map?: THREE.Texture | null;
          alphaMap?: THREE.Texture | null;
          emissiveMap?: THREE.Texture | null;
        };
        texturedMat.map?.dispose();
        texturedMat.alphaMap?.dispose();
        texturedMat.emissiveMap?.dispose();
        mat.dispose();
      }
    });
  }

  // Per-frame animation hooks for the currently-built molecule/atom visual
  // (electron orbit spin, nucleus pulse, bond glow). Rebuilt every time the
  // visual is rebuilt; run from the main animate() loop below.
  let moleculeAnimators: Array<(t: number) => void> = [];

  function moleculeQualityCfg() {
    // Reuses the same HIGH/MEDIUM/LOW quality tier the orb itself is on
    // (`renderQuality`, kept in sync by setPerformanceMode) so molecule
    // mode never has its own separate performance system.
    const q = renderQuality;
    return {
      isLow: q === "LOW",
      isHigh: q === "HIGH",
      bloom: q !== "LOW",
      atomSegs: q === "LOW" ? 12 : q === "MEDIUM" ? 16 : 24,
      electronSegs: q === "LOW" ? 6 : q === "MEDIUM" ? 8 : 10,
      bondSegs: q === "LOW" ? 6 : 10,
      maxParticles: q === "LOW" ? 40 : q === "MEDIUM" ? 70 : 120,
    };
  }

  function clearMoleculeVisual() {
    disposeObject3D(moleculeGroup);
    while (moleculeGroup.children.length) moleculeGroup.remove(moleculeGroup.children[0]);
    moleculeAnimators = [];
  }

  // ——— ATOM MODEL: nucleus (protons/neutrons) + electron shells ———
  function buildAtomicModel(element: ElementData) {
    clearMoleculeVisual();
    const cfg = moleculeQualityCfg();
    const protons = Math.max(0, element.atomicNumber + atomicDeltas.proton);
    const neutrons = Math.max(0, Math.round(element.atomicMass) - element.atomicNumber + atomicDeltas.neutron);
    const nucleusRadius = 0.22 + Math.min(0.42, Math.sqrt(protons + neutrons) * 0.018);
    const cap = cfg.maxParticles;

    const protonMat = new THREE.MeshBasicMaterial({ color: THEMES[activeTheme].bright });
    protonMat.userData.themeRole = "bright";
    for (let i = 0; i < Math.min(protons, cap); i++) {
      const n = Math.max(1, Math.min(protons, cap) - 1);
      const a = i * Math.PI * (3 - Math.sqrt(5));
      const y = 1 - (i / n) * 2;
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.055, cfg.atomSegs, cfg.atomSegs - 2), protonMat);
      m.position.set(Math.cos(a) * r * nucleusRadius, y * nucleusRadius, Math.sin(a) * r * nucleusRadius);
      moleculeGroup.add(m);
    }
    // Neutrons stay a fixed neutral slate (not theme-tinted) so they read
    // as visually distinct from protons/electrons under every theme.
    const neutronMat = new THREE.MeshBasicMaterial({ color: 0x8aa2b8 });
    for (let i = 0; i < Math.min(neutrons, cap); i++) {
      const n = Math.max(1, Math.min(neutrons, cap) - 1);
      const a = i * Math.PI * (3 - Math.sqrt(5)) + 1.2;
      const y = 1 - (i / n) * 2;
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.055, cfg.atomSegs, cfg.atomSegs - 2), neutronMat);
      m.position.set(Math.cos(a) * r * nucleusRadius, y * nucleusRadius, Math.sin(a) * r * nucleusRadius);
      moleculeGroup.add(m);
    }
    if (cfg.bloom) {
      const glow = moleculeGlowSprite("hot", cfg.isHigh ? 2.9 : 2.35, cfg.isHigh ? 0.95 : 0.78);
      moleculeGroup.add(glow);
    }
    const nLabel = moleculeLabelSprite(`${element.symbol} · p${protons} n${neutrons}`, "bright");
    nLabel.scale.set(1.8, 0.38, 1);
    nLabel.position.y = nucleusRadius + 0.55;
    moleculeGroup.add(nLabel);

    const baseElectrons = element.electronConfiguration.split(",").map(Number);
    const shells = [...baseElectrons];
    let electronDelta = Math.trunc(atomicDeltas.electron);
    for (let i = shells.length - 1; i >= 0 && electronDelta < 0; i--) {
      const remove = Math.min(shells[i], -electronDelta);
      shells[i] -= remove;
      electronDelta += remove;
    }
    if (electronDelta > 0) shells.push(electronDelta);

    const electronMat = new THREE.MeshBasicMaterial({ color: THEMES[activeTheme].hot });
    electronMat.userData.themeRole = "hot";
    shells.forEach((count, si) => {
      const radius = 0.9 + si * 0.48;
      const ringMat = new THREE.MeshBasicMaterial({
        color: THEMES[activeTheme].mid,
        transparent: true,
        opacity: cfg.isHigh ? 0.5 : 0.38,
      });
      ringMat.userData.themeRole = "mid";
      const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.012, cfg.isLow ? 4 : 6, cfg.isLow ? 48 : 96), ringMat);
      ring.rotation.x = Math.PI / 2;
      moleculeGroup.add(ring);
      const electronMeshes: { mesh: THREE.Mesh; theta0: number }[] = [];
      for (let i = 0; i < count; i++) {
        const theta = (i / count) * Math.PI * 2 + si * 0.35;
        const e = new THREE.Mesh(new THREE.SphereGeometry(0.055, cfg.electronSegs, cfg.electronSegs - 2), electronMat);
        e.position.set(Math.cos(theta) * radius, 0, Math.sin(theta) * radius);
        moleculeGroup.add(e);
        electronMeshes.push({ mesh: e, theta0: theta });
        if (cfg.bloom && (cfg.isHigh || i < Math.min(count, 4))) {
          const eg = moleculeGlowSprite("hot", cfg.isHigh ? 0.34 : 0.24, cfg.isHigh ? 0.9 : 0.65);
          eg.position.copy(e.position);
          moleculeGroup.add(eg);
          moleculeAnimators.push((t) => {
            const theta = electronMeshes.find((x) => x.mesh === e)!.theta0 + t * (0.6 + si * 0.15);
            eg.position.set(Math.cos(theta) * radius, Math.sin(t * 0.7 + si) * 0.06, Math.sin(theta) * radius);
          });
        }
      }
      // Electrons orbit the nucleus continuously — this is the "animated
      // electrons" requirement; speed varies gently per-shell.
      const orbitSpeed = 0.5 + si * 0.18;
      moleculeAnimators.push((t) => {
        electronMeshes.forEach(({ mesh, theta0 }) => {
          const theta = theta0 + t * orbitSpeed;
          mesh.position.set(Math.cos(theta) * radius, 0, Math.sin(theta) * radius);
        });
        ring.rotation.z = t * orbitSpeed * 0.25;
      });
    });

    const totalElectrons = baseElectrons.reduce((a, b) => a + b, 0) + atomicDeltas.electron;
    const info = moleculeLabelSprite(`Z${element.atomicNumber + atomicDeltas.proton} ${element.name} p${protons} n${neutrons} e${totalElectrons}`, "mid");
    info.scale.set(2.4, 0.42, 1);
    info.position.y = -(nucleusRadius + shells.length * 0.48 + 0.6);
    moleculeGroup.add(info);

    // Nucleus pulse — subtle, keeps the core feeling alive without hazing
    // out the sharp proton/neutron spheres.
    moleculeAnimators.push((t) => {
      const s = 1 + Math.sin(t * 1.6) * 0.035;
      moleculeGroup.children.slice(0, Math.min(protons, cap) + Math.min(neutrons, cap)).forEach((m) => m.scale.setScalar(s));
    });
  }

  // ——— MOLECULE: atom spheres + nucleus + bonds (+ optional labels) ———
  function buildMoleculeVisual(nextAtoms: LabAtom[], nextBonds: Bond[]) {
    clearMoleculeVisual();
    const cfg = moleculeQualityCfg();
    // CPK mode: atom spheres use each element's standard CPK-style colour.
    // Keep the scene theme for bonds, labels and UI chrome; chemistry colours
    // remain element-specific in molecule mode.
    const nucleusMat = new THREE.MeshBasicMaterial({ color: THEMES[activeTheme].hot, transparent: true, opacity: 0.85 });
    nucleusMat.userData.themeRole = "hot";
    const bondMat = new THREE.MeshBasicMaterial({ color: THEMES[activeTheme].mid, transparent: true, opacity: 0.85 });
    bondMat.userData.themeRole = "mid";

    nextAtoms.forEach((atom) => {
      const g = new THREE.Group();
      g.position.set(...atom.position);
      g.userData.atomId = atom.id;
      g.userData.elementSymbol = atom.element.symbol;
      const cpk = new THREE.Color(atom.element.color);
      const atomMat = new THREE.MeshStandardMaterial({
        color: cpk,
        emissive: cpk,
        emissiveIntensity: cfg.isHigh ? 0.55 : 0.32,
        metalness: 0.15,
        roughness: 0.3,
      });
      const geo = new THREE.SphereGeometry(0.34, cfg.atomSegs, cfg.atomSegs - 4);
      const mesh = new THREE.Mesh(geo, atomMat);
      g.add(mesh);
      if (atom.id === selectedAtomId) {
        const ring = new THREE.Mesh(
          new THREE.TorusGeometry(0.44, 0.02, 8, cfg.isLow ? 24 : 48),
          new THREE.MeshBasicMaterial({ color: THEMES[activeTheme].hot, transparent: true, opacity: 0.9 }),
        );
        (ring.material as THREE.Material).userData.themeRole = "hot";
        g.add(ring);
        moleculeAnimators.push((t) => {
          ring.rotation.x = t * 1.1;
          ring.rotation.y = t * 0.7;
        });
      }
      const nucleus = new THREE.Mesh(new THREE.SphereGeometry(0.14, cfg.isLow ? 8 : 14, cfg.isLow ? 6 : 10), nucleusMat);
      g.add(nucleus);
      const eDelta = atom.electronDelta || 0, pDelta = atom.protonDelta || 0, nDelta = atom.neutronDelta || 0;
      const labelText = `${atom.element.symbol}${eDelta ? ` ${eDelta > 0 ? "+" : ""}${eDelta}e` : ""}${pDelta ? ` ${pDelta > 0 ? "+" : ""}${pDelta}p` : ""}${nDelta ? ` ${nDelta > 0 ? "+" : ""}${nDelta}n` : ""}`;
      const label = moleculeLabelSprite(labelText, "bright");
      label.position.y = 0.52;
      g.add(label);
      moleculeGroup.add(g);
    });

    const map = new Map(nextAtoms.map((a) => [a.id, a]));
    nextBonds.forEach((b) => {
      const a = map.get(b.a), c = map.get(b.b);
      if (!a || !c) return;
      const start = new THREE.Vector3(...a.position), end = new THREE.Vector3(...c.position);
      const dir = end.clone().sub(start), len = dir.length();
      const mid = start.clone().add(end).multiplyScalar(0.5);
      const geo = new THREE.CylinderGeometry(0.07, 0.07, len, cfg.bondSegs);
      const mesh = new THREE.Mesh(geo, bondMat);
      mesh.position.copy(mid);
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
      moleculeGroup.add(mesh);
      if (cfg.bloom) {
        const glowMat = new THREE.MeshBasicMaterial({
          color: THEMES[activeTheme].mid,
          transparent: true,
          opacity: cfg.isHigh ? 0.16 : 0.09,
          blending: THREE.AdditiveBlending,
        });
        glowMat.userData.themeRole = "mid";
        const glow = new THREE.Mesh(geo, glowMat);
        glow.position.copy(mid);
        glow.quaternion.copy(mesh.quaternion);
        glow.scale.set(2.8, 1.2, 2.8);
        moleculeGroup.add(glow);
      }
      if (b.order > 1) {
        for (let k = 1; k < b.order; k++) {
          const offset = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0));
          if (offset.lengthSq() < 0.01) offset.set(1, 0, 0);
          offset.normalize().multiplyScalar((k - (b.order - 1) / 2) * 0.11);
          const extra = new THREE.Mesh(geo, bondMat);
          extra.position.copy(mid).add(offset);
          extra.quaternion.copy(mesh.quaternion);
          moleculeGroup.add(extra);
        }
      }
      // Energy trail: a faint pulse of light that travels along the bond,
      // reinforcing the "electrons/energy flowing through bonds" visual.
      if (cfg.bloom) {
        const trail = moleculeGlowSprite("hot", 0.22, 0.8);
        moleculeGroup.add(trail);
        const phase = Math.random() * Math.PI * 2;
        moleculeAnimators.push((t) => {
          const p = (Math.sin(t * 1.3 + phase) + 1) / 2;
          trail.position.lerpVectors(start, end, p);
        });
      }
    });

    const formulaLabel = moleculeLabelSprite(formulaOf(nextAtoms), "mid");
    formulaLabel.scale.set(2.0, 0.42, 1);
    formulaLabel.position.y = -2.0;
    moleculeGroup.add(formulaLabel);

    // Gentle overall rotation + breathing pulse so the molecule doesn't
    // feel static once it settles.
    moleculeAnimators.push((t) => {
      moleculeGroup.rotation.y += 0.0016;
      const pulse = 1 + Math.sin(t * 0.9) * 0.01;
      moleculeGroup.children.forEach((child) => {
        if (child.userData.atomId) child.scale.setScalar(pulse);
      });
    });
  }

  function rebuildMoleculeVisual() {
    if (displayMode === "atom") buildAtomicModel(selectedElement);
    else buildMoleculeVisual(atoms, bonds);
  }

  // ——— transitions: morph the existing orb into the molecule and back ———
  function enterMoleculeMode() {
    if (moleculeUIMode === "molecule" || moleculeUIMode === "entering") return;
    moleculeUIMode = "entering";
    transitionStart = clock.getElapsedTime();
    transitionFrom = moleculeMorph;
    moleculeGroup.visible = true;
    rebuildMoleculeVisual();
  }

  function exitMoleculeMode() {
    if (moleculeUIMode === "orb" || moleculeUIMode === "exiting") return;
    moleculeUIMode = "exiting";
    transitionStart = clock.getElapsedTime();
    transitionFrom = moleculeMorph;
  }

  function isMoleculeModeActive() {
    return moleculeUIMode === "molecule" || moleculeUIMode === "entering";
  }

  let moleculeMorph = 0; // 0 = pure orb, 1 = pure molecule

  // ——— voice-command handling (ported from the old MoleculeLab) ———
  function loadTemplate(t: MoleculeTemplate) {
    const next = t.atoms.map((a, i) => ({ id: `a${Date.now()}-${i}`, element: ELEMENT_BY_SYMBOL[a[0]], position: [a[1], a[2], a[3]] as [number, number, number] }));
    displayMode = "molecule";
    atoms = next;
    bonds = t.bonds.map((b) => ({ a: next[b[0]].id, b: next[b[1]].id, order: b[2] }));
    selectedAtomId = next[0]?.id || null;
    rebuildMoleculeVisual();
  }

  function addAtomOfElement(element: ElementData) {
    displayMode = "molecule";
    const base = atoms.find((a) => a.id === selectedAtomId)?.position || [0, 0, 0];
    const angle = atoms.length * 0.91;
    const pos: [number, number, number] = [base[0] + Math.cos(angle) * 1.25, base[1] + Math.sin(angle) * 0.65, base[2] + Math.sin(angle * 1.7) * 0.9];
    const atom: LabAtom = { id: `a${Date.now()}-${Math.random()}`, element, position: pos };
    atoms = [...atoms, atom];
    bonds = inferBonds(atoms);
    selectedAtomId = atom.id;
    selectedElement = element;
    rebuildMoleculeVisual();
  }

  function removeSelectedAtom() {
    if (!selectedAtomId) return;
    atoms = atoms.filter((a) => a.id !== selectedAtomId);
    bonds = inferBonds(atoms);
    selectedAtomId = atoms[0]?.id || null;
    rebuildMoleculeVisual();
  }

  function breakMolecule() {
    bonds = [];
    rebuildMoleculeVisual();
  }

  function rearrangeMolecule() {
    const n = atoms.length;
    if (!n) return;
    atoms = atoms.map((a, i) => {
      const phi = Math.acos(1 - (2 * (i + 0.5)) / n);
      const theta = Math.PI * (1 + Math.sqrt(5)) * (i + 0.5);
      return { ...a, position: [Math.cos(theta) * Math.sin(phi) * 1.5, Math.cos(phi) * 1.5, Math.sin(theta) * Math.sin(phi) * 1.5] as [number, number, number] };
    });
    bonds = inferBonds(atoms);
    rebuildMoleculeVisual();
  }

  function validateBonds(): string {
    if (!atoms.length) return "NO ATOMS IN THE STRUCTURE";
    const degree = new Map<string, number>();
    bonds.forEach((b) => {
      degree.set(b.a, (degree.get(b.a) || 0) + b.order);
      degree.set(b.b, (degree.get(b.b) || 0) + b.order);
    });
    const bad = atoms.filter((a) => (degree.get(a.id) || 0) > valenceLimit(a.element));
    return bad.length
      ? `HEURISTIC CHECK: ${bad.map((a) => a.element.symbol).join(",")} EXCEEDS COMMON VALENCE`
      : "HEURISTIC CHECK: BONDS FIT COMMON VALENCE LIMITS";
  }

  function setElectronDelta(atomId: string, delta: number) {
    atoms = atoms.map((a) => (a.id === atomId ? { ...a, electronDelta: Math.max(-a.element.atomicNumber, Math.min(20, (a.electronDelta || 0) + delta)) } : a));
    selectedAtomId = atomId;
    rebuildMoleculeVisual();
  }

  function adjustAtomicParticle(kind: "electron" | "proton" | "neutron", delta: number) {
    const min = kind === "neutron" ? -Math.max(0, Math.round(selectedElement.atomicMass) - selectedElement.atomicNumber) : -selectedElement.atomicNumber;
    atomicDeltas = { ...atomicDeltas, [kind]: Math.max(min, Math.min(20, atomicDeltas[kind] + delta)) };
    rebuildMoleculeVisual();
  }

  function adjustAtomParticle(atomId: string, kind: "electron" | "proton" | "neutron", delta: number) {
    atoms = atoms.map((a) => {
      if (a.id !== atomId) return a;
      const key = (kind + "Delta") as "electronDelta" | "protonDelta" | "neutronDelta";
      const current = a[key] || 0;
      const min = kind === "electron" || kind === "proton" ? -a.element.atomicNumber : -Math.max(0, Math.round(a.element.atomicMass) - a.element.atomicNumber);
      return { ...a, [key]: Math.max(min, Math.min(20, current + delta)) };
    });
    selectedAtomId = atomId;
    rebuildMoleculeVisual();
  }

  function selectElement(element: ElementData) {
    selectedElement = element;
    atomicDeltas = { electron: 0, proton: 0, neutron: 0 };
    displayMode = "atom";
    rebuildMoleculeVisual();
  }

  // Single entry point for voice commands. Mirrors the original
  // MoleculeLab `onVoice` handler, but drives the shared orb scene
  // directly instead of a second component/scene — this *is* "reusing
  // the existing voice system", just routed to a different target.
  function moleculeCommand(rawText: string, respond: (text: string) => void): boolean {
    const raw = normalizeVoice(rawText);
    if (!raw) return false;
    const say = (text: string) => {
      emitMoleculeMessage(text);
      respond(text);
    };

    const template = findTemplate(raw);
    if (/\b(create|build|load|show|make|construct)\b/.test(raw) && template) {
      loadTemplate(template);
      say(`${template.formula} loaded`);
      return true;
    }
    if (/\b(break|separate|split)\b.*\b(molecule|bonds?)\b/.test(raw)) {
      breakMolecule();
      say("Bonds removed; atoms are ready to rearrange");
      return true;
    }
    if (/\b(rearrange|reorganize|scatter)\b.*\batoms?\b/.test(raw)) {
      rearrangeMolecule();
      say("Atoms rearranged");
      return true;
    }
    if (/\b(validate|check)\b.*\b(bonds?|structure|molecule)\b/.test(raw)) {
      say(validateBonds());
      return true;
    }
    if (/\b(atom|atomic)\s+mode\b|\bshow\s+(the\s+)?atom\b/.test(raw)) {
      displayMode = "atom";
      rebuildMoleculeVisual();
      say(`${selectedElement.name} atomic model`);
      return true;
    }
    if (/\bmolecule\s+mode\b|\bshow\s+(the\s+)?molecule\b/.test(raw)) {
      displayMode = "molecule";
      rebuildMoleculeVisual();
      say(`${formulaOf(atoms)} molecule mode`);
      return true;
    }
    const chosen = findElement(raw);
    if (/\b(select|choose|inspect|show)\b/.test(raw) && chosen) {
      selectElement(chosen);
      say(`${chosen.name} selected`);
      return true;
    }
    const countMatch = raw.match(/\b(add|remove|delete|take away|subtract)\s+(\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten)?\s*(electrons?|protons?|neutrons?)\b/);
    if (countMatch) {
      const action = countMatch[1];
      const countWord = countMatch[2] || "1";
      const words: { [k: string]: number } = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
      const count = Number(countWord) || words[countWord] || 1;
      const kind = countMatch[3].startsWith("electron") ? "electron" : countMatch[3].startsWith("proton") ? "proton" : "neutron";
      const delta = /^(remove|delete|take away|subtract)$/.test(action) ? -count : count;
      const target = chosen || (selectedAtomId ? atoms.find((a) => a.id === selectedAtomId)?.element : null);
      if (selectedAtomId && target) {
        adjustAtomParticle(selectedAtomId, kind, delta);
        say(`${Math.abs(delta)} ${kind}${Math.abs(delta) === 1 ? "" : "s"} ${delta > 0 ? "added to" : "removed from"} ${target.symbol}`);
      } else {
        if (chosen) selectedElement = chosen;
        adjustAtomicParticle(kind, delta);
        say(`${Math.abs(delta)} ${kind}${Math.abs(delta) === 1 ? "" : "s"} ${delta > 0 ? "added to" : "removed from"} ${target?.symbol || selectedElement.symbol}`);
      }
      return true;
    }
    const atomAdd = raw.match(/\b(add|insert|place)\s+(?:an?\s+)?([a-z]{1,12})\s+atoms?\b/);
    if (atomAdd) {
      const e = ELEMENTS.find((x) => x.name.toLowerCase() === atomAdd[2] || x.symbol.toLowerCase() === atomAdd[2]);
      if (e) {
        addAtomOfElement(e);
        say(`${e.symbol} atom added`);
        return true;
      }
    }
    const atomRemove = raw.match(/\b(remove|delete)\s+(?:the\s+)?([a-z]{1,12})\s+atoms?\b/);
    if (atomRemove) {
      const e = ELEMENTS.find((x) => x.name.toLowerCase() === atomRemove[2] || x.symbol.toLowerCase() === atomRemove[2]);
      const id = atoms.find((a) => a.element.symbol.toLowerCase() === e?.symbol.toLowerCase())?.id;
      if (id) {
        selectedAtomId = id;
        removeSelectedAtom();
        say(`${e?.symbol || "selected"} atom removed`);
        return true;
      }
    }
    // Bare "add atom" / "remove atom" with no element named: use whatever
    // element is currently selected.
    if (/\badd\s+(?:an?\s+)?atom\b/.test(raw)) {
      addAtomOfElement(selectedElement);
      say(`${selectedElement.symbol} atom added`);
      return true;
    }
    if (/\bremove\s+(?:the\s+)?atom\b/.test(raw) && selectedAtomId) {
      removeSelectedAtom();
      say("Atom removed");
      return true;
    }
    return false;
  }

  // ——— hand-tracking gesture handling (grab/move/drop, corner zones) ———
  // Reuses the same `jarvis-hand-gesture` events the orb's rotate/zoom
  // already come from — no second input system.
  const gestureGrab: { atomId: string | null; lastX: number; lastY: number; active: boolean; zoom?: number } = {
    atomId: null,
    lastX: 0,
    lastY: 0,
    active: false,
  };
  const ndcScratch = new THREE.Vector2();
  const raycasterScratch = new THREE.Raycaster();

  function handleMoleculeGesture(
    detail: { mode: "idle" | "spin" | "zoom"; points: Array<{ x: number; y: number; pinching: boolean }> },
    onMessage?: (text: string) => void,
  ) {
    if (!isMoleculeModeActive() || displayMode !== "molecule") return;
    const point = detail.points.find((p) => p.pinching);
    const wasActive = gestureGrab.active;

    if (detail.mode === "zoom" && detail.points.length >= 2) {
      // Programmatic zoom already goes through zoomBy() via onZoom in the
      // caller; nothing extra needed here beyond letting it pass through.
      gestureGrab.active = false;
      gestureGrab.atomId = null;
      return;
    }

    if (detail.mode !== "spin" || !point) {
      if (wasActive && gestureGrab.atomId) {
        bonds = inferBonds(atoms);
        rebuildMoleculeVisual();
        onMessage?.("ATOM RELEASED · BONDS RE-EVALUATED");
      }
      gestureGrab.atomId = null;
      gestureGrab.active = false;
      return;
    }

    const x = Math.max(0, Math.min(1, point.x));
    const y = Math.max(0, Math.min(1, point.y));
    const zone = x < 0.16 && y < 0.16 ? "add" : x > 0.84 && y < 0.16 ? "remove" : x < 0.16 && y > 0.84 ? "electronDown" : x > 0.84 && y > 0.84 ? "electronUp" : null;

    if (!wasActive) {
      if (zone === "add") {
        addAtomOfElement(selectedElement);
        gestureGrab.active = true;
        gestureGrab.atomId = null;
        onMessage?.("GESTURE: ATOM ADDED");
        return;
      }
      if (zone === "remove") {
        removeSelectedAtom();
        gestureGrab.active = true;
        gestureGrab.atomId = null;
        onMessage?.("GESTURE: ATOM REMOVED");
        return;
      }
      if (zone === "electronDown" && selectedAtomId) {
        setElectronDelta(selectedAtomId, -1);
        gestureGrab.active = true;
        gestureGrab.atomId = null;
        return;
      }
      if (zone === "electronUp" && selectedAtomId) {
        setElectronDelta(selectedAtomId, 1);
        gestureGrab.active = true;
        gestureGrab.atomId = null;
        return;
      }
      ndcScratch.set(x * 2 - 1, -(y * 2 - 1));
      raycasterScratch.setFromCamera(ndcScratch, camera);
      const hits = raycasterScratch.intersectObjects(moleculeGroup.children, true);
      let hitId: string | null = null;
      for (const hit of hits) {
        let obj: THREE.Object3D | null = hit.object;
        while (obj && !obj.userData.atomId) obj = obj.parent;
        if (obj?.userData.atomId) {
          hitId = obj.userData.atomId;
          break;
        }
      }
      if (hitId) {
        selectedAtomId = hitId;
        const el = atoms.find((a) => a.id === hitId)?.element;
        if (el) selectedElement = el;
        rebuildMoleculeVisual();
        gestureGrab.atomId = hitId;
        gestureGrab.lastX = x;
        gestureGrab.lastY = y;
        gestureGrab.active = true;
        onMessage?.("GESTURE: ATOM GRABBED");
        return;
      }
      gestureGrab.atomId = null;
      gestureGrab.lastX = x;
      gestureGrab.lastY = y;
      gestureGrab.active = true;
      return;
    }

    const lastX = gestureGrab.lastX, lastY = gestureGrab.lastY;
    if (gestureGrab.atomId) {
      const atom = atoms.find((a) => a.id === gestureGrab.atomId);
      if (atom) {
        const dx = (x - lastX) * 7;
        const dy = (y - lastY) * -7;
        atoms = atoms.map((a) => (a.id === atom.id ? { ...a, position: [a.position[0] + dx, a.position[1] + dy, a.position[2]] as [number, number, number] } : a));
        rebuildMoleculeVisual();
      }
    } else {
      rotateBy((x - lastX) * -5, (y - lastY) * 5);
    }
    gestureGrab.lastX = x;
    gestureGrab.lastY = y;
  }

  function getMoleculeReadout() {
    return {
      active: isMoleculeModeActive(),
      displayMode,
      formula: formulaOf(atoms),
      atomCount: atoms.length,
      bondCount: bonds.length,
      selectedElement: selectedElement.symbol,
      message: moleculeMessage,
    };
  }

  // ═══════════════════════════════════════════════
  // GESTURE / PROGRAMMATIC CAMERA CONTROL
  // ═══════════════════════════════════════════════
  const sphericalScratch = new THREE.Spherical();
  const offsetScratch = new THREE.Vector3();

  function rotateBy(deltaTheta: number, deltaPhi: number) {
    offsetScratch.copy(camera.position).sub(controls.target);
    sphericalScratch.setFromVector3(offsetScratch);
    sphericalScratch.theta -= deltaTheta;
    sphericalScratch.phi = THREE.MathUtils.clamp(
      sphericalScratch.phi - deltaPhi,
      0.05,
      Math.PI - 0.05,
    );
    sphericalScratch.makeSafe();
    offsetScratch.setFromSpherical(sphericalScratch);
    camera.position.copy(controls.target).add(offsetScratch);
    camera.lookAt(controls.target);
  }

  function zoomBy(factor: number) {
    offsetScratch.copy(camera.position).sub(controls.target);
    const dist = THREE.MathUtils.clamp(
      offsetScratch.length() * factor,
      MIN_DISTANCE,
      MAX_DISTANCE,
    );
    offsetScratch.setLength(dist);
    camera.position.copy(controls.target).add(offsetScratch);
  }

  function resetView() {
    camera.position.copy(HOME_POSITION);
    controls.target.set(0, 0, 0);
    camera.lookAt(controls.target);
    controls.update();
  }

  // ═══════════════════════════════════════════════
  // PERFORMANCE QUALITY
  // ═══════════════════════════════════════════════
  // The pixel-ratio a quality level asks for is still capped by
  // `pixelRatioCap` (2 on mobile, 3 on desktop) so Performance Mode and
  // Desktop Mode compose correctly instead of one silently overriding
  // the other.
  function setPerformanceMode(mode: PerformanceMode) {
    performanceMode = mode;
    const quality = mode === "auto" ? renderQuality : mode.toUpperCase();
    renderQuality = quality;
    const settings: Record<
      string,
      {
        pixelRatio: number;
        bloom: boolean;
        chromatic: boolean;
        debris: number;
        outerText: number;
        innerText: number;
        ambientText: number;
        dustOpacity: number;
        scan: boolean;
      }
    > = {
      HIGH: { pixelRatio: pixelRatioCap, bloom: true, chromatic: true, debris: 250, outerText: 1200, innerText: 100, ambientText: 400, dustOpacity: 0.5, scan: true },
      MEDIUM: { pixelRatio: Math.min(pixelRatioCap, 1.5), bloom: true, chromatic: true, debris: 150, outerText: 700, innerText: 70, ambientText: 220, dustOpacity: 0.38, scan: true },
      LOW: { pixelRatio: 1, bloom: false, chromatic: false, debris: 80, outerText: 350, innerText: 40, ambientText: 100, dustOpacity: 0.25, scan: false },
    };
    const cfg = settings[quality] ?? settings.HIGH;
    currentPixelRatioCap = cfg.pixelRatio;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, cfg.pixelRatio));
    bloom.enabled = cfg.bloom;
    chromaticPass.enabled = cfg.chromatic;
    debris.forEach((mesh, i) => { mesh.visible = i < cfg.debris; });
    textOuter.children.forEach((child, i) => { child.visible = i < cfg.outerText; });
    textInner.children.forEach((child, i) => { child.visible = i < cfg.innerText; });
    textAmbient.children.forEach((child, i) => { child.visible = i < cfg.ambientText; });
    (dustPoints.material as THREE.PointsMaterial).opacity = cfg.dustOpacity;
    scanRing1.visible = cfg.scan;
    scanRing2.visible = cfg.scan;
  }

  function updateAutoQuality(now: number) {
    if (performanceMode !== "auto") return;
    if (now < autoQualityCooldown) return;

    const fps = lastFps;
    const current = renderQuality;
    let target = current;

    // Sustained thresholds + hysteresis prevent quality thrashing.
    if (current === "HIGH" && fps < 42) target = "MEDIUM";
    else if (current === "MEDIUM" && fps < 30) target = "LOW";
    else if (current === "LOW" && fps >= 50) target = "MEDIUM";
    else if (current === "MEDIUM" && fps >= 55) target = "HIGH";

    if (target !== current) {
      if (autoQualityLastDecision !== target) {
        autoQualityLastDecision = target;
        autoQualityStableSince = now;
        return;
      }
      if (now - autoQualityStableSince < 2500) return;

      setPerformanceMode(target.toLowerCase() as PerformanceMode);
      performanceMode = "auto";
      renderQuality = target;
      autoQualityCooldown = now + 3500;
      autoQualityStableSince = now;
    } else {
      autoQualityLastDecision = current;
      autoQualityStableSince = now;
    }
  }

  function getPerformanceInfo() {
    return { fps: Math.round(lastFps), renderQuality, webgl: Boolean(renderer.getContext()) };
  }

  // ═══════════════════════════════════════════════
  // ANIMATION
  // ═══════════════════════════════════════════════
  const clock = new THREE.Clock();
  let flickerTimer = 0;
  let voiceEnergy = 0;
  let voiceTarget = 0;
  let rafId = 0;
  let disposed = false;

  function animate() {
    if (disposed) return;
    rafId = requestAnimationFrame(animate);
    if (document.hidden) return; // browsers/Android can stop doing 3D work in background
    const t = clock.getElapsedTime();
    fpsFrames++;
    const now = performance.now();
    if (now - fpsWindowStart >= 1000) {
      lastFps = (fpsFrames * 1000) / (now - fpsWindowStart);
      fpsFrames = 0;
      fpsWindowStart = now;
      updateAutoQuality(now);
    }
    voiceEnergy += (voiceTarget - voiceEnergy) * 0.06;
    const spin = 1 + voiceEnergy * 1.6;

    // ——— molecule <-> orb morph ———
    if (moleculeUIMode === "entering" || moleculeUIMode === "exiting") {
      const elapsed = (t - transitionStart) * 1000;
      const progress = Math.min(1, elapsed / MOLECULE_TRANSITION_MS);
      const eased = 1 - Math.pow(1 - progress, 3);
      const target = moleculeUIMode === "entering" ? 1 : 0;
      moleculeMorph = transitionFrom + (target - transitionFrom) * eased;
      if (progress >= 1) {
        moleculeUIMode = moleculeUIMode === "entering" ? "molecule" : "orb";
        if (moleculeUIMode === "orb") {
          moleculeGroup.visible = false;
          clearMoleculeVisual();
        } else {
          // Transition finished: snap every material back to its original
          // opacity/transparency so the settled molecule is fully solid
          // and sharp, not left faded from the morph.
          moleculeGroup.traverse((obj) => {
            const mat = (obj as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
            const mats = Array.isArray(mat) ? mat : mat ? [mat] : [];
            for (const m of mats) {
              if (m.userData.baseOpacity === undefined) continue;
              const mm = m as THREE.Material & { opacity: number };
              mm.opacity = m.userData.baseOpacity;
              mm.transparent = m.userData.baseTransparent ?? mm.transparent;
            }
          });
        }
      }
    }
    if (moleculeMorph > 0 || moleculeGroup.visible) {
      moleculeGroup.visible = moleculeMorph > 0.001;
      moleculeGroup.scale.setScalar(Math.max(0.001, moleculeMorph));
      // Only fade opacity while actively morphing so the settled molecule
      // stays fully solid/sharp (no permanent transparency/haze) once the
      // transition finishes.
      if (moleculeUIMode === "entering" || moleculeUIMode === "exiting") {
        const moleculeOpacity = moleculeMorph;
        moleculeGroup.traverse((obj) => {
          const mat = (obj as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
          const mats = Array.isArray(mat) ? mat : mat ? [mat] : [];
          for (const m of mats) {
            const mm = m as THREE.Material & { opacity: number };
            if (m.userData.baseOpacity === undefined) m.userData.baseOpacity = mm.opacity;
            const wasTransparent = m.userData.baseTransparent ?? m.transparent;
            m.userData.baseTransparent = wasTransparent;
            mm.transparent = true;
            mm.opacity = (m.userData.baseOpacity ?? 1) * moleculeOpacity;
          }
        });
      }
      moleculeAnimators.forEach((fn) => fn(t));
    }
    orbVisuals.visible = moleculeMorph < 0.999;
    const pulseRate = 1 + voiceEnergy * 1.8;
    if (orbVisuals.visible) {
    const orbScale = 1 - moleculeMorph;
    orbVisuals.scale.setScalar(orbScale);

    // Outer shell rotation
    outerShell.rotation.y += 0.0015 * spin;
    outerShell.rotation.x = Math.sin(t * 0.08) * 0.05;

    // Panel group follows shell but with slight offset
    panelGroup.rotation.y += 0.0018 * spin;
    panelGroup.rotation.x = Math.sin(t * 0.08 + 0.5) * 0.04;

    // Secondary shell counter-rotates slowly
    shell2.rotation.y -= 0.001 * spin;
    shell2.rotation.z = Math.sin(t * 0.12) * 0.03;

    // Inner core — opposite, faster
    innerCore.rotation.y -= 0.005 * spin;
    innerCore.rotation.z += 0.002 * spin;
    innerCore.rotation.x = Math.cos(t * 0.1) * 0.08;

    // Innermost wireframe
    icoWire.rotation.x += 0.008 * spin;
    icoWire.rotation.y += 0.012 * spin;

    // Core pulse — dramatic surges but mostly transparent.
    const wave1 = Math.sin(t * 1.2 * pulseRate);
    const wave3 = Math.pow(Math.max(0, Math.sin(t * 0.4 * pulseRate)), 5);
    const wave4 = Math.pow(Math.max(0, Math.sin(t * 0.7 * pulseRate + 2)), 8);
    const fadeOut = Math.pow(Math.max(0, Math.sin(t * 0.25)), 3);
    const surge = (wave3 * 1.5 + wave4 * 2.0) * (1 + voiceEnergy * 0.25);
    const coreScale = 1 + surge + Math.sin(t * 5) * 0.05;
    coreSphere.scale.setScalar(coreScale);
    // Opacity: mostly very low (0-0.15), sometimes fully transparent, brief bright on surge
    const coreOpacity = Math.max(
      0,
      (0.08 + wave1 * 0.05 + surge * 0.2) * (1 - fadeOut * 0.95),
    );
    coreSphereMat.opacity = Math.min(0.6, coreOpacity);
    glowSphere.scale.setScalar(1 + surge * 0.8);
    glowSphereMat.opacity = Math.max(0, (0.03 + surge * 0.08) * (1 - fadeOut * 0.9));
    // Icosahedron wireframe stays visible even when glow fades
    icoWire.scale.setScalar(1 + surge * 0.6);
    icoWireMat.opacity = Math.min(1, 0.5 + surge * 0.4);

    // Expensive satellite/text transforms are throttled to ~30 FPS.
    // The camera, core pulse and shell motion remain full-rate.
    const slowFrame = Math.floor(now / 33) !== Math.floor((now - 16) / 33);
    if (slowFrame) {
      debris.forEach((d) => {
        const u = d.userData as DebrisOrbit;
        const a = t * u.speed + u.phase;
        d.position.set(
          u.orbitR * Math.cos(a) * Math.cos(u.tiltX),
          u.orbitR * Math.sin(u.tiltX) * Math.sin(a * 0.8) + Math.sin(a * 0.3 + u.tiltZ) * 0.2,
          u.orbitR * Math.sin(a) * Math.cos(u.tiltZ),
        );
        d.rotation.x += 0.015;
        d.rotation.z += 0.01;
      });

      // Text drift
      const driftGroups: [THREE.Group, number][] = [
        [textOuter, 1],
        [textInner, 2],
        [textAmbient, 1.2],
      ];
      for (const [group, mult] of driftGroups) {
        group.children.forEach((sp) => {
          const u = sp.userData as SpriteDrift;
          u.theta += u.speed * mult;
          sp.position.set(
            u.r * Math.sin(u.phi) * Math.cos(u.theta),
            u.r * Math.cos(u.phi),
            u.r * Math.sin(u.phi) * Math.sin(u.theta),
          );
        });
      }
    }

    // Scan rings sweeping
    const scanY1 = Math.sin(t * 0.4) * R1;
    scanRing1.position.y = scanY1;
    const scanS1 = Math.sqrt(Math.max(0, R1 * R1 - scanY1 * scanY1)) / R1;
    scanRing1.scale.set(scanS1, scanS1, 1);
    (scanRing1.material as THREE.MeshBasicMaterial).opacity = 0.2 * scanS1;

    const scanY2 = Math.sin(t * 0.6 + 2) * R3;
    scanRing2.position.y = scanY2;
    const scanS2 = Math.sqrt(Math.max(0, R3 * R3 - scanY2 * scanY2)) / R3;
    scanRing2.scale.set(scanS2, scanS2, 1);
    (scanRing2.material as THREE.MeshBasicMaterial).opacity = 0.15 * scanS2;

    // Dust rotation
    dustPoints.rotation.y += 0.0002;

    // Random flicker on some panels
    flickerTimer += 0.016;
    if (flickerTimer > 0.1) {
      flickerTimer = 0;
      panelGroup.children.forEach((p) => {
        if (Math.random() > 0.95) {
          p.visible = !p.visible;
        }
      });
    }

    } // end if (orbVisuals.visible)

    // Bloom pulse — shared by both the orb and molecule mode (bloom stays
    // on for High/Medium performance regardless of which is showing).
    bloom.strength = 1.6 + Math.sin(t * 0.8 * pulseRate) * 0.3 + voiceEnergy * 0.35;

    // Update chromatic aberration time
    chromaticPass.uniforms.uTime.value = t;

    controls.update();
    composer.render();
  }

  // Start Auto mode at a safe quality. The controller promotes quality only
  // after sustained headroom, avoiding a heavy first frame on mobile/Termux.
  performanceMode = "auto";
  setPerformanceMode(options.desktopMode ? "high" : "medium");
  performanceMode = "auto";
  renderQuality = options.desktopMode ? "HIGH" : "MEDIUM";
  autoQualityLastDecision = renderQuality;
  animate();

  // ——— RESIZE ———
  // Also re-reads devicePixelRatio on every resize (not just at creation) so
  // dragging the window to a monitor with a different scaling factor — a
  // common desktop multi-monitor scenario — keeps the orb crisp instead of
  // staying locked to whatever DPR was active on load.
  function onResize() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    // Use the pixel ratio for the *current* performance quality, not the
    // raw desktop/mobile cap — so an active LOW/MEDIUM performance mode
    // survives a monitor change instead of jumping back to full quality.
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, currentPixelRatioCap));
    renderer.setSize(w, h);
    composer.setSize(w, h);
  }
  window.addEventListener("resize", onResize);

  // ——— CLEANUP ———
  function dispose() {
    disposed = true;
    cancelAnimationFrame(rafId);
    window.removeEventListener("resize", onResize);
    controls.dispose();
    scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const mat of mats) {
        if (!mat) continue;
        const anyMat = mat as THREE.Material & { map?: THREE.Texture };
        anyMat.map?.dispose();
        mat.dispose();
      }
    });
    composer.dispose();
    renderer.dispose();
    renderer.domElement.remove();
  }

  function setTheme(theme: OrbTheme) {
    if (!THEMES[theme]) return;
    applyTheme(theme);
  }


  function setCustomColor(hex: string) {
    const base = new THREE.Color(hex);
    if (!Number.isFinite(base.r) || !Number.isFinite(base.g) || !Number.isFinite(base.b)) return;

    const palette = {
      bright: base.clone(),
      mid: base.clone().multiplyScalar(0.68),
      dim: base.clone().multiplyScalar(0.38),
      faint: base.clone().multiplyScalar(0.18),
      hot: base.clone().lerp(new THREE.Color(0xffffff), 0.55),
    };

    scene.traverse((obj) => {
      const material = (obj as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      const materials = Array.isArray(material) ? material : material ? [material] : [];
      for (const mat of materials) {
        const color = (mat as THREE.Material & { color?: THREE.Color }).color;
        if (!color) continue;
        const role = mat.userData.themeRole as keyof typeof palette | undefined;
        if (role) {
          color.copy(palette[role]);
          mat.needsUpdate = true;
        }
      }
    });
  }

  return {
    rotateBy,
    zoomBy,
    zoomIn: () => zoomBy(0.65),
    zoomOut: () => zoomBy(1.55),
    setVoiceState: (state: VoiceState) => {
      voiceTarget = VOICE_ENERGY[state];
    },
    setTheme,
    setCustomColor,
    setPerformanceMode,
    getPerformanceInfo,
    resetView,
    dispose,
    enterMoleculeMode,
    exitMoleculeMode,
    isMoleculeModeActive,
    moleculeCommand,
    handleMoleculeGesture,
    getMoleculeReadout,
  };
}
