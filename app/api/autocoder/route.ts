import { NextRequest, NextResponse } from "next/server";
import { requireAccess } from "@/lib/security";
import { isValidUiSession } from "@/lib/remote/gateway";
import { isLocalOnlyMode } from "@/lib/privacy/policy";
import { applyProposal, propose, rejectProposal, rollbackProposal } from "@/lib/autocoder/engine";
import {
  armAutocoder, audit, autocoderStatus, disarmAutocoder, getProposal, listProposals, readAudit,
} from "@/lib/autocoder/store";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const fail = (error: string, status: number) => NextResponse.json({ error }, { status });

export async function GET(req: NextRequest) {
  const auth = requireAccess(req, 60, 60_000, isValidUiSession);
  if (!auth.ok) return fail(auth.error, auth.status);
  if (isLocalOnlyMode()) return fail("Autocoder is disabled by local-only privacy mode.", 403);
  const status = autocoderStatus();
  if (!status.enabled) return NextResponse.json({ status });
  const id = new URL(req.url).searchParams.get("id");
  if (id) return NextResponse.json({ status, proposal: await getProposal(id) });
  return NextResponse.json({ status, proposals: await listProposals(25), audit: await readAudit(20) });
}

export async function POST(req: NextRequest) {
  const auth = requireAccess(req, 12, 60_000, isValidUiSession);
  if (!auth.ok) return fail(auth.error, auth.status);
  if (isLocalOnlyMode()) return fail("Autocoder is disabled by local-only privacy mode.", 403);
  if (!autocoderStatus().enabled) return fail("Autocoder is disabled. Set AUTOCODER_ENABLED=true and restart.", 403);

  // Owner-only: arming/applying needs the browser session or the access token (same as every other route),
  // and is never reachable from Telegram/Discord.
  const body = await req.json().catch(() => ({}));
  const action = typeof body.action === "string" ? body.action : "";
  const id = typeof body.id === "string" ? body.id : "";
  try {
    switch (action) {
      case "propose": {
        const goal = typeof body.goal === "string" ? body.goal : "";
        if (!goal.trim()) return fail("Missing 'goal'.", 400);
        return NextResponse.json({ proposal: await propose(goal) });
      }
      case "apply": return NextResponse.json({ proposal: await applyProposal(id) });
      case "reject": return NextResponse.json({ proposal: await rejectProposal(id) });
      case "rollback": return NextResponse.json({ proposal: await rollbackProposal(id) });
      case "arm": {
        const status = armAutocoder(Number(body.minutes) || 10);
        await audit("arm", { minutes: status.minutesLeft });
        return NextResponse.json({ status });
      }
      case "disarm": { await audit("disarm"); return NextResponse.json({ status: disarmAutocoder() }); }
      default: return fail("Unknown action.", 400);
    }
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Autocoder error.", 400);
  }
}
