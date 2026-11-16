"use client";
import OrbAudioGlow from "./OrbAudioGlow";
import RealtimeVoiceButton from "./RealtimeVoiceButton";
import AutocoderPanel from "./AutocoderPanel";
import PwaRegister from "./PwaRegister";

/** Everything the add-ons draw on screen. Mounted by app/template.tsx. */
export default function AddonsHost() {
  return (<><OrbAudioGlow /><RealtimeVoiceButton /><AutocoderPanel /><PwaRegister /></>);
}
