import { TOOL_DEFINITIONS } from "@/lib/tools/definitions";
import { executeTool } from "@/lib/tools/execute";
import { browserFetch, screenOcr } from "./capabilities";
import { browserControl } from "./browser";
import { registerAndroidTools } from "./androidTools";
import { registerAutocoderTools } from "@/lib/autocoder/tools";
import { registerPlugins } from "@/lib/plugins";
import { gateToolCall } from "@/lib/approvals/queue";
import { isToolAllowedInPrivacyMode } from "@/lib/privacy/policy";
import { execFile } from "child_process";
import { promisify } from "util";
const execFileAsync = promisify(execFile);

export type RegisteredTool = {
  definition: any;
  execute: (argsJson: string) => Promise<string>;
  source: "builtin" | "dynamic";
};

const registry = new Map<string, RegisteredTool>();

for (const definition of TOOL_DEFINITIONS) {
  const name = definition.function.name;
  registry.set(name, {
    definition,
    source: "builtin",
    execute: (argsJson) => executeTool(name, argsJson),
  });
}

export function registerTool(
  definition: any,
  handler: (args: Record<string, unknown>) => Promise<string> | string,
) {
  const name = String(definition?.function?.name ?? "").trim();
  if (!name) throw new Error("Tool definition must contain function.name");
  registry.set(name, {
    definition,
    source: "dynamic",
    execute: async (argsJson) => {
      let args: Record<string, unknown> = {};
      try { args = argsJson ? JSON.parse(argsJson) : {}; } catch { return "Error: invalid JSON arguments."; }
      return gateToolCall(name, argsJson, async () => {
        try { return String(await handler(args)); } catch (error) {
          return `Error: ${error instanceof Error ? error.message : "tool execution failed"}`;
        }
      });
    },
  });
}

export function unregisterTool(name: string) {
  if ((TOOL_DEFINITIONS as readonly any[]).some((x) => x.function.name === name)) return false;
  return registry.delete(name);
}

export function getTool(name: string) {
  return isToolAllowedInPrivacyMode(name) ? registry.get(name) : undefined;
}

export function getRegisteredTools() {
  return [...registry.values()].filter((tool) => isToolAllowedInPrivacyMode(tool.definition?.function?.name || ""));
}

export function getToolDefinitions() {
  return getRegisteredTools().map((x) => x.definition);
}


registerTool({
  type: "function",
  function: {
    name: "browser_fetch",
    description: "Fetch and extract readable text from a public URL. This is a lightweight browser capability available without Playwright.",
    parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
  },
}, async (args) => browserFetch(String(args.url || "")));

registerTool({
  type: "function",
  function: {
    name: "screen_ocr",
    description: "Capture the desktop screen and extract visible text with OCR when the host OS supports it.",
    parameters: { type: "object", properties: {}, required: [] },
  },
}, async () => screenOcr());

registerTool({
  type: "function",
  function: {
    name: "open_url",
    description: "Open a URL in the host operating system's default browser. Use only when the user explicitly asks to open a page.",
    parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
  },
}, async (args) => {
  const url = String(args.url || "").trim();
  if (!/^https?:\/\//i.test(url)) return "Error: only http(s) URLs are allowed.";
  const platform = process.platform;
  if (platform === "win32") await execFileAsync("cmd", ["/c", "start", "", url]);
  else if (platform === "darwin") await execFileAsync("open", [url]);
  else await execFileAsync("xdg-open", [url]);
  return `Opened ${url}.`;
});


registerTool({
  type: "function",
  function: {
    name: "browser_control",
    description: "Optional Playwright browser automation. Navigate, inspect text, click selectors, type into fields, or capture a screenshot when Playwright/Chromium is installed on the host.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["navigate", "get_text", "click", "type", "screenshot"] },
        url: { type: "string" },
        selector: { type: "string" },
        text: { type: "string" },
      },
      required: ["action"],
    },
  },
}, async (args) => browserControl(String(args.action || ""), args));

// Legacy Android Hands is not registered unless both experimental flags are explicitly enabled; release policy still filters it out.
registerAndroidTools(registerTool);

// Autocoder (no-op unless AUTOCODER_ENABLED=true). Edits only ever go through guard.ts + verification.
registerAutocoderTools(registerTool);

// Plugins from plugins/*/index.ts (see plugins/README.md). Runs last so a plugin can never replace a built-in tool.
registerPlugins(registerTool, (name) => registry.has(name));
