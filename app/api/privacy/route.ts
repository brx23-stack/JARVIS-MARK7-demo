import { NextRequest, NextResponse } from "next/server";
import { requireAccess } from "@/lib/security";
import { isValidUiSession } from "@/lib/remote/gateway";
import { getPrivacyMode } from "@/lib/privacy/policy";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = requireAccess(req, 30, 60_000, isValidUiSession);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const mode = getPrivacyMode();
  return NextResponse.json({
    mode,
    localOnly: mode === "local_only",
    controls: {
      cloudLlm: mode !== "local_only",
      onlineTts: mode !== "local_only",
      browserVoiceInput: mode !== "local_only",
      browserVoiceOutput: mode !== "local_only",
      networkTools: mode !== "local_only",
      autonomousAgent: mode !== "local_only",
      localMemory: true,
    },
    limitations: [
      "Memory files are currently stored as local plaintext JSON/JSONL; use full-disk encryption and restrict access to the data directory.",
      "Browser Web Speech recognition and browser speech synthesis are platform-dependent and are not certified as on-device; both are disabled in local-only mode.",
      "Connected third-party integrations and remote gateways must be disabled separately in their configuration when strict data locality is required.",
    ],
  }, { headers: { "cache-control": "no-store" } });
}
