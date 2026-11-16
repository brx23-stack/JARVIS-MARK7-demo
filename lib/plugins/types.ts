/** What a plugin's `plugins/<folder>/index.ts` must `export default`. */
export type PluginTool = {
  /** OpenAI-style function definition, the same shape the built-in tools use. */
  definition: {
    type: "function";
    function: { name: string; description: string; parameters: Record<string, unknown> };
  };
  /** Receives the parsed arguments. Return a string for the model. Thrown errors are caught and reported. */
  handler: (args: Record<string, unknown>) => Promise<string> | string;
};

export type JarvisPlugin = {
  /** Lowercase letters, digits and dashes. Shown in logs only. */
  name: string;
  description?: string;
  tools: PluginTool[];
};
