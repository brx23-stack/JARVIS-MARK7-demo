/** Parses model output as JSON. Tolerates ``` fences and chatter around one JSON object/array. Returns null if unusable. */
export function parseJson<T>(text: string): T | null {
  const cleaned = String(text ?? "").replace(/^```[a-z]*\s*/i, "").replace(/\s*```$/i, "").trim();
  try { return JSON.parse(cleaned) as T; } catch { /* try to find an embedded object/array */ }
  for (const [open, close] of [["{", "}"], ["[", "]"]] as const) {
    const start = cleaned.indexOf(open);
    const end = cleaned.lastIndexOf(close);
    if (start >= 0 && end > start) {
      try { return JSON.parse(cleaned.slice(start, end + 1)) as T; } catch { /* keep looking */ }
    }
  }
  return null;
}
