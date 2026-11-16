"use client";
import { useEffect } from "react";

/** Registers the service worker so JARVIS can be installed to the home screen and show approval alerts. */
export default function PwaRegister() {
  useEffect(() => {
    if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => { /* needs https or localhost; ignore otherwise */ });
    }
  }, []);
  return null;
}
