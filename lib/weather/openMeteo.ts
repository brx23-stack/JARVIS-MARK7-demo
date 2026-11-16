// ——— Weather: Open-Meteo ———
//
// Open-Meteo (open-meteo.com) is fully free, requires no API key, and has
// no rate limit for non-commercial use — a rare combination among weather
// APIs, most of which gate real forecasts behind a paid tier. Two calls:
//   1. their free geocoding API to turn a place name into lat/lon
//   2. their forecast API to get current + short-term conditions for that
//      lat/lon
// Both are public and keyless, so this module needs zero entries in
// .env.example — it works out of the box.

const REQUEST_TIMEOUT_MS = 8_000;

async function fetchJson(url: string): Promise<any> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`Request to Open-Meteo failed (${res.status}).`);
    return await res.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function geocode(place: string): Promise<{ name: string; latitude: number; longitude: number; country?: string } | null> {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(place)}&count=1&language=en&format=json`;
  const data = await fetchJson(url);
  const result = data?.results?.[0];
  if (!result) return null;
  return { name: result.name, latitude: result.latitude, longitude: result.longitude, country: result.country };
}

// WMO weather codes → short human description. Open-Meteo returns a numeric
// code (the WMO standard) rather than a text summary, so this maps the
// common ones to something speakable. Falls back to the raw code for the
// long tail of rarer codes rather than maintaining an exhaustive table.
const WEATHER_CODE_DESCRIPTIONS: Record<number, string> = {
  0: "clear sky",
  1: "mostly clear",
  2: "partly cloudy",
  3: "overcast",
  45: "fog",
  48: "depositing rime fog",
  51: "light drizzle",
  53: "moderate drizzle",
  55: "dense drizzle",
  61: "light rain",
  63: "moderate rain",
  65: "heavy rain",
  71: "light snow",
  73: "moderate snow",
  75: "heavy snow",
  77: "snow grains",
  80: "light rain showers",
  81: "moderate rain showers",
  82: "violent rain showers",
  85: "light snow showers",
  86: "heavy snow showers",
  95: "thunderstorm",
  96: "thunderstorm with light hail",
  99: "thunderstorm with heavy hail",
};

function describeWeatherCode(code: number): string {
  return WEATHER_CODE_DESCRIPTIONS[code] ?? `weather code ${code}`;
}

export type WeatherReport = {
  place: string;
  temperatureC: number;
  feelsLikeC: number;
  condition: string;
  windKph: number;
  humidityPercent: number;
};

/** Looks up a place name and returns its current weather. Throws if the place can't be geocoded or the forecast call fails. */
export async function getCurrentWeather(place: string): Promise<WeatherReport> {
  const location = await geocode(place);
  if (!location) throw new Error(`Couldn't find a location matching "${place}".`);

  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${location.latitude}&longitude=${location.longitude}` +
    `&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m` +
    `&timezone=auto`;
  const data = await fetchJson(url);
  const current = data?.current;
  if (!current) throw new Error("Open-Meteo returned no current weather data.");

  const label = location.country ? `${location.name}, ${location.country}` : location.name;
  return {
    place: label,
    temperatureC: current.temperature_2m,
    feelsLikeC: current.apparent_temperature,
    condition: describeWeatherCode(current.weather_code),
    windKph: current.wind_speed_10m,
    humidityPercent: current.relative_humidity_2m,
  };
}

export function formatWeatherReport(report: WeatherReport): string {
  const tempF = Math.round((report.temperatureC * 9) / 5 + 32);
  const feelsF = Math.round((report.feelsLikeC * 9) / 5 + 32);
  return (
    `${report.place}: ${report.condition}, ${Math.round(report.temperatureC)}°C (${tempF}°F), ` +
    `feels like ${Math.round(report.feelsLikeC)}°C (${feelsF}°F), ` +
    `${Math.round(report.humidityPercent)}% humidity, wind ${Math.round(report.windKph)} km/h.`
  );
}
