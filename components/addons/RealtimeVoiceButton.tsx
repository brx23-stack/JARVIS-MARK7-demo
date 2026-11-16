"use client";
import { useEffect, useState, type CSSProperties } from "react";
import { voiceSession } from "@/lib/realtime/voiceSession";

type Snap = Parameters<Parameters<typeof voiceSession.subscribe>[0]>[0];

const btn: CSSProperties = {
  background: "rgba(0,0,0,.65)", color: "#ffd9a0", border: "1px solid rgba(255,200,120,.45)",
  borderRadius: 6, padding: "6px 10px", fontFamily: "monospace", fontSize: 12, cursor: "pointer",
};

export default function RealtimeVoiceButton() {
  const [s, setS] = useState<Snap>({ state: "idle", detail: "", damage: true, lastDamage: "" });
  const [android, setAndroid] = useState("off");
  useEffect(() => voiceSession.subscribe(setS), []);

  const live = s.state === "live" || s.state === "connecting";
  const androidCall = async (action: string, minutes?: number) => {
    const r = await fetch("/api/android/control", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, minutes }) });
    const j = await r.json().catch(() => ({}));
    setAndroid(r.ok ? (j.armed ? `armed ${j.minutesLeft}m` : "off") : j.error || "error");
  };

  return (
    <div style={{ position: "fixed", left: 12, bottom: 12, zIndex: 50, display: "flex", flexDirection: "column", gap: 6, maxWidth: 260 }}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <button style={btn} onClick={() => (live ? voiceSession.stop() : voiceSession.start())}>
          {s.state === "connecting" ? "CONNECTING…" : live ? "■ VOICE" : "🎙 VOICE"}
        </button>
        <button style={btn} onClick={() => voiceSession.setDamage(!s.damage)}>DAMAGE {s.damage ? "ON" : "OFF"}</button>
        <button style={{ ...btn, color: "#ff8080" }} onClick={() => voiceSession.kill()}>KILL VOICE</button>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <button style={btn} onClick={() => androidCall("arm", 10)}>ARM ANDROID 10m</button>
        <button style={btn} onClick={() => androidCall("disarm")}>DISARM</button>
        <button style={{ ...btn, color: "#ff8080" }} onClick={() => androidCall("kill")}>KILL ANDROID</button>
      </div>
      <div style={{ color: "#ffd9a0", fontFamily: "monospace", fontSize: 11, opacity: 0.8 }}>
        voice: {s.state}{s.detail ? ` (${s.detail})` : ""}{s.lastDamage ? ` · ${s.lastDamage}` : ""} · android: {android}
      </div>
    </div>
  );
}
