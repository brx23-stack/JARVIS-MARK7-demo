// ——— Proactive briefing endpoint ———
//
// This route has no built-in scheduler — Next.js API routes are
// request-driven, not background processes, so "speak a briefing every
// morning unprompted" needs something outside this app to trigger it on a
// timer. That's intentional: it keeps this app a plain Next dev/prod server
// with no extra long-running process to manage. Point any of the following
// at this URL on whatever cadence you want:
//   - a cron job (Linux/macOS) or Task Scheduler (Windows) running
//     `curl -X POST -H "x-jarvis-admin-token: <token>" http://localhost:3000/api/briefing`
//   - a free external cron service (cron-job.org, GitHub Actions schedule)
//     if this is deployed somewhere with a public URL
//
// Reuses the same admin token as /api/remote/admin so there's only one
// secret to manage for "privileged, non-interactive" actions.
//
// delivery=telegram pushes the briefing text to TELEGRAM_BRIEFING_CHAT_ID
// (see lib/remote/providers/telegram.ts); omitting it just returns the
// composed text in the response, e.g. for the orb UI to speak directly if
// you wire a "get today's briefing" local command to fetch this route.
// ?place=City includes current weather for that city; falls back to
// BRIEFING_DEFAULT_PLACE from env if not passed, or omits weather entirely
// if neither is set.

import { NextRequest, NextResponse } from "next/server";
import { isLocalOnlyMode } from "@/lib/privacy/policy";
import { verifyAdminToken } from "@/lib/remote/gateway";
import { composeBriefing } from "@/lib/briefing/compose";
import { pushTelegramBriefing } from "@/lib/remote/providers/telegram";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (isLocalOnlyMode()) return NextResponse.json({ error: "External briefing integrations are disabled by local-only privacy mode." }, { status: 403 });
  if (!verifyAdminToken(req.headers.get("x-jarvis-admin-token") || "")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const delivery = url.searchParams.get("delivery");
  const place = url.searchParams.get("place") || process.env.BRIEFING_DEFAULT_PLACE || undefined;

  const briefing = await composeBriefing(place);

  if (delivery === "telegram") {
    try {
      await pushTelegramBriefing(briefing);
    } catch (err) {
      return NextResponse.json(
        { briefing, delivered: false, error: err instanceof Error ? err.message : "Delivery failed" },
        { status: 502 },
      );
    }
    return NextResponse.json({ briefing, delivered: true });
  }

  return NextResponse.json({ briefing, delivered: false });
}
