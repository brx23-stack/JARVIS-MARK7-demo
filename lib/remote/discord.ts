import { NextRequest, NextResponse } from "next/server";
import {
  enqueueRemoteCommand,
  isDuplicateMessage,
  isRemoteEnabled,
  isSenderAllowed,
  remoteRateLimit,
} from "./gateway";
import { rememberRemoteRecipient } from "./recipients";
import { verifyDiscordSignature } from "./providers/discord";

// https://discord.com/developers/docs/interactions/receiving-and-responding#interaction-object-interaction-type
const INTERACTION_TYPE_PING = 1;
const INTERACTION_TYPE_APPLICATION_COMMAND = 2;

// https://discord.com/developers/docs/interactions/receiving-and-responding#interaction-response-object-interaction-callback-type
const RESPONSE_TYPE_PONG = 1;
const RESPONSE_TYPE_CHANNEL_MESSAGE = 4;
const RESPONSE_TYPE_DEFERRED_CHANNEL_MESSAGE = 5;

export type DiscordRequestResult =
  | { kind: "pong" }
  | { kind: "command"; commandId: string }
  | { kind: "rejected"; reason: string };

type DiscordInteraction = {
  id: string;
  type: number;
  token: string;
  application_id: string;
  member?: { user?: { id: string; username?: string } };
  user?: { id: string; username?: string };
  data?: { options?: Array<{ name: string; value: string }> };
};

export async function parseDiscordRequest(
  req: NextRequest,
): Promise<{ result: DiscordRequestResult; rawBodyInvalid?: boolean }> {
  // Signature verification must run against the exact raw bytes, so the
  // body is read as text before any JSON parsing happens.
  const rawBody = await req.text();
  const verified = verifyDiscordSignature(
    req.headers.get("x-signature-ed25519"),
    req.headers.get("x-signature-timestamp"),
    rawBody,
  );
  if (!verified) {
    return { result: { kind: "rejected", reason: "Signature verification failed." }, rawBodyInvalid: true };
  }

  let interaction: DiscordInteraction;
  try {
    interaction = JSON.parse(rawBody);
  } catch {
    return { result: { kind: "rejected", reason: "Invalid JSON." } };
  }

  // Discord's endpoint verification PING must always be answered, even while
  // remote control is otherwise disabled, or Discord will mark the
  // interactions endpoint URL as invalid.
  if (interaction.type === INTERACTION_TYPE_PING) {
    return { result: { kind: "pong" } };
  }

  if (!isRemoteEnabled()) {
    return { result: { kind: "rejected", reason: "Remote control is disabled." } };
  }

  if (interaction.type !== INTERACTION_TYPE_APPLICATION_COMMAND) {
    return { result: { kind: "rejected", reason: "Unsupported interaction type." } };
  }

  if (isDuplicateMessage(`discord:${interaction.id}`)) {
    return { result: { kind: "rejected", reason: "Duplicate interaction ignored." } };
  }

  const user = interaction.member?.user ?? interaction.user;
  const senderId = `discord:${user?.id ?? "unknown"}`;
  if (!isSenderAllowed(senderId)) {
    return { result: { kind: "rejected", reason: "Sender is not allowlisted." } };
  }
  if (!remoteRateLimit(senderId)) {
    return { result: { kind: "rejected", reason: "Rate limited." } };
  }

  const commandText = interaction.data?.options?.find((o) => o.name === "command")?.value?.trim();
  if (!commandText) {
    return { result: { kind: "rejected", reason: "Empty command." } };
  }

  const command = enqueueRemoteCommand({
    source: "DISCORD",
    senderId,
    command: commandText,
    externalId: interaction.id,
  });

  // Recipient is the interaction's own token, so later JARVIS result
  // delivery cannot be redirected by anything in the browser. It is only
  // valid for 15 minutes, comfortably inside the remote recipient TTL.
  rememberRemoteRecipient(command.id, `${interaction.application_id}:${interaction.token}`);
  return { result: { kind: "command", commandId: command.id } };
}

export function discordResponse(result: DiscordRequestResult): NextResponse {
  if (result.kind === "pong") {
    return NextResponse.json({ type: RESPONSE_TYPE_PONG });
  }
  if (result.kind === "command") {
    // Defer: JARVIS processes the command asynchronously in the browser and
    // the answer arrives later as a followup message (see
    // lib/remote/providers/discord.ts:sendDiscordMessage).
    return NextResponse.json({ type: RESPONSE_TYPE_DEFERRED_CHANNEL_MESSAGE });
  }
  return NextResponse.json({
    type: RESPONSE_TYPE_CHANNEL_MESSAGE,
    data: { content: "JARVIS could not accept that command.", flags: 64 }, // 64 = EPHEMERAL
  });
}
