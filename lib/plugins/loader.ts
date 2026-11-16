import type { PluginTool } from "./types.ts";

// Pure, dependency-injected loader: validates plugins and hands each tool to `register`.
// It never overrides an existing tool and never lets one bad plugin break the others.

export type PluginEntry = { dir: string; plugin: unknown };
export type LoadDeps = {
  register: (definition: PluginTool["definition"], handler: PluginTool["handler"]) => void;
  /** True if a tool with this name is already registered (built-ins included). */
  exists: (toolName: string) => boolean;
  log?: { info: (m: string) => void; warn: (m: string) => void };
  /** Defaults to process.env.JARVIS_PLUGINS. "off" disables loading. */
  switchValue?: string;
};
export type LoadReport = {
  loaded: string[];
  skipped: { plugin: string; tool?: string; reason: string }[];
  disabled: boolean;
};

const PLUGIN_NAME = /^[a-z0-9][a-z0-9-]{0,39}$/;
const TOOL_NAME = /^[a-z][a-z0-9_]{2,39}$/;

export function loadPlugins(entries: readonly PluginEntry[], deps: LoadDeps): LoadReport {
  const log = deps.log ?? console;
  const report: LoadReport = { loaded: [], skipped: [], disabled: false };
  const sw = (deps.switchValue ?? process.env.JARVIS_PLUGINS ?? "").trim().toLowerCase();
  if (sw === "off" || sw === "false" || sw === "0") {
    report.disabled = true;
    return report;
  }

  const claimed = new Set<string>();
  const skip = (plugin: string, reason: string, tool?: string) => {
    report.skipped.push({ plugin, tool, reason });
    log.warn(`[plugins] skipped ${plugin}${tool ? `/${tool}` : ""}: ${reason}`);
  };

  for (const { dir, plugin } of entries) {
    const p = plugin as { name?: unknown; tools?: unknown } | null;
    if (!p || typeof p !== "object") { skip(dir, "default export is not an object"); continue; }
    if (typeof p.name !== "string" || !PLUGIN_NAME.test(p.name)) { skip(dir, "invalid plugin name (use lowercase letters, digits, dashes)"); continue; }
    if (!Array.isArray(p.tools)) { skip(dir, "`tools` must be an array"); continue; }

    let count = 0;
    for (const tool of p.tools as PluginTool[]) {
      const name = tool?.definition?.function?.name;
      if (typeof name !== "string" || !TOOL_NAME.test(name)) { skip(dir, "invalid tool name (lowercase, digits, underscores, 3-40 chars)", String(name)); continue; }
      if (typeof tool.handler !== "function") { skip(dir, "handler must be a function", name); continue; }
      if (typeof tool.definition.function.description !== "string" || !tool.definition.function.description.trim()) { skip(dir, "description is required", name); continue; }
      if (deps.exists(name) || claimed.has(name)) { skip(dir, "a tool with this name already exists", name); continue; }
      try {
        deps.register(tool.definition, tool.handler);
        claimed.add(name);
        report.loaded.push(name);
        count++;
      } catch (error) {
        skip(dir, error instanceof Error ? error.message : "registration failed", name);
      }
    }
    if (count) log.info(`[plugins] ${p.name}: ${count} tool${count === 1 ? "" : "s"}`);
  }
  return report;
}
