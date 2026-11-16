"use client";
import { useEffect, useRef, type CSSProperties } from "react";
import { getRealtimeLevel } from "@/lib/realtime/levelBus";

/** Self-contained overlay that pulses with the processed Realtime voice (AnalyserNode level).
 *  Independent of the Three.js orb, so orb files can be replaced freely. Assumes the orb is centred. */
export default function OrbAudioGlow() {
  const glow = useRef<HTMLDivElement>(null);
  const ring = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0, shown = 0;
    const tick = () => {
      const lv = getRealtimeLevel();
      shown += (lv - shown) * 0.3;
      const on = shown > 0.015;
      if (glow.current) { glow.current.style.opacity = on ? String(Math.min(0.9, 0.2 + shown * 1.4)) : "0"; glow.current.style.transform = `scale(${0.7 + shown * 0.9})`; }
      if (ring.current) { ring.current.style.opacity = on ? String(Math.min(0.8, shown * 1.6)) : "0"; ring.current.style.transform = `scale(${0.8 + shown * 1.1})`; }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, []);
  const base: CSSProperties = { position: "absolute", left: "50%", top: "50%", width: "56vmin", height: "56vmin", marginLeft: "-28vmin", marginTop: "-28vmin", borderRadius: "50%", opacity: 0, willChange: "transform, opacity" };
  return (
    <div aria-hidden style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 5, mixBlendMode: "screen" }}>
      <div ref={glow} style={{ ...base, background: "radial-gradient(circle, rgba(120,220,255,.55) 0%, rgba(120,220,255,.18) 45%, transparent 70%)" }} />
      <div ref={ring} style={{ ...base, border: "2px solid rgba(160,235,255,.7)" }} />
    </div>
  );
}
