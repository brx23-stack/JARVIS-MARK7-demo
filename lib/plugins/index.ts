import { PLUGINS } from "./manifest.generated.ts";
import { loadPlugins, type LoadDeps } from "./loader.ts";

/** Called once from lib/agents/tool-registry.ts, after the built-in tools exist. */
export function registerPlugins(register: LoadDeps["register"], exists: LoadDeps["exists"]) {
  return loadPlugins(PLUGINS, { register, exists });
}
