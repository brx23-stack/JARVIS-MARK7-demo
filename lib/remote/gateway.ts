import crypto from "node:crypto";
import type { RemoteCommand, RemoteCommandResult, RemoteSource } from "./types";
import { isUsableToken } from "../security.ts";

type Subscriber = (command: RemoteCommand) => void;

type RuntimeState = {
  enabled: boolean;
  events: Map<string, RemoteCommand>;
  seen: Map<string, number>;
  subscribers: Set<Subscriber>;
  lastAcceptedBySender: Map<string, number>;
  uiSessions: Map<string, number>;
  claimed: Map<string, { sessionId: string; source: Exclude<RemoteSource, "ORB"> }>;
};

const GLOBAL_KEY = "__jarvisMark7RemoteGateway";
const globalStore = globalThis as typeof globalThis & {
  [GLOBAL_KEY]?: RuntimeState;
};

function state(): RuntimeState {
  if (!globalStore[GLOBAL_KEY]) {
    globalStore[GLOBAL_KEY] = {
      // Remote control is deliberately OFF until explicitly enabled.
      enabled: process.env.JARVIS_REMOTE_ENABLED === "true",
      events: new Map(),
      seen: new Map(),
      subscribers: new Set(),
      lastAcceptedBySender: new Map(),
      uiSessions: new Map(),
      claimed: new Map(),
    };
  }
  return globalStore[GLOBAL_KEY]!;
}

function cleanup(now: number) {
  const s = state();
  for (const [key, timestamp] of s.seen) {
    if (now - timestamp > 10 * 60_000) s.seen.delete(key);
  }
  for (const [id, command] of s.events) {
    if (now - command.receivedAt > 10 * 60_000) s.events.delete(id);
  }
  for (const [id, claim] of s.claimed) {
    if (!s.uiSessions.has(claim.sessionId)) s.claimed.delete(id);
  }
}

export function isRemoteEnabled(): boolean {
  return state().enabled;
}

export function setRemoteEnabled(enabled: boolean): void {
  state().enabled = enabled;
}

export function generateCommandId(): string {
  return crypto.randomUUID();
}

function allowedSenders(): string[] {
  return (process.env.REMOTE_ALLOWED_SENDERS || "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

export function isSenderAllowed(senderId: string): boolean {
  const allowlist = allowedSenders();
  return allowlist.length > 0 && allowlist.includes(senderId);
}

export function remoteRateLimit(senderId: string): boolean {
  const s = state();
  const now = Date.now();
  const previous = s.lastAcceptedBySender.get(senderId) ?? 0;
  const interval = Math.max(250, Number(process.env.REMOTE_RATE_LIMIT_MS || 2500));
  if (now - previous < interval) return false;
  s.lastAcceptedBySender.set(senderId, now);
  return true;
}

export function isDuplicateMessage(key: string): boolean {
  const s = state();
  const now = Date.now();
  cleanup(now);
  if (s.seen.has(key)) return true;
  s.seen.set(key, now);
  return false;
}

export function enqueueRemoteCommand(input: {
  source: Exclude<RemoteSource, "ORB">;
  senderId: string;
  command: string;
  externalId?: string;
}): RemoteCommand {
  const now = Date.now();
  const command: RemoteCommand = {
    id: generateCommandId(),
    source: input.source,
    senderId: input.senderId,
    command: input.command.trim().slice(0, 2000),
    receivedAt: now,
  };

  const s = state();
  cleanup(now);
  s.events.set(command.id, command);

  // Operational logging only: never log the message body.
  console.info("[remote] accepted", {
    id: command.id,
    source: command.source,
    sender: command.senderId.replace(/.(?=.{4})/g, "*"),
    externalId: input.externalId || undefined,
  });

  for (const subscriber of s.subscribers) {
    try {
      subscriber(command);
    } catch (error) {
      console.error("[remote] subscriber failed", error);
    }
  }

  return command;
}

export function subscribeRemoteCommands(subscriber: Subscriber): () => void {
  state().subscribers.add(subscriber);
  return () => state().subscribers.delete(subscriber);
}

export function getPendingRemoteCommands(limit = 10): RemoteCommand[] {
  cleanup(Date.now());
  return Array.from(state().events.values()).slice(-limit);
}


export function claimRemoteCommand(id: string, sessionId: string): RemoteCommand | null {
  const s = state();
  if (s.claimed.has(id)) return null;
  const command = s.events.get(id);
  if (!command) return null;
  s.claimed.set(id, { sessionId, source: command.source });
  s.events.delete(id);
  return command;
}

export function ownsClaimedCommand(id: string, sessionId: string, source?: Exclude<RemoteSource, "ORB">): boolean {
  const claim = state().claimed.get(id);
  return Boolean(claim && claim.sessionId === sessionId && (!source || claim.source === source));
}

export function finishClaimedCommand(id: string, sessionId: string): boolean {
  const s = state();
  if (s.claimed.get(id)?.sessionId !== sessionId) return false;
  s.claimed.delete(id);
  return true;
}

export function consumeRemoteCommand(id: string): RemoteCommand | null {
  const command = state().events.get(id) ?? null;
  if (command) state().events.delete(id);
  return command;
}


export function createUiSession(): string {
  const token = crypto.randomBytes(32).toString("hex");
  state().uiSessions.set(token, Date.now() + 24 * 60 * 60_000);
  return token;
}

export function isValidUiSession(token: string | undefined): boolean {
  if (!token) return false;
  const expiresAt = state().uiSessions.get(token);
  if (!expiresAt) return false;
  if (expiresAt < Date.now()) {
    state().uiSessions.delete(token);
    return false;
  }
  return true;
}

export function publicRemoteStatus() {
  const telegramConfigured =
    Boolean(process.env.TELEGRAM_BOT_TOKEN) && Boolean(process.env.TELEGRAM_WEBHOOK_SECRET);
  const discordConfigured =
    Boolean(process.env.DISCORD_PUBLIC_KEY) && Boolean(process.env.DISCORD_APPLICATION_ID);
  return {
    enabled: isRemoteEnabled(),
    telegramConfigured,
    discordConfigured,
    // At least one provider must be fully configured, plus a non-empty
    // sender allowlist, before remote control does anything useful.
    configured: (telegramConfigured || discordConfigured) && Boolean(process.env.REMOTE_ALLOWED_SENDERS),
  };
}

export function verifyAdminToken(candidate: string): boolean {
  const expected = process.env.REMOTE_ADMIN_TOKEN || "";
  if (!expected || !candidate || !isUsableToken(expected)) return false;
  const a = Buffer.from(candidate);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function deliverRemoteResult(result: RemoteCommandResult): Promise<void> {
  // Only the provider adapter knows how to deliver replies. This function
  // intentionally remains a small bridge so the browser never sees secrets.
  if (result.source === "TELEGRAM") {
    const { sendTelegramMessage } = await import("./providers/telegram");
    await sendTelegramMessage(result.id, result.reply);
    return;
  }
  if (result.source === "DISCORD") {
    const { sendDiscordMessage } = await import("./providers/discord");
    await sendDiscordMessage(result.id, result.reply);
    return;
  }
}
