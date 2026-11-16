import crypto from "node:crypto";

function config() {
  return {
    publicKey: process.env.DISCORD_PUBLIC_KEY || "",
    applicationId: process.env.DISCORD_APPLICATION_ID || "",
  };
}

// The DER prefix for an SPKI-wrapped raw 32-byte Ed25519 public key. Fixed
// for every Ed25519 key, so concatenating it with Discord's raw hex public
// key is enough to build a key node:crypto can verify with, no extra
// dependency required.
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

function discordPublicKeyObject(): crypto.KeyObject | null {
  const { publicKey } = config();
  if (!publicKey || publicKey.length !== 64) return null;
  try {
    const raw = Buffer.from(publicKey, "hex");
    const der = Buffer.concat([ED25519_SPKI_PREFIX, raw]);
    return crypto.createPublicKey({ key: der, format: "der", type: "spki" });
  } catch {
    return null;
  }
}

// Discord signs every interaction webhook with Ed25519 over
// `timestamp + rawBody`. Verification must run against the exact raw bytes
// received, before any JSON.parse.
export function verifyDiscordSignature(
  signature: string | null,
  timestamp: string | null,
  rawBody: string,
): boolean {
  if (!signature || !timestamp) return false;
  const keyObject = discordPublicKeyObject();
  if (!keyObject) return false;
  try {
    const sig = Buffer.from(signature, "hex");
    const message = Buffer.from(timestamp + rawBody, "utf8");
    return crypto.verify(null, message, keyObject, sig);
  } catch {
    return false;
  }
}

// Recipients are stored as "<applicationId>:<interactionToken>" (see
// lib/remote/discord.ts). Followup messages sent to a webhook built from the
// interaction token do not require the bot token and are valid for 15
// minutes after the original interaction, comfortably inside the 10-minute
// remote recipient TTL.
export async function sendDiscordMessage(commandId: string, body: string): Promise<void> {
  const { getRemoteRecipient } = await import("../recipients");
  const recipient = getRemoteRecipient(commandId);
  if (!recipient) throw new Error("Remote recipient is no longer available.");

  // Application IDs are pure numeric snowflakes, but interaction tokens are
  // long opaque strings - split on the first colon only so a token that
  // happens to contain one is never truncated.
  const separatorIndex = recipient.indexOf(":");
  const applicationId = separatorIndex === -1 ? "" : recipient.slice(0, separatorIndex);
  const interactionToken = separatorIndex === -1 ? "" : recipient.slice(separatorIndex + 1);
  if (!applicationId || !interactionToken) {
    throw new Error("Remote recipient is malformed.");
  }

  const response = await fetch(
    `https://discord.com/api/v10/webhooks/${applicationId}/${interactionToken}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: body.slice(0, 2000) }),
    },
  );

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Discord message delivery failed (${response.status}): ${detail.slice(0, 200)}`);
  }

  console.info("[remote] reply delivered", { commandId, channel: "DISCORD" });
}
