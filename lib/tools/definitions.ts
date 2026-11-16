// ——— Tool definitions ———
//
// Standard OpenAI-style function-calling schema. Every provider wired up in
// app/api/chat/route.ts (Groq, NVIDIA, Gemini's OpenAI-compat layer, Ollama
// with a tool-capable model) accepts this same "tools" array shape, so this
// file doesn't need to know or care which provider is active.
//
// Add a new tool by (1) adding its schema here and (2) adding a matching
// case in lib/tools/execute.ts. Nothing else needs to change — the chat
// route just loops over whatever the model decides to call.

export const TOOL_DEFINITIONS = [
  {
    type: "function",
    function: {
      name: "remember_fact",
      description:
        "Save a fact about the user or their preferences for future conversations. Use this whenever the user tells you something worth remembering long-term (their name, preferences, ongoing projects, recurring routines, etc).",
      parameters: {
        type: "object",
        properties: {
          key: {
            type: "string",
            description: "Short label for the fact, e.g. \"name\", \"favorite_coffee\", \"work_project\".",
          },
          value: {
            type: "string",
            description: "The fact itself, in a short sentence or phrase.",
          },
        },
        required: ["key", "value"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "recall_fact",
      description: "Look up a previously remembered fact by its key. Use when you need to check a stored detail before answering.",
      parameters: {
        type: "object",
        properties: {
          key: { type: "string", description: "The label used when the fact was saved." },
        },
        required: ["key"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "forget_fact",
      description: "Delete a previously remembered fact. Use when the user asks you to forget something or a stored fact is no longer true.",
      parameters: {
        type: "object",
        properties: {
          key: { type: "string", description: "The label of the fact to remove." },
        },
        required: ["key"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_current_time",
      description: "Returns the current date and time. Use whenever the user asks what time or date it is, or you need it to answer a scheduling question.",
      parameters: {
        type: "object",
        properties: {
          timezone: {
            type: "string",
            description: "IANA timezone, e.g. \"America/New_York\". Defaults to the server's local timezone if omitted.",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "web_search",
      description:
        "Searches the web for current information — news, facts, prices, anything that might have changed since training or that you're unsure about. Use this rather than guessing whenever the user asks about something current or you're not confident in your own knowledge.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "The search query." },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "smart_home_control",
      description:
        "Controls a smart home device via Home Assistant — turn lights/switches on or off, set brightness, or set a thermostat's target temperature. Only works for entity_ids that exist in the user's Home Assistant instance.",
      parameters: {
        type: "object",
        properties: {
          entity_id: { type: "string", description: "Home Assistant entity id, e.g. \"light.living_room\" or \"climate.hallway\"." },
          action: { type: "string", enum: ["turn_on", "turn_off", "set_brightness", "set_temperature"] },
          value: { type: "number", description: "Required for set_brightness (0-100) and set_temperature (degrees)." },
        },
        required: ["entity_id", "action"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "smart_home_status",
      description: "Reads the current state of a Home Assistant entity (e.g. whether a light is on, or a sensor's reading).",
      parameters: {
        type: "object",
        properties: {
          entity_id: { type: "string", description: "Home Assistant entity id, e.g. \"light.living_room\"." },
        },
        required: ["entity_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_upcoming_events",
      description: "Lists the user's upcoming Google Calendar events within a given time window. Use when asked about the schedule, what's coming up, or free/busy time.",
      parameters: {
        type: "object",
        properties: {
          hours_ahead: { type: "number", description: "How many hours ahead to look. Defaults to 24." },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_calendar_event",
      description: "Creates a new event on the user's Google Calendar.",
      parameters: {
        type: "object",
        properties: {
          summary: { type: "string", description: "Event title." },
          start_iso: { type: "string", description: "Start time, full ISO 8601 datetime, e.g. 2026-08-20T15:00:00-04:00." },
          end_iso: { type: "string", description: "End time, full ISO 8601 datetime." },
          location: { type: "string", description: "Optional location." },
        },
        required: ["summary", "start_iso", "end_iso"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "check_unread_email",
      description: "Summarizes the user's most recent unread emails (sender, subject, snippet). Read-only — cannot send email.",
      parameters: {
        type: "object",
        properties: {
          count: { type: "number", description: "How many unread emails to summarize. Defaults to 5." },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "open_app",
      description: "Opens an application on the user's computer. Only apps the user has pre-configured are available — ask what's available if unsure.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "The app's short name as the user refers to it, e.g. \"spotify\", \"browser\"." },
        },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_system_volume",
      description: "Sets the system audio volume on the user's computer.",
      parameters: {
        type: "object",
        properties: {
          percent: { type: "number", description: "Volume level, 0-100." },
        },
        required: ["percent"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "media_control",
      description: "Controls media playback on the user's computer (play/pause music, skip tracks).",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["play", "pause", "next", "previous"] },
        },
        required: ["action"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_weather",
      description: "Gets the current weather (temperature, condition, humidity, wind) for a place. Use whenever the user asks about weather or conditions somewhere.",
      parameters: {
        type: "object",
        properties: {
          place: { type: "string", description: "City name, optionally with country/region, e.g. \"Austin\" or \"Austin, Texas\"." },
        },
        required: ["place"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "convert_currency",
      description: "Converts an amount from one currency to another using today's exchange rate. Use for any currency conversion or 'how much is X in Y' money question.",
      parameters: {
        type: "object",
        properties: {
          amount: { type: "number", description: "The amount to convert." },
          from: { type: "string", description: "Source currency code, e.g. \"USD\", \"EUR\", \"JPY\"." },
          to: { type: "string", description: "Target currency code, e.g. \"USD\", \"EUR\", \"JPY\"." },
        },
        required: ["amount", "from", "to"],
      },
    },
  },
] as const;

export type ToolName = (typeof TOOL_DEFINITIONS)[number]["function"]["name"];
