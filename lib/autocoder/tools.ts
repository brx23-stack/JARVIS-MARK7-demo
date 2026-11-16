import { autocode } from "./engine";
import { autocoderEnabled } from "./store";

/** Called by tool-registry.ts (same pattern as registerAndroidTools). No-op unless AUTOCODER_ENABLED=true. */
export function registerAutocoderTools(register: (d: any, h: (a: Record<string, unknown>) => Promise<string>) => void) {
  if (!autocoderEnabled()) return;
  register({
    type: "function",
    function: {
      name: "autocode",
      description:
        "Modify JARVIS's own source code to add or fix a feature. Describe the change in plain words. " +
        "The change is prepared as a reviewable proposal; it is only applied automatically if the owner has armed auto mode. " +
        "It always type-checks and rolls back on failure. Use only when the user explicitly asks to change or extend JARVIS itself.",
      parameters: {
        type: "object",
        properties: { goal: { type: "string", description: "What to change, e.g. 'add a /api/ping route that returns the server time'." } },
        required: ["goal"],
      },
    },
  }, async (args) => autocode(String(args.goal ?? "")));
}
