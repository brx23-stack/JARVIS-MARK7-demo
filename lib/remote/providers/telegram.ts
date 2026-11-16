import crypto from "node:crypto";
import { isUsableToken } from "../../security.ts";

function config() {
  return {
    botToken: process.env.TELEGRAM_BOT_TOKEN || "",
    webhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET || "",
  };
}

// Telegram does not sign webhook payloads. Instead, the secret token you
// supply when calling setWebhook is echoed back on every request as the
// `X-Telegram-Bot-Api-Secret-Token` header. Comparing it here is the only
// thing standing between the public webhook route and arbitrary POSTs, so
// treat a missing/misconfigured secret as a hard rejection rather than an
// open gate.
export function verifyTelegramSecret(candidate: string | null): boolean {
  const { webhookSecret } = config();
  if (!webhookSecret || !candidate || !isUsableToken(webhookSecret)) return false;
  const a = Buffer.from(candidate);
  const b = Buffer.from(webhookSecret);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function sendTelegramMessage(commandId: string, body: string): Promise<void> {
  const { botToken } = config();
  if (!botToken) throw new Error("Telegram bot token is not configured.");

  // The browser supplies only the command id. The actual chat is looked up
  // server-side from the accepted command, so it cannot be spoofed.
  const { getRemoteRecipient } = await import("../recipients");
  const chatId = getRemoteRecipient(commandId);
  if (!chatId) throw new Error("Remote recipient is no longer available.");

  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: body.slice(0, 4000),
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Telegram message delivery failed (${response.status}): ${detail.slice(0, 200)}`);
  }

  console.info("[remote] reply delivered", { commandId, channel: "TELEGRAM" });
}

/** Pushes a message to a fixed, pre-configured chat — used for unprompted
 * notifications (e.g. the morning briefing) that aren't a reply to any
 * inbound command, so there's no commandId/recipient lookup to do. Requires
 * TELEGRAM_BRIEFING_CHAT_ID (your own chat id) rather than trusting any
 * chat id supplied at call time. */
export async function pushTelegramBriefing(body: string): Promise<void> {
  const { botToken } = config();
  const chatId = process.env.TELEGRAM_BRIEFING_CHAT_ID || "";
  if (!botToken) throw new Error("Telegram bot token is not configured.");
  if (!chatId) throw new Error("TELEGRAM_BRIEFING_CHAT_ID is not configured.");

  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: body.slice(0, 4000) }),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Telegram briefing delivery failed (${response.status}): ${detail.slice(0, 200)}`);
  }
}
