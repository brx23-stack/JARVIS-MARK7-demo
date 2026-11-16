/** Names of env vars that are unset or blank. Never returns values. */
export function missingEnv(names: readonly string[], env: Record<string, string | undefined> = process.env): string[] {
  return names.filter((n) => !(env[n] ?? "").trim());
}

/** Replaces any secret value found in `text` with ***. Values shorter than 6 chars are ignored. */
export function redact(text: string, secrets: readonly (string | undefined)[]): string {
  let out = text;
  for (const s of secrets) if (s && s.length >= 6) out = out.split(s).join("***");
  return out;
}
