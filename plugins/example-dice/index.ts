import crypto from "node:crypto";
import type { JarvisPlugin } from "../../lib/plugins/types.ts";

// Example plugin. Copy this folder, rename it, change the tool, run `npm run plugins`, restart.
// Try it: ask JARVIS "roll two twenty-sided dice".

const plugin: JarvisPlugin = {
  name: "example-dice",
  description: "Rolls dice. A minimal example of a JARVIS plugin.",
  tools: [
    {
      definition: {
        type: "function",
        function: {
          name: "roll_dice",
          description: "Roll one or more dice and return the results. Use when the user asks to roll dice or flip a number.",
          parameters: {
            type: "object",
            properties: {
              sides: { type: "integer", description: "Faces per die, 2 to 1000. Default 6." },
              count: { type: "integer", description: "How many dice, 1 to 20. Default 1." },
            },
            required: [],
          },
        },
      },
      handler: (args) => {
        const sides = Math.min(1000, Math.max(2, Math.trunc(Number(args.sides ?? 6)) || 6));
        const count = Math.min(20, Math.max(1, Math.trunc(Number(args.count ?? 1)) || 1));
        const rolls = Array.from({ length: count }, () => crypto.randomInt(1, sides + 1));
        const total = rolls.reduce((a, b) => a + b, 0);
        return `Rolled ${count}d${sides}: ${rolls.join(", ")} (total ${total})`;
      },
    },
  ],
};

export default plugin;
