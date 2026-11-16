import { NextRequest } from "next/server";
import {
  enqueueRemoteCommand,
  isDuplicateMessage,
  isRemoteEnabled,
  isSenderAllowed,
  remoteRateLimit,
} from "./gateway";
import { rememberRemoteRecipient } from "./recipients";
import { verifyTelegramSecret } from "./providers/telegram";

export type TelegramRequestResult =
  | { kind: "message"; commandId: string }
  | { kind: "ignored" }
  | { kind: "rejected"; reason: string };

type TelegramUpdate = {
  update_id: number;
  message?: {
    message_id: number;
    text?: string;
    from?: { id: number; username?: string };
    chat: { id: number };
  };
};

export async function parseTelegramRequest(req: NextRequest): Promise<TelegramRequestResult> {
  if (!isRemoteEnabled()) return { kind: "rejected", reason: "Remote control is disabled." };

  // Telegram has no request signature; the secret token set via setWebhook
  // is echoed back on every call and is the only gate on this public route.
  if (!verifyTelegramSecret(req.headers.get("x-telegram-bot-api-secret-token"))) {
    return { kind: "rejected", reason: "Webhook secret verification failed." };
  }

  let update: TelegramUpdate;
  try {
    update = await req.json();
  } catch {
    return { kind: "rejected", reason: "Invalid JSON." };
  }

  if (isDuplicateMessage(`telegram:${update.update_id}`)) {
    return { kind: "rejected", reason: "Duplicate webhook ignored." };
  }

  const message = update.message;
  if (!message || !message.text) {
    // Non-text updates (edits, reactions, join events, etc.) are expected
    // and not an error - just nothing for JARVIS to act on.
    return { kind: "ignored" };
  }

  const senderId = `telegram:${message.from?.id ?? "unknown"}`;
  if (!isSenderAllowed(senderId)) {
    return { kind: "rejected", reason: "Sender is not allowlisted." };
  }
  if (!remoteRateLimit(senderId)) {
    return { kind: "rejected", reason: "Rate limited." };
  }

  const command = enqueueRemoteCommand({
    source: "TELEGRAM",
    senderId,
    command: message.text,
    externalId: String(update.update_id),
  });

  // Recipient is the inbound chat id, so later JARVIS result delivery cannot
  // be redirected by anything in the browser.
  rememberRemoteRecipient(command.id, String(message.chat.id));
  return { kind: "message", commandId: command.id };
}
