"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import CommandCenter, { type JarvisMode } from "@/components/CommandCenter";
import ErrorBoundary from "@/components/commandcenter/ErrorBoundary";
import Toaster from "@/components/commandcenter/Toaster";
import {
  createOrbScene,
  type OrbSceneApi,
  type OrbTheme,
  type VoiceState,
  type PerformanceMode,
} from "@/lib/orbScene";
import { HandTracker, type TrackerStatus, type TrackingQuality } from "@/lib/handTracker";
import { VoiceListener, WakeWordListener, isVoiceSupported } from "@/lib/voice/speechRecognition";
import { resolveBestTranscript } from "@/lib/molecule/chemistry";
import { findElement, type ElementData } from "@/lib/laboratory/elements";
import type { HandGestureEventDetail } from "@/lib/handTracker";
import {
  speak,
  speakAIResponse,
  cancelSpeech,
  preloadVoiceEngine,
  getVoiceEngineStatus,
  onVoiceReadinessChange,
  onVoiceEngineChange,
  checkOnlineTTSConfigured,
  type VoiceEngine,
  type EngineReadiness,
} from "@/lib/voice/voiceRouter";
import { detectPlatform } from "@/lib/voice/platform";
import type { RemoteCommand } from "@/lib/remote/types";
import {
  detectDeviceMode,
  isFullscreenActive,
  isFullscreenSupported,
  toggleFullscreen,
} from "@/lib/deviceMode";

type CameraState = "off" | "starting" | "on" | "error";
type ChatMessage = { role: "user" | "assistant"; content: string };
// Display-only variant of ChatMessage — carries which tools JARVIS used to
// produce a given reply (for the AI COMMUNICATIONS panel). Never sent back
// to /api/chat: historyRef stays plain ChatMessage[] so the request body
// shape is unchanged.
type DisplayMessage = ChatMessage & { toolsUsed?: string[] };
type Memory = Record<string, string>;
type StockPoint = { date: string; open: number; high: number; low: number; close: number; volume: number | null };
type StockRange = "1d" | "5d" | "1mo" | "3mo" | "6mo" | "1y";
type StockData = {
  ticker: string;
  name: string;
  currency: string;
  exchange: string;
  range: StockRange;
  interval: string;
  points: StockPoint[];
  latest: number;
  previousClose: number;
  change: number;
  changePercent: number;
  marketState: string;
  fetchedAt: string;
};
type StockQuote = {
  latest: number;
  change: number;
  changePercent: number;
  marketState: string;
  fetchedAt: string;
};
const STOCK_RANGES: { key: StockRange; label: string }[] = [
  { key: "1d", label: "1D" },
  { key: "5d", label: "5D" },
  { key: "1mo", label: "1M" },
  { key: "3mo", label: "3M" },
  { key: "6mo", label: "6M" },
  { key: "1y", label: "1Y" },
];
// Live price polling cadence. Only runs while the tab is visible and the
// market is actually open, so it doesn't hammer the upstream API for a
// closed market or a backgrounded tab.
const STOCK_QUOTE_POLL_MS = 15_000;

// Any of these keys can be entered in the AI CONNECTION popup — whichever
// one is connected becomes the active provider for /api/chat. Keys are
// never entered in a file; they're POSTed to /api/key and held only in
// server memory (see lib/serverKey.ts).
type ProviderId = "groq" | "nvidia" | "gemini" | "openai" | "anthropic" | "ollama";
const PROVIDERS: { id: ProviderId; label: string }[] = [
  { id: "groq", label: "GROQ" },
  { id: "nvidia", label: "NVIDIA" },
  { id: "gemini", label: "GEMINI" },
  { id: "openai", label: "OPENAI" },
  { id: "anthropic", label: "CLAUDE" },
  { id: "ollama", label: "OLLAMA" },
];
const PROVIDER_LABEL: Record<ProviderId, string> = {
  groq: "GROQ",
  nvidia: "NVIDIA",
  gemini: "GEMINI",
  openai: "OPENAI",
  anthropic: "CLAUDE",
  ollama: "OLLAMA",
};
type ProviderStatus = Record<ProviderId, boolean>;
const EMPTY_PROVIDER_STATUS: ProviderStatus = {
  groq: false,
  nvidia: false,
  gemini: false,
  openai: false,
  anthropic: false,
  ollama: false,
};

const MAX_HISTORY = 20;

// Cheap keyword/punctuation heuristic to pick a delivery tone for the AI's
// spoken reply — no extra model call, just pattern-matching the reply text
// the chat route already returned. Deliberately conservative: defaults to
// "neutral" unless something clearly warrants otherwise.
function estimateTone(text: string): "neutral" | "urgent" | "calm" {
  const lower = text.toLowerCase();
  if (/\b(warning|urgent|emergency|immediately|critical|alert|danger)\b/.test(lower) || /!{1,}/.test(text)) {
    return "urgent";
  }
  if (/\b(relax|don't worry|take your time|no rush|all is well|everything's fine)\b/.test(lower)) {
    return "calm";
  }
  return "neutral";
}
const THEME_STORAGE_KEY = "jarvis-mark7-theme";
const MEMORY_STORAGE_KEY = "jarvis-mark7-memory";
const CUSTOM_COLOR_STORAGE_KEY = "jarvis-mark7-custom-color";
const STOCK_WATCHLIST_KEY = "jarvis-mark7-stock-watchlist";
const STOCK_ACTIVE_KEY = "jarvis-mark7-stock-active";

const PERFORMANCE_LABEL: Record<PerformanceMode, string> = { auto: "AUTO", high: "HIGH", medium: "MEDIUM", low: "LOW" };

const THEMES: Record<OrbTheme, { label: string; hex: string }> = {
  blue: { label: "BLUE/CYAN", hex: "#00d9ff" },
  amber: { label: "AMBER", hex: "#ffaa30" },
  green: { label: "GREEN", hex: "#39ff88" },
  purple: { label: "PURPLE", hex: "#c56bff" },
  red: { label: "RED", hex: "#ff4f6d" },
};

const MODE_LABEL: Record<TrackerStatus["mode"], string> = {
  idle: "STANDBY",
  spin: "SPIN",
  zoom: "ZOOM",
};

const VOICE_LABEL: Record<VoiceState, string> = {
  idle: "HEY JARVIS",
  listening: "LISTENING…",
  thinking: "THINKING…",
  speaking: "SPEAKING…",
};

function loadMemory(): Memory {
  try {
    const raw = window.localStorage.getItem(MEMORY_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveMemory(memory: Memory) {
  try {
    window.localStorage.setItem(MEMORY_STORAGE_KEY, JSON.stringify(memory));
  } catch {
    // Local memory is best-effort when browser storage is unavailable.
  }
}

function isSecretMemory(text: string): boolean {
  return /\b(api\s*key|password|passcode|token|secret|credential|auth|authentication)\b/i.test(text);
}

function normalizeHex(value: string): string | null {
  const match = value.trim().match(/^#?([0-9a-f]{6})$/i);
  return match ? `#${match[1].toUpperCase()}` : null;
}

function parseRgb(value: string): string | null {
  const match = value.match(/\b(?:rgb\s*)?(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})\b/i);
  if (!match) return null;
  const [r, g, b] = match.slice(1).map(Number);
  if ([r, g, b].some((n) => n < 0 || n > 255)) return null;
  return `#${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

function colorName(text: string): OrbTheme | null {
  const t = text.toLowerCase();
  if (/\bblue\b|\bcyan\b/.test(t)) return "blue";
  if (/\bamber\b|\borange\b/.test(t)) return "amber";
  if (/\bgreen\b/.test(t)) return "green";
  if (/\bpurple\b|\bviolet\b/.test(t)) return "purple";
  if (/\bred\b/.test(t)) return "red";
  return null;
}

function elementColorTarget(text: string): ElementData | null {
  const raw = text.trim();

  // Exact element name/symbol: "oxygen", "carbon", "O", "Fe", etc.
  const exact = findElement(raw);
  if (exact) return exact;

  // Explicit Orb/color intent: "change orb to oxygen", "make the orb carbon",
  // "set orb colour to Fe", etc. This deliberately avoids hijacking normal
  // chemistry questions such as "what is oxygen?".
  const match = raw.match(
    /\b(?:change|set|make|switch)\b.*?\b(?:orb|colour|color|visual(?:s)?|theme)\b.*?\b(?:to|as)?\s*([A-Za-z]{1,20})\b/i
  ) ?? raw.match(
    /\b(?:change|set|make|switch)\b.*?\b([A-Za-z]{1,20})\b.*?\b(?:orb|colour|color|visual(?:s)?|theme)\b/i
  );
  if (!match) return null;
  return findElement(match[1]);
}

export default function JarvisOrb() {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<OrbSceneApi | null>(null);
  const trackerRef = useRef<HandTracker | null>(null);
  const listenerRef = useRef<VoiceListener | null>(null);
  const wakeListenerRef = useRef<WakeWordListener | null>(null);
  const historyRef = useRef<ChatMessage[]>([]);
  const apiKeyInputRef = useRef<HTMLInputElement>(null);

  const [camera, setCamera] = useState<CameraState>("off");
  const [status, setStatus] = useState<TrackerStatus>({ hands: 0, mode: "idle" });
  const [error, setError] = useState<string | null>(null);
  const [voiceState, setVoiceStateLocal] = useState<VoiceState>("idle");
  const [transcript, setTranscript] = useState("");
  const [reply, setReplyState] = useState("");
  // Mirrors `reply` synchronously (not via a useEffect) so code that awaits
  // an async command and then immediately needs the latest reply text -
  // e.g. remote command result delivery - never reads a stale value because
  // it ran before React had a chance to flush the effect.
  const replyRef = useRef("");
  const setReply = useCallback((value: string) => {
    replyRef.current = value;
    setReplyState(value);
  }, []);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [wakeEnabled, setWakeEnabled] = useState(true);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const [voiceEngine, setVoiceEngine] = useState<VoiceEngine | null>(null);
  const [voiceReadiness, setVoiceReadiness] = useState<EngineReadiness>("loading");
  const [theme, setTheme] = useState<OrbTheme>("amber");
  const [customColor, setCustomColor] = useState<string | null>(null);
  const [aiOnline, setAiOnline] = useState(false);
  const [jarvisAuthenticated, setJarvisAuthenticated] = useState(false);
  const [apiPopupOpen, setApiPopupOpen] = useState(false);
  const [apiBusy, setApiBusy] = useState(false);
  const [apiMessage, setApiMessage] = useState("");
  const [providerStatus, setProviderStatus] = useState<ProviderStatus>(EMPTY_PROVIDER_STATUS);
  const [activeProvider, setActiveProvider] = useState<ProviderId | null>(null);
  const activeProviderRef = useRef(activeProvider);
  useEffect(() => {
    activeProviderRef.current = activeProvider;
  }, [activeProvider]);
  const [selectedProvider, setSelectedProvider] = useState<ProviderId>("groq");
  const selectedProviderRef = useRef(selectedProvider);
  useEffect(() => {
    selectedProviderRef.current = selectedProvider;
  }, [selectedProvider]);
  const [diagnostics, setDiagnostics] = useState<string[] | null>(null);
  const [memory, setMemory] = useState<Memory>({});
  const [desktopMode, setDesktopMode] = useState(false);
  const [fullscreenSupported, setFullscreenSupported] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [performanceMode, setPerformanceMode] = useState<PerformanceMode>("auto");
  const [autoQuality, setAutoQuality] = useState<TrackingQuality>("high");
  const [fps, setFps] = useState(60);
  const [remoteSource, setRemoteSource] = useState<RemoteCommand["source"] | null>(null);
  // The atom/molecule visualization still lives inside the same orb scene
  // (lib/orbScene.ts); `mode` only controls which presentation overlay is visible.

  const [commandInput, setCommandInput] = useState("");
  const [chatMessages, setChatMessages] = useState<DisplayMessage[]>([]);
  const [stockWatchlist, setStockWatchlist] = useState<string[]>([]);
  const [activeStock, setActiveStock] = useState<string | null>(null);
  const [stockData, setStockData] = useState<StockData | null>(null);
  const [stockLoading, setStockLoading] = useState(false);
  const [stockError, setStockError] = useState<string | null>(null);
  const [stockInput, setStockInput] = useState("");
  const [stockRange, setStockRange] = useState<StockRange>("1mo");
  const [mode, setMode] = useState<JarvisMode>("orb");
  const [modeMenuOpen, setModeMenuOpen] = useState(false);
  const modeSelectorRef = useRef<HTMLDivElement>(null);
  const remoteSourceTimerRef = useRef<number | null>(null);

  // Mirrors of state that's read only inside the rarely-invoked diagnostics
  // command. Reading these via ref (instead of putting the state itself in
  // a useCallback's dependency array) keeps localCommand/askAI/handleWake
  // stable. fps in particular changes every second forever — if it were a
  // real dependency, every callback downstream of it (including handleWake)
  // would get a new identity every second, which tears down and relaunches
  // the background wake-word SpeechRecognition on the same cadence and
  // never lets it run long enough to catch "Hey Jarvis".
  const performanceModeRef = useRef<PerformanceMode>(performanceMode);
  const fpsRef = useRef(fps);
  const voiceEngineRef = useRef<VoiceEngine | null>(voiceEngine);
  const voiceReadinessRef = useRef<EngineReadiness>(voiceReadiness);
  useEffect(() => {
    performanceModeRef.current = performanceMode;
  }, [performanceMode]);
  useEffect(() => {
    fpsRef.current = fps;
  }, [fps]);
  useEffect(() => {
    voiceEngineRef.current = voiceEngine;
  }, [voiceEngine]);
  useEffect(() => {
    voiceReadinessRef.current = voiceReadiness;
  }, [voiceReadiness]);

  const themeColor = THEMES[theme].hex;

  useEffect(() => {
    document.documentElement.style.setProperty("--theme", themeColor);
  }, [themeColor]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STOCK_WATCHLIST_KEY);
      const saved = raw ? JSON.parse(raw) : [];
      const list = Array.isArray(saved)
        ? saved.filter((value): value is string => typeof value === "string").map((value) => value.toUpperCase())
        : [];
      const active = window.localStorage.getItem(STOCK_ACTIVE_KEY);
      setStockWatchlist([...new Set(list)]);
      setActiveStock(active && list.includes(active) ? active : list[0] || null);
    } catch {
      setStockWatchlist([]);
      setActiveStock(null);
    }
  }, []);

  useEffect(() => {
    if (!activeStock) {
      setStockData(null);
      return;
    }
    let cancelled = false;
    setStockLoading(true);
    setStockError(null);
    fetch(`/api/stocks?ticker=${encodeURIComponent(activeStock)}&range=${stockRange}`, { cache: "no-store" })
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body?.error || "Market data unavailable");
        return body as StockData;
      })
      .then((data) => {
        if (!cancelled) setStockData(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setStockError(err instanceof Error ? err.message : "Market data unavailable");
      })
      .finally(() => {
        if (!cancelled) setStockLoading(false);
      });
    try { window.localStorage.setItem(STOCK_ACTIVE_KEY, activeStock); } catch {}
    return () => { cancelled = true; };
  }, [activeStock, stockRange]);

  // Live price polling: a cheap quote-only ping that updates just the
  // latest price/change without re-pulling the whole candle history. Only
  // runs when a stock is active, the market is open, and the tab is
  // visible - otherwise it's wasted requests against Yahoo's endpoint.
  useEffect(() => {
    if (!activeStock || !stockData) return;
    if (stockData.marketState !== "REGULAR" && stockData.marketState !== "PRE" && stockData.marketState !== "POST") return;

    let cancelled = false;
    const poll = () => {
      if (document.hidden) return;
      fetch(`/api/stocks?ticker=${encodeURIComponent(activeStock)}&quote=1`, { cache: "no-store" })
        .then(async (res) => {
          const body = await res.json();
          if (!res.ok) throw new Error(body?.error || "quote failed");
          return body as StockQuote;
        })
        .then((quote) => {
          if (cancelled) return;
          setStockData((current) => {
            if (!current || current.ticker !== activeStock) return current;
            return { ...current, latest: quote.latest, change: quote.change, changePercent: quote.changePercent, marketState: quote.marketState, fetchedAt: quote.fetchedAt };
          });
        })
        .catch(() => {
          // Silent - a missed live-price tick isn't worth surfacing an
          // error over when the last known price is still shown.
        });
    };
    const id = window.setInterval(poll, STOCK_QUOTE_POLL_MS);
    return () => { cancelled = true; window.clearInterval(id); };
  }, [activeStock, stockData?.ticker, stockData?.marketState]);

  const addStock = useCallback(() => {
    const ticker = stockInput.trim().toUpperCase();
    if (!/^[A-Z0-9][A-Z0-9._-]{0,19}$/.test(ticker)) return;
    setStockWatchlist((current) => {
      const next = current.includes(ticker) ? current : [...current, ticker];
      try { window.localStorage.setItem(STOCK_WATCHLIST_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
    setActiveStock(ticker);
    setStockInput("");
  }, [stockInput]);

  const removeStock = useCallback((ticker: string) => {
    setStockWatchlist((current) => {
      const next = current.filter((item) => item !== ticker);
      try { window.localStorage.setItem(STOCK_WATCHLIST_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
    setActiveStock((current) => current === ticker ? null : current);
  }, []);


  const pushVoiceState = useCallback((state: VoiceState) => {
    setVoiceStateLocal(state);
    sceneRef.current?.setVoiceState(state);
  }, []);

  const applyTheme = useCallback((next: OrbTheme) => {
    setTheme(next);
    setCustomColor(null);
    sceneRef.current?.setTheme(next);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
      window.localStorage.removeItem(CUSTOM_COLOR_STORAGE_KEY);
    } catch {
      // Persistence is best-effort.
    }
    trackerRef.current?.setThemeColor(THEMES[next].hex);
  }, []);

  const applyCustomColor = useCallback((hex: string) => {
    sceneRef.current?.setCustomColor(hex);
    setCustomColor(hex);
    try {
      window.localStorage.setItem(CUSTOM_COLOR_STORAGE_KEY, hex);
      window.localStorage.removeItem(THEME_STORAGE_KEY);
    } catch {
      // Persistence is best-effort.
    }
    document.documentElement.style.setProperty("--theme", hex);
    trackerRef.current?.setThemeColor(hex);
  }, []);

  const refreshApiStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/key", { cache: "no-store" });
      const data = await res.json();
      const configured: ProviderStatus = {
        groq: Boolean(data.configured?.groq),
        nvidia: Boolean(data.configured?.nvidia),
        gemini: Boolean(data.configured?.gemini),
        openai: Boolean(data.configured?.openai),
        anthropic: Boolean(data.configured?.anthropic),
        ollama: Boolean(data.configured?.ollama),
      };
      const active: ProviderId | null =
        data.active && PROVIDERS.some((p) => p.id === data.active) ? data.active : null;
      setProviderStatus(configured);
      setActiveProvider(active);
      const connected = Boolean(active);
      setAiOnline(connected);
      return connected;
    } catch {
      setAiOnline(false);
      return false;
    }
  }, []);

  const openApiPopup = useCallback(() => {
    setApiMessage("");
    setSelectedProvider((prev) => activeProviderRef.current ?? prev);
    setApiPopupOpen(true);
    window.setTimeout(() => apiKeyInputRef.current?.focus(), 50);
  }, []);

  const connectApiKey = useCallback(async () => {
    const input = apiKeyInputRef.current;
    const key = input?.value.trim() ?? "";
    if (selectedProvider !== "ollama" && !key) {
      setApiMessage("INVALID API KEY");
      return;
    }

    setApiBusy(true);
    setApiMessage("VALIDATING…");
    try {
      const res = await fetch("/api/key", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key: selectedProvider === "ollama" ? undefined : key, provider: selectedProvider }),
      });
      const data = await res.json();
      if (!res.ok) {
        setApiMessage(String(data.error || "INVALID API KEY").toUpperCase());
        return;
      }
      if (input) input.value = "";
      setProviderStatus((prev) => ({ ...prev, [selectedProvider]: true }));
      setActiveProvider(data.active ?? selectedProvider);
      setAiOnline(true);
      setApiPopupOpen(false);
      setApiMessage("");
      const label = PROVIDER_LABEL[selectedProvider];
      // A "warning" means the key was saved but the live check that
      // normally confirms it couldn't complete (network blip on our end,
      // not a rejected key) - say so instead of claiming full confidence.
      if (data.warning) {
        setReply("JARVIS ONLINE");
        speak(`Jarvis online. Could not confirm the connection just now, so it'll be checked on your first message.`, {
          onStart: () => pushVoiceState("speaking"),
          onEnd: () => pushVoiceState("idle"),
        });
      } else {
        setReply("JARVIS ONLINE");
        speak("Jarvis online.", {
          onStart: () => pushVoiceState("speaking"),
          onEnd: () => pushVoiceState("idle"),
        });
      }
    } catch {
      setApiMessage("AI CONNECTION UNAVAILABLE");
    } finally {
      setApiBusy(false);
    }
  }, [pushVoiceState, selectedProvider]);

  const removeApiKey = useCallback(
    async (providerOverride?: ProviderId) => {
      // Voice command ("remove my api key") targets whichever provider is
      // actually active; the popup's REMOVE button targets whichever tab
      // is currently selected there.
      const target = providerOverride ?? activeProviderRef.current ?? selectedProviderRef.current;
      try {
        const res = await fetch("/api/key", {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ provider: target }),
        });
        const data = await res.json().catch(() => null);
        setProviderStatus((prev) => ({ ...prev, [target]: false }));
        const active: ProviderId | null =
          data?.active && PROVIDERS.some((p) => p.id === data.active) ? data.active : null;
        setActiveProvider(active);
        setAiOnline(Boolean(active));
      } finally {
        setApiMessage(`${PROVIDER_LABEL[target]} API KEY REMOVED`);
        speak(`${PROVIDER_LABEL[target]} API key removed. Local commands remain active.`, {
          onStart: () => pushVoiceState("speaking"),
          onEnd: () => pushVoiceState("idle"),
        });
      }
    },
    [pushVoiceState],
  );

  const applyPerformanceMode = useCallback((mode: PerformanceMode) => {
    setPerformanceMode(mode);
    if (mode === "auto") {
      setAutoQuality("high");
      sceneRef.current?.setPerformanceMode("high");
      trackerRef.current?.setTrackingQuality("high");
    } else {
      sceneRef.current?.setPerformanceMode(mode);
      trackerRef.current?.setTrackingQuality(mode as TrackingQuality);
      setAutoQuality(mode as TrackingQuality);
    }
  }, []);

  const switchMode = useCallback((nextMode: JarvisMode) => {
    const scene = sceneRef.current;
    if (nextMode === "molecule") {
      if (scene && !scene.isMoleculeModeActive()) scene.enterMoleculeMode();
    } else if (scene?.isMoleculeModeActive()) {
      scene.exitMoleculeMode();
    }
    setMode(nextMode);
    setModeMenuOpen(false);
  }, []);

  useEffect(() => {
    if (mode === "commandCenter") setModeMenuOpen(false);
  }, [mode]);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (!modeSelectorRef.current?.contains(event.target as Node)) {
        setModeMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, []);

  const localCommand = useCallback(
    async (text: string): Promise<boolean> => {
      const raw = text.trim();
      const t = raw.toLowerCase();

      // The monitoring dashboard is intentionally a secondary mode. The
      // default screen stays focused on the orb, while voice/text commands
      // can bring the full stock + telemetry workspace in and out.
      if (/\b(?:activate|open|show|launch)\s+(?:the\s+)?dashboard\b/i.test(raw)) {
        switchMode("dashboard");
        setReply("DASHBOARD ACTIVATED");
        speak("Dashboard activated.", {
          onStart: () => pushVoiceState("speaking"),
          onEnd: () => pushVoiceState("idle"),
        });
        return true;
      }

      if (/\b(?:deactivate|close|hide|exit|disable)\s+(?:the\s+)?dashboard\b/i.test(raw)) {
        switchMode("orb");
        setReply("RETURNING TO ORB VIEW");
        speak("Dashboard closed. Returning to orb view.", {
          onStart: () => pushVoiceState("speaking"),
          onEnd: () => pushVoiceState("idle"),
        });
        return true;
      }

      const performanceMatch = t.match(/\b(?:use|switch to|set|enable)\s+(automatic|auto|high|medium|low)\s+performance(?:\s+mode)?\b|\b(?:automatic|auto|high|medium|low)\s+performance(?:\s+mode)?\b/);
      if (performanceMatch) {
        const requested = performanceMatch[1] || performanceMatch[0].split(/\s+/)[0];
        const mode: PerformanceMode = requested.startsWith("auto") ? "auto" : requested as PerformanceMode;
        applyPerformanceMode(mode);
        const confirmation = mode === "auto" ? "Automatic performance mode activated." : `${mode[0].toUpperCase()}${mode.slice(1)} performance mode activated.`;
        setReply(`PERFORMANCE: ${PERFORMANCE_LABEL[mode]}`);
        speak(confirmation, { onStart: () => pushVoiceState("speaking"), onEnd: () => pushVoiceState("idle") });
        return true;
      }

      // Theme commands are intentionally local and never reach the AI provider.
      const namedTheme = colorName(t);
      const hasThemeIntent = /\b(use|switch to|change to|make yourself|set the colou?r|change the colou?r|colou?r)\b/.test(t);
      if (hasThemeIntent && namedTheme) {
        applyTheme(namedTheme);
        setReply(`VISUAL MODE: ${THEMES[namedTheme].label}`);
        speak(`Visual mode set to ${THEMES[namedTheme].label.toLowerCase()}.`, {
          onStart: () => pushVoiceState("speaking"),
          onEnd: () => pushVoiceState("idle"),
        });
        return true;
      }

      const hexMatch = raw.match(/#([0-9a-f]{6})\b/i);
      if (hasThemeIntent && hexMatch) {
        const hex = normalizeHex(hexMatch[0]);
        if (hex) {
          // Custom colors use the same real Three.js material update path.
          applyCustomColor(hex);
          setReply(`VISUAL MODE: ${hex}`);
          speak(`Custom visual color applied.`, {
            onStart: () => pushVoiceState("speaking"),
            onEnd: () => pushVoiceState("idle"),
          });
          return true;
        }
      }

      const rgb = parseRgb(raw);
      if (hasThemeIntent && rgb) {
        applyCustomColor(rgb);
        setReply(`VISUAL MODE: ${rgb}`);
        speak(`Custom visual color applied.`, {
          onStart: () => pushVoiceState("speaking"),
          onEnd: () => pushVoiceState("idle"),
        });
        return true;
      }

      if (/\b(?:use|switch(?:\s+to)?|activate)\s+ollama\b/i.test(raw)) {
        try {
          const res = await fetch("/api/key", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ provider: "ollama" }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || "Ollama unavailable");
          setProviderStatus((prev) => ({ ...prev, ollama: true }));
          setActiveProvider("ollama");
          setAiOnline(true);
          setReply("AI ONLINE · OLLAMA");
          speak("Ollama is now active.", { onStart: () => pushVoiceState("speaking"), onEnd: () => pushVoiceState("idle") });
        } catch {
          setReply("OLLAMA OFFLINE");
          speak("Ollama is not available. Start Ollama on this computer first.", { onStart: () => pushVoiceState("speaking"), onEnd: () => pushVoiceState("idle") });
        }
        return true;
      }

      if (/\b(?:change|choose|switch)\s+(?:the\s+)?ai\b|\bai\s+(?:provider|settings)\b/i.test(raw)) {
        openApiPopup();
        setReply("AI PROVIDER SETTINGS");
        speak("Opening AI provider settings.", { onStart: () => pushVoiceState("speaking"), onEnd: () => pushVoiceState("idle") });
        return true;
      }

      if (/\b(change|update|set)\b.*\bmy\b.*\bapi\s*key\b|\bchange\s+my\s+api\s*key\b/i.test(raw)) {
        openApiPopup();
        setReply("AI CONNECTION");
        speak("Opening the AI connection panel.", {
          onStart: () => pushVoiceState("speaking"),
          onEnd: () => pushVoiceState("idle"),
        });
        return true;
      }

      if (/\b(remove|delete|clear)\b.*\bmy\b.*\bapi\s*key\b/i.test(raw)) {
        await removeApiKey();
        return true;
      }

      if (/\bclear\s+(the\s+)?conversation\b/i.test(raw)) {
        historyRef.current = [];
        setTranscript("");
        setReply("");
        speak("Conversation cleared.", {
          onStart: () => pushVoiceState("speaking"),
          onEnd: () => pushVoiceState("idle"),
        });
        return true;
      }

      if (/\b(show|display|read)\b.*\bmy\b.*\bmemory\b|\bshow\s+memory\b/i.test(raw)) {
        const current = loadMemory();
        setMemory(current);
        const entries = Object.entries(current);
        const spoken = entries.length
          ? entries.map(([k, v]) => `${k} is ${v}`).join(". ")
          : "Your memory is empty.";
        setReply(entries.length ? entries.map(([k, v]) => `${k.toUpperCase()}: ${v}`).join(" · ") : "MEMORY EMPTY");
        speak(spoken, {
          onStart: () => pushVoiceState("speaking"),
          onEnd: () => pushVoiceState("idle"),
        });
        return true;
      }

      if (/\bclear\s+(my\s+)?memory\b/i.test(raw)) {
        setMemory({});
        saveMemory({});
        setReply("MEMORY CLEARED");
        speak("Memory cleared.", {
          onStart: () => pushVoiceState("speaking"),
          onEnd: () => pushVoiceState("idle"),
        });
        return true;
      }

      const forget = raw.match(/\bforget\s+(?:my\s+)?(.+?)(?:\s+please)?$/i);
      if (forget) {
        const key = forget[1].trim().toLowerCase().replace(/\s+/g, "_");
        const current = loadMemory();
        if (current[key]) {
          delete current[key];
          saveMemory(current);
          setMemory(current);
          setReply(`FORGOT: ${key.toUpperCase()}`);
          speak(`Forgot ${key.replace(/_/g, " ")}.`, {
            onStart: () => pushVoiceState("speaking"),
            onEnd: () => pushVoiceState("idle"),
          });
        } else {
          speak(`I don't have ${key.replace(/_/g, " ")} in memory.`, {
            onStart: () => pushVoiceState("speaking"),
            onEnd: () => pushVoiceState("idle"),
          });
        }
        return true;
      }

      const remember = raw.match(/\bremember\s+(?:that\s+)?my\s+(.+?)\s+is\s+(.+)$/i);
      if (remember) {
        const key = remember[1].trim().toLowerCase().replace(/\s+/g, "_");
        const value = remember[2].trim().slice(0, 200);
        if (isSecretMemory(`${key} ${value}`)) {
          setReply("CREDENTIALS ARE NOT STORED");
          speak("I cannot store passwords, API keys, tokens, or private credentials.", {
            onStart: () => pushVoiceState("speaking"),
            onEnd: () => pushVoiceState("idle"),
          });
          return true;
        }
        const current = loadMemory();
        current[key] = value;
        saveMemory(current);
        setMemory(current);
        setReply(`MEMORY UPDATED: ${key.toUpperCase()}`);
        speak(`I'll remember your ${key.replace(/_/g, " ")}.`, {
          onStart: () => pushVoiceState("speaking"),
          onEnd: () => pushVoiceState("idle"),
        });
        return true;
      }

      if (/\b(?:close|exit|leave)\b.*\b(?:molecule|atom|chemistry)\s+(?:mode|lab|laboratory)\b|\b(?:exit|close)\s+(?:molecule|atom)\s+mode\b/i.test(raw)) {
        sceneRef.current?.exitMoleculeMode();
        switchMode("orb");
        setReply("RETURNING TO ORB");
        speak("Returning to standard orb mode.", {
          onStart: () => pushVoiceState("speaking"),
          onEnd: () => pushVoiceState("idle"),
        });
        return true;
      }

      // Element → Orb colour bridge. The periodic-table database supplies
      // the assigned colour; the existing Orb colour engine does the actual
      // Three.js material update. This works for both typed commands and
      // speech transcripts because both enter localCommand().
      const elementTarget = elementColorTarget(raw);
      if (elementTarget) {
        applyCustomColor(elementTarget.color);
        setReply(`ELEMENT: ${elementTarget.name.toUpperCase()} · ${elementTarget.symbol} · ${elementTarget.color.toUpperCase()}`);
        speak(`${elementTarget.name}. Orb colour updated.`, {
          onStart: () => pushVoiceState("speaking"),
          onEnd: () => pushVoiceState("idle"),
        });
        return true;
      }

      const moleculeVoiceIntent = /\b(?:molecule|atom|element|electron|proton|neutron|bond|water|carbon dioxide|oxygen|methane|ammonia|aluminium oxide|aluminum oxide|h2o|co2|o2|ch4|nh3|al2o3)\b/i.test(raw) && /\b(?:add|remove|delete|take|subtract|create|build|load|make|construct|break|separate|split|rearrange|reorganize|scatter|validate|check|select|choose|inspect|show|open|launch|start|switch)\b/i.test(raw);
      const openLabIntent = /\b(?:open|launch|start|show)\b.*\b(?:molecule|atom|chemistry)\s+(?:lab|laboratory|mode)\b|\b(?:molecule|atom)\s+(?:lab|mode)\b/i.test(raw);

      if (moleculeVoiceIntent && !openLabIntent) {
        const respond = (text: string) => {
          setReply(text.toUpperCase());
          speak(text, { onStart: () => pushVoiceState("speaking"), onEnd: () => pushVoiceState("idle") });
        };
        if (!sceneRef.current?.isMoleculeModeActive()) {
          sceneRef.current?.enterMoleculeMode();
          switchMode("molecule");
        }
        const handled = sceneRef.current?.moleculeCommand(raw, respond) ?? false;
        if (handled) return true;
      }

      if (openLabIntent) {
        sceneRef.current?.enterMoleculeMode();
        switchMode("molecule");
        setReply("ATOM / MOLECULE MODE");
        speak("Switching JARVIS into atom and molecule mode.", {
          onStart: () => pushVoiceState("speaking"),
          onEnd: () => pushVoiceState("idle"),
        });
        return true;
      }

      if (/\brun\s+diagnostics\b|\bdiagnostics\b/i.test(raw)) {
        pushVoiceState("thinking");
        const api = await refreshApiStatus();
        const onlineTTSConfigured = await checkOnlineTTSConfigured();
        const webgl = (() => {
          try {
            const canvas = document.createElement("canvas");
            return Boolean(canvas.getContext("webgl2") || canvas.getContext("webgl"));
          } catch {
            return false;
          }
        })();
        const network = navigator.onLine;
        const mic = Boolean(navigator.mediaDevices?.getUserMedia);
        const voice = voiceSupported && "speechSynthesis" in window;
        const platform = detectPlatform();
        const perf = sceneRef.current?.getPerformanceInfo();
        const lines = [
          `DEVICE           ${platform === "ANDROID" ? "ANDROID" : desktopMode ? "DESKTOP" : "MOBILE"}`,
          `PLATFORM         ${platform}`,
          `PERFORMANCE      ${PERFORMANCE_LABEL[performanceModeRef.current]}`,
          `FPS              ${perf?.fps ?? fpsRef.current}`,
          `RENDER QUALITY   ${perf?.renderQuality ?? "UNKNOWN"}`,
          `AI CONNECTION    ${api ? "ONLINE" : "OFFLINE"}`,
          `API CONFIGURATION ${api ? "READY" : "MISSING"}`,
          `MICROPHONE       ${mic ? "READY" : "UNAVAILABLE"}`,
          `VOICE OUTPUT     ${voice ? "READY" : "UNAVAILABLE"}`,
          `VOICE ENGINE     ${voiceReadinessRef.current.toUpperCase()}`,
          `TTS ENGINE       BROWSER SPEECHSYNTHESIS`,
          `ONLINE TTS       ${onlineTTSConfigured ? "READY" : "UNAVAILABLE"}`,
          `LAST SPOKEN VIA  ${(voiceEngineRef.current ?? "NONE").toUpperCase()}`,
          `WEBGL            ${webgl ? "READY" : "UNAVAILABLE"}`,
          `THREE.JS         ${sceneRef.current ? "READY" : "FAILED"}`,
          `HAND TRACKING    ${camera === "on" ? "READY" : "STANDBY"}`,
          `NETWORK          ${network ? "ONLINE" : "OFFLINE"}`,
        ];
        setDiagnostics(lines);
        setReply("JARVIS DIAGNOSTICS");
        speak(lines.join(". "), {
          onStart: () => pushVoiceState("speaking"),
          onEnd: () => pushVoiceState("idle"),
        });
        return true;
      }

      return false;
    },
    [
      applyTheme,
      applyCustomColor,
      applyPerformanceMode,
      camera,
      desktopMode,
      openApiPopup,
      pushVoiceState,
      refreshApiStatus,
      removeApiKey,
      switchMode,
      voiceSupported,
    ],
  );

  const askAI = useCallback(
    async (text: string) => {
      const handled = await localCommand(text);
      if (handled) {
        // Local commands never reach the LLM, but they are still learning
        // experiences. Persist their input and outcome in the same offline
        // journal used by API-backed conversations.
        void fetch("/api/learning", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ input: text, output: replyRef.current }),
        }).catch(() => {});
        return;
      }

      if (!aiOnline) {
        setVoiceError("AI connection unavailable. Local commands remain active.");
        setReply("AI OFFLINE · LOCAL COMMANDS ACTIVE");
        pushVoiceState("idle");
        return;
      }

      pushVoiceState("thinking");
      setReply("");
      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ message: text, history: historyRef.current }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Request failed");

        // Plain role/content history — exactly what gets sent back to
        // /api/chat next turn. Kept separate from the display list below so
        // an extra display-only field never ends up in the request body.
        const nextHistory = [
          ...historyRef.current,
          { role: "user" as const, content: text },
          { role: "assistant" as const, content: data.reply },
        ].slice(-MAX_HISTORY);
        historyRef.current = nextHistory;

        const toolsUsed: string[] | undefined = Array.isArray(data.toolsUsed) ? data.toolsUsed : undefined;
        setChatMessages((prev) =>
          [
            ...prev,
            { role: "user" as const, content: text },
            { role: "assistant" as const, content: data.reply, toolsUsed },
          ].slice(-MAX_HISTORY),
        );

        setReply(data.reply);
        pushVoiceState("speaking");
        // AI-generated content → online voice if configured, transparently
        // falling back to the browser's default voice if it isn't reachable.
        void speakAIResponse(data.reply, { onEnd: () => pushVoiceState("idle") }, estimateTone(data.reply));
      } catch {
        setVoiceError("AI connection unavailable. Local commands remain active.");
        setReply("AI CONNECTION UNAVAILABLE");
        // Never leave the user without an audible response: speak a short
        // fallback via the browser's default voice, which works without
        // internet or an AI provider connected.
        pushVoiceState("speaking");
        speak("I'm unable to reach the AI service right now.", {
          onEnd: () => pushVoiceState("idle"),
        });
        await refreshApiStatus();
      }
    },
    [aiOnline, localCommand, pushVoiceState, refreshApiStatus],
  );

  const executeRemoteCommand = useCallback(
    async (command: RemoteCommand) => {
      // Remote commands deliberately enter the same askAI/localCommand path as
      // the orb. No remote-specific command implementations are duplicated.
      setRemoteSource(command.source);
      if (remoteSourceTimerRef.current) window.clearTimeout(remoteSourceTimerRef.current);
      remoteSourceTimerRef.current = window.setTimeout(() => {
        setRemoteSource(null);
        remoteSourceTimerRef.current = null;
      }, 4500);

      setTranscript(command.command);
      setReply("");
      setVoiceError(null);

      let failure = false;
      try {
        await askAI(command.command);
      } catch {
        failure = true;
      }

      // askAI/localCommand set the reply through the setReply() wrapper above,
      // which updates replyRef.current synchronously - so this always reflects
      // the actual outcome of the command that just finished, not a stale
      // value from before it ran.
      const finalReply = failure
        ? "REMOTE COMMAND FAILED"
        : replyRef.current || "Command processed.";
      void fetch("/api/remote/result", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: command.id,
          source: command.source,
          reply: finalReply,
          ok: !/unavailable|failed|offline/i.test(finalReply),
        }),
      }).catch(() => {});
    },
    [askAI],
  );

  const startListening = useCallback(() => {
    if (!voiceSupported) {
      setVoiceError("Voice isn't supported in this browser — try Chrome.");
      return;
    }
    wakeListenerRef.current?.stop();
    wakeListenerRef.current = null;
    cancelSpeech();
    setVoiceError(null);
    setTranscript("");
    setReply("");
    pushVoiceState("listening");

    const listener = new VoiceListener();
    listenerRef.current = listener;
    listener.start({
      onResult: (text, alternatives) => {
        const best = resolveBestTranscript(alternatives.length ? alternatives : [text]);
        setTranscript(best);
        if (best) void askAI(best);
        else pushVoiceState("idle");
      },
      onError: (message) => {
        setVoiceError(message);
        pushVoiceState("idle");
      },
      onEnd: () => {
        listenerRef.current = null;
      },
    });
  }, [askAI, pushVoiceState, voiceSupported]);

  const stopListening = useCallback(() => {
    listenerRef.current?.stop();
    listenerRef.current = null;
    pushVoiceState("idle");
  }, [pushVoiceState]);

  const toggleVoice = useCallback(() => {
    if (voiceState === "listening") stopListening();
    else if (voiceState === "idle") startListening();
    else {
      cancelSpeech();
      pushVoiceState("idle");
    }
  }, [voiceState, startListening, stopListening, pushVoiceState]);

  const handleWake = useCallback(
    (command: string, alternatives: string[]) => {
      const best = resolveBestTranscript(alternatives.length ? alternatives : [command]);
      wakeListenerRef.current = null;
      cancelSpeech();
      setVoiceError(null);
      setTranscript(best);
      setReply("");
      pushVoiceState("speaking");

      speak("Yes, Sir?", {
        onEnd: () => {
          if (best) void askAI(best);
          else startListening();
        },
      });
    },
    [askAI, startListening, pushVoiceState],
  );

  const stopGestures = useCallback(() => {
    trackerRef.current?.stop();
    trackerRef.current = null;
    setCamera("off");
    setStatus({ hands: 0, mode: "idle" });
  }, []);

  const startGestures = useCallback(async () => {
    const video = videoRef.current;
    const overlay = overlayRef.current;
    if (!video || !overlay || trackerRef.current) return;

    setCamera("starting");
    setError(null);
    const tracker = new HandTracker(video, overlay, {
      onRotate: (dt, dp) => sceneRef.current?.rotateBy(dt, dp),
      onZoom: (factor) => sceneRef.current?.zoomBy(factor),
      onStatus: setStatus,
    });
    tracker.setThemeColor(themeColor);
    tracker.setTrackingQuality(performanceMode === "auto" ? autoQuality : performanceMode as TrackingQuality);
    trackerRef.current = tracker;

    try {
      await tracker.start(desktopMode ? "desktop" : "mobile");
      setCamera("on");
    } catch (err) {
      trackerRef.current = null;
      tracker.stop();
      setCamera("error");
      setError(
        err instanceof DOMException && err.name === "NotAllowedError"
          ? "CAMERA ACCESS DENIED"
          : "TRACKING INIT FAILED",
      );
    }
  }, [autoQuality, desktopMode, performanceMode, themeColor]);

  const toggleGestures = useCallback(() => {
    if (trackerRef.current) stopGestures();
    else void startGestures();
  }, [startGestures, stopGestures]);

  const toggleMoleculeMode = useCallback(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    switchMode(scene.isMoleculeModeActive() ? "orb" : "molecule");
  }, [switchMode]);

  // Same `jarvis-hand-gesture` events that already drive pinch-to-grab in
  // molecule mode; HandTracker dispatches these unconditionally, so this
  // is the existing hand-tracking system, not a second one. The scene
  // itself no-ops these while it isn't in molecule mode.
  useEffect(() => {
    const onGesture = (event: Event) => {
      const detail = (event as CustomEvent<HandGestureEventDetail>).detail;
      sceneRef.current?.handleMoleculeGesture(detail, (text) => setReply(text.toUpperCase()));
    };
    window.addEventListener("jarvis-hand-gesture", onGesture);
    return () => window.removeEventListener("jarvis-hand-gesture", onGesture);
  }, [setReply]);

  const handleToggleFullscreen = useCallback(() => {
    void toggleFullscreen();
  }, []);

  useEffect(() => {
    // Warms up the browser's voice list asynchronously so it never blocks
    // the orb, hand tracking, or the microphone — speak() works fine even
    // before this resolves. Also subscribes to engine/readiness changes for
    // the HUD and diagnostics.
    setVoiceReadiness(getVoiceEngineStatus());
    preloadVoiceEngine();
    const unsubscribeEngine = onVoiceEngineChange(setVoiceEngine);
    const unsubscribeReadiness = onVoiceReadinessChange(setVoiceReadiness);
    return () => {
      unsubscribeEngine();
      unsubscribeReadiness();
    };
  }, []);

  useEffect(() => {
    setVoiceSupported(isVoiceSupported());
    setMemory(loadMemory());

    // Resolved once from the platform (not viewport width) so a desktop
    // browser being resized narrow — or a phone rotated to landscape —
    // never flips the mode. Android/mobile behavior is untouched either way.
    const mode = detectDeviceMode();
    const isDesktop = mode === "desktop";
    setDesktopMode(isDesktop);
    setFullscreenSupported(isFullscreenSupported());
    document.body.dataset.deviceMode = mode;

    let initialTheme: OrbTheme = "amber";
    let initialCustomColor: string | null = null;
    try {
      const saved = window.localStorage.getItem(THEME_STORAGE_KEY) as OrbTheme | null;
      const savedCustom = window.localStorage.getItem(CUSTOM_COLOR_STORAGE_KEY);
      if (saved && saved in THEMES) initialTheme = saved;
      if (savedCustom && normalizeHex(savedCustom)) initialCustomColor = normalizeHex(savedCustom);
    } catch {
      // Default remains amber.
    }

    const container = containerRef.current;
    if (!container) return;

    const scene = createOrbScene(container, { desktopMode: isDesktop });
    sceneRef.current = scene;
    scene.setTheme(initialTheme);
    setTheme(initialTheme);
    if (initialCustomColor) {
      scene.setCustomColor(initialCustomColor);
      setCustomColor(initialCustomColor);
      document.documentElement.style.setProperty("--theme", initialCustomColor);
    }

    // Authenticate the browser before touching any protected JARVIS API.
    // The server stores the credential only in an HttpOnly session cookie;
    // the token itself is never persisted in browser storage.
    void (async () => {
      try {
        let sessionRes = await fetch("/api/remote/session", { cache: "no-store" });
        if (sessionRes.status === 401) {
          const token = window.prompt("JARVIS access token:");
          if (!token) {
            setApiMessage("JARVIS AUTHENTICATION REQUIRED");
            return;
          }
          sessionRes = await fetch("/api/remote/session", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ token }),
          });
        }
        if (!sessionRes.ok) {
          const authError = await sessionRes.json().catch(() => null);
          setApiMessage(String(authError?.error || "JARVIS AUTHENTICATION FAILED").toUpperCase());
          return;
        }
        setJarvisAuthenticated(true);
      } catch {
        setApiMessage("JARVIS AUTHENTICATION UNAVAILABLE");
        return;
      }

      // Require a fresh key every time this page loads. Don't let a key
      // connected earlier in this server's uptime silently carry over —
      // clear it, then open the connection popup immediately so the key
      // has to be typed in again before AI features work.
      try {
        await fetch("/api/key", {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ provider: "groq" }),
        });
      } catch {
        // Best-effort — if this fails, refreshApiStatus below still runs.
      }
      await refreshApiStatus();
      openApiPopup();
    })();

    return () => {
      trackerRef.current?.stop();
      trackerRef.current = null;
      listenerRef.current?.stop();
      listenerRef.current = null;
      wakeListenerRef.current?.stop();
      wakeListenerRef.current = null;
      cancelSpeech();
      scene.dispose();
      sceneRef.current = null;
    };
  }, [openApiPopup, refreshApiStatus]);

  useEffect(() => {
    let lowSamples = 0;
    let highSamples = 0;
    let lastChange = 0;
    const timer = window.setInterval(() => {
      const info = sceneRef.current?.getPerformanceInfo();
      if (!info) return;
      setFps(info.fps);
      if (performanceMode !== "auto") return;

      const now = performance.now();
      if (info.fps < 45) { lowSamples++; highSamples = 0; }
      else if (info.fps > 55) { highSamples++; lowSamples = 0; }
      else { lowSamples = 0; highSamples = 0; }

      if (now - lastChange < 6000) return;
      if (lowSamples >= 3) {
        const next: TrackingQuality = autoQuality === "high" ? "medium" : autoQuality === "medium" ? "low" : "low";
        if (next !== autoQuality) {
          setAutoQuality(next);
          sceneRef.current?.setPerformanceMode(next);
          trackerRef.current?.setTrackingQuality(next);
          lastChange = now; lowSamples = 0; highSamples = 0;
        }
      } else if (highSamples >= 8) {
        const next: TrackingQuality = autoQuality === "low" ? "medium" : autoQuality === "medium" ? "high" : "high";
        if (next !== autoQuality) {
          setAutoQuality(next);
          sceneRef.current?.setPerformanceMode(next);
          trackerRef.current?.setTrackingQuality(next);
          lastChange = now; lowSamples = 0; highSamples = 0;
        }
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [autoQuality, performanceMode]);

  useEffect(() => {
    let disposed = false;
    let eventSource: EventSource | null = null;
    let reconnectTimer: number | null = null;

    const connect = async () => {
      if (disposed) return;
      try {
        const sessionRes = await fetch("/api/remote/session", { cache: "no-store" });
        const session = await sessionRes.json().catch(() => null);
        if (!session?.enabled) return;
      } catch {}
      if (disposed) return;

      eventSource = new EventSource("/api/remote/events");
      eventSource.addEventListener("command", (event) => {
        try {
          const announced = JSON.parse((event as MessageEvent).data) as RemoteCommand;
          if (!announced?.id || !announced?.command || !announced?.source) return;
          void fetch("/api/remote/events?id=" + encodeURIComponent(announced.id), {
            method: "POST",
          })
            .then((res) => res.ok ? res.json() : null)
            .then((data) => {
              const command = data?.command as RemoteCommand | null;
              if (command?.id) void executeRemoteCommand(command);
            })
            .catch(() => {});
        } catch (error) {
          console.error("[remote] invalid command event", error);
        }
      });
      eventSource.onerror = () => {
        eventSource?.close();
        if (!disposed) reconnectTimer = window.setTimeout(connect, 3000);
      };
    };

    void connect();
    return () => {
      disposed = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      eventSource?.close();
      if (remoteSourceTimerRef.current) window.clearTimeout(remoteSourceTimerRef.current);
    };
  }, [executeRemoteCommand, jarvisAuthenticated]);

  useEffect(() => {
    if (!voiceSupported || !wakeEnabled || voiceState !== "idle" || apiPopupOpen) return;

    const wake = new WakeWordListener();
    wakeListenerRef.current = wake;
    wake.start({
      onWake: handleWake,
      onError: (message) => {
        setVoiceError(message);
        setWakeEnabled(false);
      },
    });

    return () => {
      wake.stop();
      wakeListenerRef.current = null;
    };
  }, [apiPopupOpen, handleWake, voiceState, voiceSupported, wakeEnabled]);

  useEffect(() => {
    if (!desktopMode) return;
    const onFullscreenChange = () => setIsFullscreen(isFullscreenActive());
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, [desktopMode]);

  useEffect(() => {
    document.body.classList.toggle("jarvis-fullscreen", isFullscreen);
  }, [isFullscreen]);

  useEffect(() => {
    const KEY_ROTATE_STEP = 0.12;

    const onKey = (e: KeyboardEvent) => {
      // Don't hijack keystrokes while the person is typing — e.g. in the
      // API key field — where arrow keys must move the text cursor and
      // letters like "r"/"g"/"v"/"f" must type normally.
      const target = e.target as HTMLElement | null;
      const isTyping =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        Boolean(target?.isContentEditable);
      if (isTyping) return;

      if (e.key === "Escape") {
        setModeMenuOpen(false);
        return;
      }

      switch (e.key) {
        case "+":
        case "=":
          sceneRef.current?.zoomIn();
          break;
        case "-":
        case "_":
          sceneRef.current?.zoomOut();
          break;
        case "r":
        case "R":
          sceneRef.current?.resetView();
          break;
        case "g":
        case "G":
          toggleGestures();
          break;
        case "v":
        case "V":
          toggleVoice();
          break;
        case "ArrowLeft":
          if (desktopMode) {
            e.preventDefault();
            sceneRef.current?.rotateBy(-KEY_ROTATE_STEP, 0);
          }
          break;
        case "ArrowRight":
          if (desktopMode) {
            e.preventDefault();
            sceneRef.current?.rotateBy(KEY_ROTATE_STEP, 0);
          }
          break;
        case "ArrowUp":
          if (desktopMode) {
            e.preventDefault();
            sceneRef.current?.rotateBy(0, KEY_ROTATE_STEP);
          }
          break;
        case "ArrowDown":
          if (desktopMode) {
            e.preventDefault();
            sceneRef.current?.rotateBy(0, -KEY_ROTATE_STEP);
          }
          break;
        case "f":
        case "F":
          if (desktopMode && fullscreenSupported) handleToggleFullscreen();
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [desktopMode, fullscreenSupported, handleToggleFullscreen, toggleGestures, toggleVoice]);

  const cameraOn = camera === "on";

  return (
    <>
      <div ref={containerRef} className="orb-root" />

      <div className="overlay-vignette" />
      <div className="overlay-grain" />
      <div className="overlay-scanlines" />

      {mode !== "commandCenter" && (
      <div ref={modeSelectorRef} className="hud mode-selector">
        <button
          type="button"
          className="mode-selector-button"
          aria-expanded={modeMenuOpen}
          aria-haspopup="menu"
          onClick={() => setModeMenuOpen((open) => !open)}
        >
          MODES <span>▾</span> <strong>{mode === "commandCenter" ? "COMMAND CENTER" : mode === "molecule" ? "MOLECULE LAB" : mode.toUpperCase()}</strong>
        </button>
        {modeMenuOpen && (
          <div className="mode-menu" role="menu">
            {([
              ["orb", "Orb"],
              ["dashboard", "Dashboard"],
              ["molecule", "Molecule Lab"],
              ["commandCenter", "Command Center"],
            ] as const).map(([value, label]) => (
              <button key={value} type="button" role="menuitem" className={mode === value ? "active" : ""} onClick={() => switchMode(value)}>
                <span>{mode === value ? "●" : "○"}</span>{label}
              </button>
            ))}
          </div>
        )}
      </div>
      )}

      {mode === "commandCenter" && (
        <ErrorBoundary onExit={() => switchMode("orb")}>
        <Toaster />
        <CommandCenter
          aiOnline={aiOnline}
          activeProvider={activeProvider}
          providerStatus={providerStatus}
          memoryCount={Object.keys(memory).length}
          performanceMode={PERFORMANCE_LABEL[performanceMode]}
          fps={fps}
          voiceState={voiceState}
          voiceSupported={voiceSupported}
          cameraOn={cameraOn}
          remoteSource={remoteSource}
          jarvisAuthenticated={jarvisAuthenticated}
          visualMode={customColor ?? THEMES[theme].label}
          chatMessages={chatMessages}
          onModeChange={switchMode}
          onVoice={toggleVoice}
          onCommand={(command) => { setTranscript(command); void askAI(command); }}
        />
        </ErrorBoundary>
      )}

      {mode === "dashboard" && (
        <div className="dashboard-frame dashboard-frame-active" aria-label="JARVIS monitoring dashboard">
        <section className="dashboard-panel dashboard-left">
          <div className="dashboard-panel-head">
            <span>SYSTEM MONITOR</span>
            <span className="dashboard-live"><i /> LIVE</span>
          </div>

          <div className="monitor-core">
            <div className="monitor-core-ring">
              <span>{fps}</span>
              <small>FPS</small>
            </div>
            <div className="monitor-core-copy">
              <strong>MARK 7 CORE</strong>
              <span>ORBITAL VISUAL ENGINE</span>
              <span className="monitor-online"><i /> {aiOnline ? "AI LINK STABLE" : "AI LINK STANDBY"}</span>
            </div>
          </div>

          <div className="monitor-grid">
            <div className="monitor-tile">
              <span>AI LINK</span>
              <strong>{aiOnline ? "ONLINE" : "OFFLINE"}</strong>
              <i className={aiOnline ? "is-ok" : ""} />
              <em>{activeProvider ? PROVIDER_LABEL[activeProvider] : "NO PROVIDER"}</em>
            </div>
            <div className="monitor-tile">
              <span>VOICE</span>
              <strong>{voiceSupported ? voiceState.toUpperCase() : "UNAVAILABLE"}</strong>
              <i className={voiceSupported ? "is-ok" : ""} />
              <em>{voiceReadiness.toUpperCase()}</em>
            </div>
            <div className="monitor-tile">
              <span>GESTURES</span>
              <strong>{cameraOn ? "ACTIVE" : "STANDBY"}</strong>
              <i className={cameraOn ? "is-ok" : ""} />
              <em>{status.hands} HAND{status.hands === 1 ? "" : "S"}</em>
            </div>
            <div className="monitor-tile">
              <span>MEMORY</span>
              <strong>{Object.keys(memory).length} ITEMS</strong>
              <i className={Object.keys(memory).length ? "is-ok" : ""} />
              <em>LOCAL CACHE</em>
            </div>
          </div>

          <div className="telemetry-line">
            <span>CORE LOAD</span>
            <div><i className="load-a" /></div>
            <strong>{Math.min(99, Math.max(18, Math.round(100 - fps / 2)))}%</strong>
          </div>
          <div className="telemetry-line">
            <span>VOICE BUS</span>
            <div><i className={`load-b ${voiceState !== "idle" ? "load-active" : ""}`} /></div>
            <strong>{voiceState === "idle" ? "IDLE" : "BUSY"}</strong>
          </div>
        </section>

        <section className="dashboard-panel dashboard-right">
          <div className="stock-widget">
            <div className="dashboard-panel-head">
              <span>MARKET WATCH // CANDLES</span>
              <span className={`dashboard-clock ${stockData?.marketState === "REGULAR" ? "live-pulse" : ""}`}>
                {stockLoading ? "SYNCING" : stockData ? (stockData.marketState === "REGULAR" ? "LIVE" : stockData.marketState === "PRE" ? "PRE-MARKET" : stockData.marketState === "POST" ? "AFTER HOURS" : stockData.exchange || "CLOSED") : "STANDBY"}
              </span>
            </div>
            {activeStock && stockData ? (
              <>
                <div className="stock-summary">
                  <div><strong>{stockData.ticker}</strong><small>{stockData.name}</small></div>
                  <div className={`stock-price ${stockData.change >= 0 ? "up" : "down"}`}><strong>{stockData.currency ? `${stockData.currency} ` : ""}{stockData.latest.toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong><small>{stockData.change >= 0 ? "+" : ""}{stockData.change.toFixed(2)} ({stockData.changePercent >= 0 ? "+" : ""}{stockData.changePercent.toFixed(2)}%)</small></div>
                </div>
                <div className="stock-range-select" role="group" aria-label="Chart range">
                  {STOCK_RANGES.map((r) => (
                    <button key={r.key} type="button" className={`stock-range-btn ${stockRange === r.key ? "active" : ""}`} onClick={() => setStockRange(r.key)}>
                      {r.label}
                    </button>
                  ))}
                </div>
                <div className="stock-chart" aria-label={`${stockData.ticker} candlestick chart, ${stockRange}`}>
                  <svg viewBox="0 0 600 150" preserveAspectRatio="none" role="img">
                    {(() => {
                      const pts = stockData.points;
                      const min = Math.min(...pts.map((p) => p.low));
                      const max = Math.max(...pts.map((p) => p.high));
                      const span = max - min || 1;
                      const slot = 600 / pts.length;
                      const bodyWidth = Math.max(1.5, Math.min(10, slot * 0.6));
                      const y = (value: number) => 145 - ((value - min) / span) * 135 - 5;
                      return pts.map((p, i) => {
                        const cx = slot * i + slot / 2;
                        const up = p.close >= p.open;
                        const bodyTop = y(Math.max(p.open, p.close));
                        const bodyBottom = y(Math.min(p.open, p.close));
                        const bodyHeight = Math.max(1, bodyBottom - bodyTop);
                        return (
                          <g key={p.date} className={up ? "candle-up" : "candle-down"}>
                            <line x1={cx} x2={cx} y1={y(p.high)} y2={y(p.low)} stroke="currentColor" strokeWidth="1" />
                            <rect x={cx - bodyWidth / 2} y={bodyTop} width={bodyWidth} height={bodyHeight} fill="currentColor" />
                          </g>
                        );
                      });
                    })()}
                  </svg>
                </div>
                <div className="stock-chart-meta">
                  <span>{STOCK_RANGES.find((r) => r.key === stockRange)?.label} · {stockData.interval.toUpperCase()} CANDLES</span>
                  <span>UPDATED {new Date(stockData.fetchedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
                </div>
              </>
            ) : (
              <div className="stock-empty">{stockLoading ? "LOADING SAVED WATCHLIST…" : stockError ? stockError.toUpperCase() : "NO SAVED STOCK — ADD ONE BELOW"}</div>
            )}
            <div className="stock-watchlist">
              {stockWatchlist.map((ticker) => (
                <button key={ticker} type="button" className={`stock-chip ${activeStock === ticker ? "active" : ""}`} onClick={() => setActiveStock(ticker)}>
                  {ticker}<span onClick={(event) => { event.stopPropagation(); removeStock(ticker); }} aria-label={`Remove ${ticker}`}>×</span>
                </button>
              ))}
            </div>
            <form className="stock-add" onSubmit={(event) => { event.preventDefault(); addStock(); }}>
              <input value={stockInput} onChange={(event) => setStockInput(event.target.value)} placeholder="TICKER · RELIANCE.NS" aria-label="Add stock ticker" />
              <button type="submit" className="hud-btn" disabled={!stockInput.trim()}>TRACK</button>
            </form>
          </div>

          <div className="dashboard-panel-head">
            <span>AI COMMUNICATIONS</span>
            <span className="dashboard-clock">LIVE // {chatMessages.length}</span>
          </div>

          <div className="ai-message-feed" aria-live="polite">
            {chatMessages.length === 0 ? (
              <div className="ai-message-empty">AWAITING AI COMMUNICATION…</div>
            ) : (
              chatMessages.slice(-8).map((message, index) => (
                <div key={`${index}-${message.role}-${message.content.slice(0, 12)}`} className={`ai-message ${message.role === "assistant" ? "ai-message-assistant" : "ai-message-user"}`}>
                  <div className="ai-message-meta">
                    {message.role === "assistant" ? "JARVIS // AI" : "USER // COMMAND"}
                    {message.toolsUsed && message.toolsUsed.length > 0 && (
                      <span className="ai-message-tools"> · {message.toolsUsed.join(", ")}</span>
                    )}
                  </div>
                  <div className="ai-message-content">{message.content}</div>
                </div>
              ))
            )}
          </div>

          <div className="telemetry-divider"><span>LIVE TELEMETRY</span><i /></div>
          <div className="telemetry-stack">
            <div className="telemetry-card">
              <span className="telemetry-label">AI CONNECTION</span>
              <strong>{activeProvider ? PROVIDER_LABEL[activeProvider] : "AWAITING LINK"}</strong>
              <small>{PROVIDERS.some((p) => providerStatus[p.id]) ? "PROVIDER READY" : "CONNECT FROM HUD"}</small>
            </div>
            <div className="telemetry-card">
              <span className="telemetry-label">LOCAL LEARNING</span>
              <strong>ACTIVE</strong>
              <small>INPUT + AI OUTPUT + TOOL RESULTS STORED OFFLINE</small>
            </div>
            <div className="telemetry-card">
              <span className="telemetry-label">VISUAL MATRIX</span>
              <strong>{customColor ?? THEMES[theme].label}</strong>
              <small>PERFORMANCE · {PERFORMANCE_LABEL[performanceMode]}</small>
            </div>
            <div className="telemetry-card">
              <span className="telemetry-label">REMOTE BUS</span>
              <strong>{remoteSource ? remoteSource.toUpperCase() : "LOCAL CONTROL"}</strong>
              <small>{remoteSource ? "COMMAND RECEIVED" : "NO REMOTE TRAFFIC"}</small>
            </div>
          </div>

          <div className="signal-graph" aria-hidden="true">
            <div className="signal-head"><span>NEURAL SIGNAL</span><span>REALTIME</span></div>
            <div className="signal-bars">
              <i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i />
              <i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i />
            </div>
          </div>

          <div className="dashboard-footer">
            <span><i className="is-ok" /> SYSTEM NOMINAL</span>
            <span>SECURE HUD</span>
          </div>
        </section>
        </div>
      )}

      {mode !== "commandCenter" && <div className="hud hud-title">
        <div>JARVIS</div>
        <strong>MARK 7</strong>
        <span>STATUS: ONLINE</span>
      </div>}

      {mode !== "commandCenter" && <div className="hud hud-status">
        <div>AI: {aiOnline && activeProvider ? `ONLINE · ${PROVIDER_LABEL[activeProvider]}` : "OFFLINE"}</div>
        <div>VOICE: {voiceSupported ? "READY" : "UNAVAILABLE"}</div>
        <div>VOICE ENGINE: {voiceReadiness.toUpperCase()}</div>
        <div>GESTURES: {cameraOn ? "READY" : "STANDBY"}</div>
        <div>VISUAL MODE: {customColor ?? THEMES[theme].label}</div>
        <div>DESKTOP MODE: {desktopMode ? "ACTIVE" : "OFF"}</div>
        <div>PERFORMANCE: {PERFORMANCE_LABEL[performanceMode]}</div>
      </div>}

      {mode === "orb" && (
        <div className="orb-mode-ui" aria-label="JARVIS orb interface">
          <div className="orb-mode-badge">
            <span className="orb-mode-dot" />
            <span>ORBITAL CORE // ONLINE</span>
          </div>
          {(transcript || reply) && (
            <div className="orb-ai-feed" aria-live="polite">
              {transcript && <div className="orb-ai-user">&gt; {transcript}</div>}
              {reply && <div className="orb-ai-reply"><span>JARVIS</span>{reply}</div>}
            </div>
          )}
        </div>
      )}

      {remoteSource && (
        <div className="hud remote-command-indicator">
          REMOTE COMMAND: {remoteSource}
        </div>
      )}

      {mode !== "commandCenter" && <div className="hud hud-hint">
        <div><span className="key">DRAG</span> spin <span className="key">SCROLL</span> zoom</div>
        <div><span className="key">PINCH + MOVE</span> spin <span className="key">TWO HANDS</span> zoom</div>
        <div><span className="key">G</span> gestures <span className="key">R</span> reset <span className="key">V</span> voice</div>
        {desktopMode && (
          <div>
            <span className="key">← ↑ → ↓</span> rotate
            {fullscreenSupported && <> <span className="key">F</span> fullscreen</>}
          </div>
        )}
      </div>}

      {mode !== "commandCenter" && <div className="hud hud-voice">
        {voiceError && <div className="hud-error">{voiceError.toUpperCase()}</div>}
        <button
          type="button"
          className={`mic-btn mic-${voiceState}`}
          onClick={toggleVoice}
          disabled={!voiceSupported}
          aria-pressed={voiceState !== "idle"}
        >
          {voiceSupported ? VOICE_LABEL[voiceState] : "VOICE UNSUPPORTED"}
        </button>
        {voiceSupported && (
          <button
            type="button"
            className="hud-btn wake-toggle"
            onClick={() => setWakeEnabled((v) => !v)}
            aria-pressed={wakeEnabled}
          >
            WAKE WORD {wakeEnabled ? "ON" : "OFF"}
          </button>
        )}
      </div>}

      {mode !== "commandCenter" && <div className="hud hud-controls">
        <div className={`camera-panel${cameraOn ? " visible" : ""}`}>
          <video ref={videoRef} muted playsInline className="camera-video" />
          <canvas ref={overlayRef} width={208} height={156} className="camera-overlay" />
          <div className="camera-status">
            {status.hands > 0
              ? `${status.hands} HAND${status.hands > 1 ? "S" : ""} · ${MODE_LABEL[status.mode]}`
              : "SHOW HANDS"}
          </div>
        </div>
        {error && <div className="hud-error">{error}</div>}
        <div className="hud-row">
          <button
            type="button"
            className="hud-btn lab-launch-btn"
            aria-pressed={mode === "molecule"}
            onClick={toggleMoleculeMode}
          >
            {mode === "molecule" ? "RETURN TO ORB" : "ATOM / MOLECULE"}
          </button>
          <button type="button" className="hud-btn" aria-pressed={cameraOn} onClick={toggleGestures} disabled={camera === "starting"}>
            {camera === "starting" ? "INITIALIZING…" : cameraOn ? "GESTURES ON" : "GESTURES OFF"}
          </button>
        </div>
        {mode === "molecule" && (
          <div className="molecule-hud-hint">
            VOICE: “add hydrogen atom” · “load water” · “break bonds” · “exit atom mode”<br />
            HANDS: pinch atom = grab/move · pinch top-left/right corner = add/remove atom
          </div>
        )}
        <form
          className="command-bar"
          onSubmit={(event) => {
            event.preventDefault();
            const command = commandInput.trim();
            if (!command) return;
            setCommandInput("");
            setTranscript(command);
            void askAI(command);
          }}
        >
          <span className="command-prefix" aria-hidden="true">&gt;</span>
          <input
            value={commandInput}
            onChange={(event) => setCommandInput(event.target.value)}
            placeholder='TYPE COMMAND · "activate dashboard" · "open molecule lab"'
            aria-label="JARVIS command"
            autoComplete="off"
            spellCheck={false}
          />
          <button type="submit" className="hud-btn" disabled={!commandInput.trim()}>SEND</button>
        </form>
        <div className="hud-row">
          <button type="button" className="hud-btn" onClick={() => sceneRef.current?.zoomIn()} aria-label="Zoom in">+</button>
          <button type="button" className="hud-btn" onClick={() => sceneRef.current?.zoomOut()} aria-label="Zoom out">−</button>
          <button type="button" className="hud-btn" onClick={() => sceneRef.current?.resetView()}>RESET</button>
          {desktopMode && fullscreenSupported && (
            <button
              type="button"
              className="hud-btn"
              aria-pressed={isFullscreen}
              onClick={handleToggleFullscreen}
            >
              {isFullscreen ? "EXIT FULLSCREEN" : "FULLSCREEN"}
            </button>
          )}
        </div>
      </div>}

      {diagnostics && (
        <div className="diagnostics hud">
          <div className="diagnostics-title">JARVIS DIAGNOSTICS</div>
          {diagnostics.map((line) => <div key={line}>{line}</div>)}
          <button type="button" className="hud-btn" onClick={() => setDiagnostics(null)}>CLOSE</button>
        </div>
      )}

      {Object.keys(memory).length > 0 && (
        <div className="memory-indicator hud">
          MEMORY: {Object.keys(memory).length} ITEM{Object.keys(memory).length === 1 ? "" : "S"}
        </div>
      )}

      {apiPopupOpen && (
        <div className="api-overlay" role="dialog" aria-modal="true" aria-labelledby="api-title">
          <div className="api-panel" style={{ "--theme": themeColor } as CSSProperties}>
            <div className="api-kicker">JARVIS MARK 7</div>
            <h1 id="api-title">AI CONNECTION</h1>

            <div className="api-provider-tabs" role="tablist" aria-label="AI provider">
              {PROVIDERS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  role="tab"
                  aria-selected={selectedProvider === p.id}
                  className={`api-provider-tab${selectedProvider === p.id ? " active" : ""}`}
                  onClick={() => {
                    setSelectedProvider(p.id);
                    setApiMessage("");
                    window.setTimeout(() => apiKeyInputRef.current?.focus(), 0);
                  }}
                >
                  {p.label}
                  {providerStatus[p.id] && <span className="api-provider-dot" aria-hidden="true" />}
                </button>
              ))}
            </div>

            {selectedProvider === "ollama" ? (
              <>
                <div className="api-label">
                  LOCAL OLLAMA {activeProvider === "ollama" && "· ACTIVE"}
                </div>
                <div className="api-note">
                  No API key is required. JARVIS connects to the local Ollama server at
                  <code> {process.env.NEXT_PUBLIC_LOCAL_LLM_BASE_URL || "http://localhost:11434"}</code>.
                </div>
                <button type="button" className="api-connect" onClick={() => void connectApiKey()} disabled={apiBusy}>
                  {apiBusy ? "CHECKING…" : "CONNECT OLLAMA"}
                </button>
              </>
            ) : (
              <>
                <div className="api-label">
                  ENTER {PROVIDER_LABEL[selectedProvider]} API KEY
                  {activeProvider === selectedProvider && " · ACTIVE"}
                </div>
                <input
                  key={selectedProvider}
                  ref={apiKeyInputRef}
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="****************"
                  aria-label={`${PROVIDER_LABEL[selectedProvider]} API key`}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !apiBusy) void connectApiKey();
                    if (e.key === "Escape" && aiOnline) setApiPopupOpen(false);
                  }}
                />
                <button type="button" className="api-connect" onClick={() => void connectApiKey()} disabled={apiBusy}>
                  {apiBusy ? "VALIDATING…" : "CONNECT"}
                </button>
              </>
            )}
            {providerStatus[selectedProvider] && selectedProvider !== "ollama" && (
              <button type="button" className="api-remove" onClick={() => void removeApiKey(selectedProvider)}>
                REMOVE {PROVIDER_LABEL[selectedProvider]} KEY
              </button>
            )}
            {aiOnline && (
              <button type="button" className="api-close" onClick={() => setApiPopupOpen(false)}>
                CLOSE
              </button>
            )}
            {apiMessage && <div className="api-message">{apiMessage}</div>}
            <div className="api-note">
              Keys are validated server-side and held only in server memory — never written to a
              file, never sent back to the browser.
            </div>
          </div>
        </div>
      )}
    </>
  );
}
