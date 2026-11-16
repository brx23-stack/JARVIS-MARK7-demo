import { enqueueApproval } from "@/lib/approvals/queue";
import { executeToolUngated } from "@/lib/tools/execute";
import type { DayPlan } from "./dayPlan";

/** Tools the day plan may suggest. Override with JARVIS_DAY_ACTION_TOOLS=a,b,c. */
export function dayActionTools(): string[] {
  const raw = process.env.JARVIS_DAY_ACTION_TOOLS || "create_calendar_event";
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

/** Queues every suggested action for owner approval. Nothing runs until approved in the Command Center. */
export function queueDayActions(plan: DayPlan): string[] {
  const allowed = dayActionTools();
  const ids: string[] = [];
  for (const a of plan.suggestedActions) {
    if (!allowed.includes(a.tool)) continue; // defense in depth; planDay already filtered
    const argsJson = JSON.stringify(a.args);
    ids.push(
      enqueueApproval(
        a.tool,
        `Today: ${a.title}`,
        `${a.reason}\n${argsJson}`,
        () => executeToolUngated(a.tool, argsJson),
      ),
    );
  }
  return ids;
}
