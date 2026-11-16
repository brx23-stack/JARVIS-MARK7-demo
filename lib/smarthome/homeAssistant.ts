// ——— Smart home: Home Assistant ———
//
// Talks to a Home Assistant instance over its REST API. Home Assistant is
// the natural hub to integrate against rather than individual brands (Hue,
// Nest, etc) directly — it already speaks to hundreds of device types, so
// one integration here gets JARVIS control over whatever's connected to it,
// with zero per-brand code.
//
// Requires a long-lived access token (Home Assistant → profile → Security
// → Long-Lived Access Tokens) and the instance URL, both read server-side
// only from env — see .env.example. If unconfigured, every function here
// throws a clear "not configured" error that the tool executor turns into
// a spoken explanation rather than a crash.

const REQUEST_TIMEOUT_MS = 8_000;

function getConfig(): { baseUrl: string; token: string } | null {
  const baseUrl = process.env.HOME_ASSISTANT_URL;
  const token = process.env.HOME_ASSISTANT_TOKEN;
  if (!baseUrl || !token) return null;
  return { baseUrl: baseUrl.replace(/\/$/, ""), token };
}

export function isHomeAssistantConfigured(): boolean {
  return getConfig() !== null;
}

async function callService(domain: string, service: string, data: Record<string, unknown>): Promise<void> {
  const config = getConfig();
  if (!config) throw new Error("Home Assistant isn't configured (missing HOME_ASSISTANT_URL/HOME_ASSISTANT_TOKEN).");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${config.baseUrl}/api/services/${domain}/${service}`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${config.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Home Assistant returned ${res.status}: ${text.slice(0, 200)}`);
    }
  } finally {
    clearTimeout(timeout);
  }
}

async function getState(entityId: string): Promise<{ state: string; attributes: Record<string, unknown> }> {
  const config = getConfig();
  if (!config) throw new Error("Home Assistant isn't configured (missing HOME_ASSISTANT_URL/HOME_ASSISTANT_TOKEN).");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${config.baseUrl}/api/states/${entityId}`, {
      signal: controller.signal,
      headers: { authorization: `Bearer ${config.token}` },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Home Assistant returned ${res.status}: ${text.slice(0, 200)}`);
    }
    return res.json();
  } finally {
    clearTimeout(timeout);
  }
}

/** Turns a light/switch/etc entity on or off. domain is inferred from the entity_id prefix (e.g. "light.living_room" → "light"). */
export async function setEntityPower(entityId: string, on: boolean): Promise<void> {
  const domain = entityId.split(".")[0];
  if (!domain) throw new Error(`Invalid entity_id "${entityId}" — expected e.g. "light.living_room".`);
  await callService(domain, on ? "turn_on" : "turn_off", { entity_id: entityId });
}

/** Sets brightness (0-100) on a light entity. */
export async function setLightBrightness(entityId: string, percent: number): Promise<void> {
  const clamped = Math.max(0, Math.min(100, Math.round(percent)));
  await callService("light", "turn_on", { entity_id: entityId, brightness_pct: clamped });
}

/** Sets a climate entity's target temperature. */
export async function setThermostat(entityId: string, temperature: number): Promise<void> {
  await callService("climate", "set_temperature", { entity_id: entityId, temperature });
}

/** Reads back an entity's current state (e.g. "on"/"off", or a temperature reading). */
export async function readEntityState(entityId: string): Promise<string> {
  const data = await getState(entityId);
  return data.state;
}
