# Plugins

Drop a folder here with an `index.ts` and JARVIS can call its tools. The example is [`example-dice/`](./example-dice/index.ts).

```ts
import type { JarvisPlugin } from "../../lib/plugins/types.ts";

const plugin: JarvisPlugin = {
  name: "my-plugin",                 // lowercase letters, digits, dashes
  tools: [{
    definition: { type: "function", function: {
      name: "my_tool",               // lowercase, digits, underscores
      description: "What it does and when the AI should use it.",
      parameters: { type: "object", properties: {}, required: [] },
    } },
    handler: async (args) => "a string for the model",
  }],
};
export default plugin;
```

**Add one:** create `plugins/<folder>/index.ts`, then restart `npm run dev` (or `npm run plugins` first if it is already running). `npm run build` and Docker builds pick plugins up automatically.

**How it works:** `scripts/gen-plugins.mjs` writes `lib/plugins/manifest.generated.ts` with static imports of every `plugins/*/index.ts`; `lib/plugins/loader.ts` validates each tool and registers it next to the built-ins. Folders starting with `_` or `.` are ignored.

**Safety:**
- A plugin is server-side code that runs with the same access as the rest of JARVIS. Only add plugins you have read.
- A plugin can never replace an existing tool; a name clash skips that tool and logs a warning. One broken plugin does not stop the others.
- Plugin tools go through the approvals inbox like any other: add the tool name to `JARVIS_APPROVAL_TOOLS` to hold its calls until you approve.
- The Autocoder cannot write to `plugins/` or `lib/plugins/`.
- Set `JARVIS_PLUGINS=off` to load none.
